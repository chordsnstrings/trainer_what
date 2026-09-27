"""Emit the SQL the host controller would run, for execution by a TypeScript test.

tests/infra-ops-contract.test.ts executes these statements against the real
schema (PGlite, or PostgreSQL as the restricted runtime role) so controller SQL
is checked by a database, not only by string assertions. Synthetic values only.
"""
import json
import re
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/digitalocean"))
import hostops  # noqa: E402


def statements(sql):
    body = sql.replace("BEGIN;\n", "").replace("COMMIT;\n", "")
    return [part.strip() for part in body.split(";\n") if part.strip()]


def main(secret, mode):
    key = hostops.host_key({"INTERNAL_PROXY_SECRET": secret})
    if mode == "queries":
        print(json.dumps({"pending": hostops.PENDING_SQL, "running": hostops.RUNNING_SQL}))
        return
    request = json.loads(sys.stdin.read())
    rows, now_ms = request["rows"], request["nowMs"]
    captured = []

    def psql(h, sql, **kwargs):
        captured.append(sql)
        match = re.search(r"WHERE id='([0-9a-f-]{36})'", sql)
        return (match.group(1) + "\n") if match else ""

    output = []
    with patch.object(hostops, "psql", side_effect=psql):
        for row in rows:
            verdict, message = hostops.verify_request(row, key, now_ms)
            captured.clear()
            if verdict == "ok":
                hostops.transition(None, key, row["id"], "pending", "running")
                hostops.transition(None, key, row["id"], "running", "succeeded",
                                   {"message": "Synthetic contract result", "details": {"action": row["action"]}})
            else:
                hostops.transition(None, key, row["id"], "pending", verdict, {"message": message})
            output.append({"id": row["id"], "verdict": verdict,
                           "statements": [statements(sql) for sql in captured]})
        report = {"version": 1, "generatedAt": "2026-09-27T00:00:00Z", "controllerRelease": None, "host": None,
                  "containers": None, "edge": None, "deploy": None, "backups": None}
        captured.clear()
        with patch.object(hostops, "table_ready", return_value=True), \
                patch.object(hostops, "atomic_json"):
            hostops.write_report(type("H", (), {"ROOT": Path("/nonexistent")}), key, report)
        output.append({"id": None, "verdict": "report", "statements": [statements(sql) for sql in captured]})
    print(json.dumps(output))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
