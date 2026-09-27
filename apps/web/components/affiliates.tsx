"use client";
import { useCallback, useEffect, useState } from "react";
const money = (value: number | string) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(
    Number(value) / 100,
  );
const emptyContract = {
  provider: "",
  revision: 0,
  enabled: false,
  termsReference: "",
  disclosure: "",
  trainerShareBps: 0,
  providerPermissionConfirmed: false,
  reason: "",
};
async function request(path: string, body?: unknown) {
  const r = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.message ?? "Request failed");
  return data;
}
export function Affiliates({ trainer = false }: { trainer?: boolean }) {
  const [tenants, setTenants] = useState<any[]>([]),
    [tenant, setTenant] = useState("");
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [contract, setContract] = useState(emptyContract);
  const base = trainer
    ? "/api/v1/affiliates"
    : `/api/v1/admin/tenants/${tenant}/affiliates`;
  const load = useCallback(async () => {
    if (!trainer && !tenant) return;
    setError("");
    setData(null);
    try {
      setData(await request(base));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base, trainer, tenant]);
  useEffect(() => {
    if (!trainer)
      void request("/api/v1/admin/affiliates")
        .then((d) => {
          setTenants(d.tenants);
          setTenant(d.tenants[0]?.id ?? "");
        })
        .catch((e) => setError(e.message));
  }, [trainer]);
  useEffect(() => {
    setContract(emptyContract);
    void load();
  }, [load]);
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(base + path, body);
      await load();
      setNotice("Saved. Financial history is retained.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit =
    (fn: (f: FormData) => Promise<void>) =>
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      await fn(new FormData(e.currentTarget));
    };
  const contractName = (id: string) =>
    data?.contracts.find((c: any) => c.id === id)?.provider ?? id;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS</p>
          <h1>Affiliate earnings.</h1>
          <p>
            Approved provider agreements, aggregate earnings and verified bank
            receipts.
          </p>
        </div>
      </div>
      {!trainer && (
        <label>
          Workspace
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void load()}
      >
        Refresh earnings
      </button>
      {data && (
        <>
          <section className="card">
            <h2>Agreements and disclosure</h2>
            <p>
              Only approved aggregate provider reports are accepted. No
              subscriber identities or health information are recorded here.
              Earnings enter your payable balance after matching bank evidence
              is recorded.
            </p>
            {data.contracts.map((c: any) => (
              <div className="list-row" key={c.id}>
                <div>
                  <strong>
                    {c.provider} · {c.enabled ? "Enabled" : "Disabled"}
                  </strong>
                  <p>
                    Trainer share {c.trainer_share_bps / 100}% · revision{" "}
                    {c.revision}
                  </p>
                  <p>{c.disclosure}</p>
                  <small>{c.terms_reference}</small>
                </div>
                {!trainer && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      setContract({
                        provider: c.provider,
                        revision: c.revision,
                        enabled: c.enabled,
                        termsReference: c.terms_reference,
                        disclosure: c.disclosure,
                        trainerShareBps: c.trainer_share_bps,
                        providerPermissionConfirmed: false,
                        reason: "",
                      })
                    }
                  >
                    Edit agreement
                  </button>
                )}
              </div>
            ))}
            {!data.contracts.length && (
              <p>No provider agreements are configured.</p>
            )}
          </section>
          {!trainer && (
            <section className="card">
              <h2>
                {contract.revision ? "Update agreement" : "Add agreement"}
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("/contracts", contract).then((ok) => {
                    if (ok) setContract(emptyContract);
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <label>
                    Provider
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      readOnly={!!contract.revision}
                      value={contract.provider}
                      onChange={(e) =>
                        setContract({ ...contract, provider: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Approved agreement reference
                    <input
                      required
                      minLength={10}
                      maxLength={500}
                      value={contract.termsReference}
                      onChange={(e) =>
                        setContract({
                          ...contract,
                          termsReference: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Customer disclosure
                    <textarea
                      required
                      minLength={10}
                      maxLength={1000}
                      value={contract.disclosure}
                      onChange={(e) =>
                        setContract({ ...contract, disclosure: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Trainer share (%)
                    <input
                      required
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={contract.trainerShareBps / 100}
                      onChange={(e) =>
                        setContract({
                          ...contract,
                          trainerShareBps: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Reason
                    <input
                      required
                      minLength={10}
                      maxLength={500}
                      value={contract.reason}
                      onChange={(e) =>
                        setContract({ ...contract, reason: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={contract.enabled}
                      onChange={(e) =>
                        setContract({ ...contract, enabled: e.target.checked })
                      }
                    />
                    Enable new earnings under this agreement
                  </label>
                  <label>
                    <input
                      required
                      type="checkbox"
                      checked={contract.providerPermissionConfirmed}
                      onChange={(e) =>
                        setContract({
                          ...contract,
                          providerPermissionConfirmed: e.target.checked,
                        })
                      }
                    />
                    Provider permission, disclosure and the earnings split are
                    approved
                  </label>
                  <button className="button">Save agreement</button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setContract(emptyContract)}
                  >
                    New agreement
                  </button>
                </fieldset>
              </form>
            </section>
          )}
          {!trainer && data.contracts.length > 0 && (
            <section className="card">
              <h2>Record provider earnings</h2>
              <form
                onSubmit={submit(async (f) => {
                  const c = data.contracts.find(
                    (c: any) => c.id === f.get("contractId"),
                  );
                  if (!c) { setError("Enable an approved agreement first."); return; }
                  await act("/receipts", {
                    requestId: crypto.randomUUID(),
                    contractId: c.id,
                    revision: c.revision,
                    providerReference: f.get("reference"),
                    period: f.get("period"),
                    amountMinor: Math.round(Number(f.get("amount")) * 100),
                    evidenceReference: f.get("evidence"),
                  });
                })}
              >
                <fieldset disabled={busy}>
                  <label>
                    Agreement
                    <select required name="contractId">
                      {data.contracts
                        .filter((c: any) => c.enabled)
                        .map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.provider}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Provider statement reference
                    <input
                      required
                      name="reference"
                      minLength={5}
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Reporting month
                    <input required type="month" name="period" />
                  </label>
                  <label>
                    Confirmed earnings (AED)
                    <input
                      required
                      type="number"
                      name="amount"
                      min="0.01"
                      max="10000000"
                      step="0.01"
                    />
                  </label>
                  <label>
                    Evidence reference
                    <input
                      required
                      name="evidence"
                      minLength={10}
                      maxLength={500}
                    />
                  </label>
                  <button className="button">Record earnings</button>
                </fieldset>
              </form>
            </section>
          )}
          <section className="card">
            <h2>Provider receipts</h2>
            <p>
              Latest 250 receipts. Corrections are separate reversing entries.
            </p>
            {data.receipts.map((r: any) => (
              <details key={r.id}>
                <summary>
                  {contractName(r.contract_id)} · {r.period} ·{" "}
                  {money(r.amount_minor)} · {r.provider_reference}
                </summary>
                <p>
                  Trainer share {money(r.trainer_minor)} ·{" "}
                  {r.statement_id
                    ? "Included in a closed statement"
                    : "Awaiting statement"}
                </p>
                <p>{r.evidence_reference}</p>
                {!trainer &&
                  !r.reversal_of &&
                  !data.receipts.some(
                    (other: any) => other.reversal_of === r.id,
                  ) && (
                    <form
                      onSubmit={submit(async (f) => {
                        await act(`/receipts/${r.id}/reverse`, {
                          requestId: crypto.randomUUID(),
                          period: f.get("period"),
                          providerReference: f.get("reference"),
                          evidenceReference: f.get("evidence"),
                        });
                      })}
                    >
                      <fieldset disabled={busy}>
                        <legend>
                          Reverse an incorrect or returned earning
                        </legend>
                        <label>
                          Open reporting month
                          <input required name="period" type="month" />
                        </label>
                        <label>
                          Correction reference
                          <input
                            required
                            name="reference"
                            minLength={5}
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Evidence
                          <input
                            required
                            name="evidence"
                            minLength={10}
                            maxLength={500}
                          />
                        </label>
                        <button className="button secondary">
                          Record full reversal
                        </button>
                      </fieldset>
                    </form>
                  )}
              </details>
            ))}
          </section>
          {!trainer && data.contracts.length > 0 && (
            <section className="card">
              <h2>Close an affiliate statement</h2>
              <p>
                Closing seals the selected month's receipts. Later corrections
                must use an open reporting month.
              </p>
              <form
                onSubmit={submit(async (f) => {
                  await act("/statements", {
                    contractId: f.get("contractId"),
                    period: f.get("period"),
                  });
                })}
              >
                <fieldset disabled={busy}>
                  <label>
                    Agreement
                    <select name="contractId">
                      {data.contracts.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.provider}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Reporting month
                    <input required name="period" type="month" />
                  </label>
                  <button className="button">Close statement</button>
                </fieldset>
              </form>
            </section>
          )}
          <section className="card">
            <h2>Statements and bank evidence</h2>
            {data.statements.map((s: any) => (
              <details key={s.id}>
                <summary>
                  {contractName(s.contract_id)} · {s.period} ·{" "}
                  {money(s.amount_minor)} ·{" "}
                  {s.settled_at ? "Reconciled" : "Awaiting bank evidence"}
                </summary>
                <p>
                  Trainer share {money(s.trainer_minor)} · platform share{" "}
                  {money(Number(s.amount_minor) - Number(s.trainer_minor))}
                </p>
                {s.settled_at ? (
                  <p>
                    {s.bank_reference} · {s.evidence_reference}
                  </p>
                ) : (
                  !trainer && (
                    <form
                      onSubmit={submit(async (f) => {
                        await act(`/statements/${s.id}/settle`, {
                          amountMinor: Number(s.amount_minor),
                          bankReference: f.get("bank"),
                          evidenceReference: f.get("evidence"),
                        });
                      })}
                    >
                      <fieldset disabled={busy}>
                        <legend>
                          Confirm actual{" "}
                          {Number(s.amount_minor) < 0
                            ? "bank debit"
                            : Number(s.amount_minor) > 0
                              ? "bank credit"
                              : "net-zero offset"}
                        </legend>
                        <p>
                          This records evidence and updates the ledger; it does
                          not move money. Exact signed amount:{" "}
                          {money(s.amount_minor)}.
                        </p>
                        <label>
                          Bank / offset reference
                          <input
                            required
                            name="bank"
                            minLength={5}
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Verified evidence
                          <input
                            required
                            name="evidence"
                            minLength={10}
                            maxLength={500}
                          />
                        </label>
                        <button className="button">Record bank evidence</button>
                      </fieldset>
                    </form>
                  )
                )}
              </details>
            ))}
          </section>
        </>
      )}
    </>
  );
}
