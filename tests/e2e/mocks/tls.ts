/**
 * Throwaway TLS material for the mock providers: a new CA and one loopback
 * leaf certificate per run, created with the system openssl. The CA file is
 * handed to the app through NODE_EXTRA_CA_CERTS so production-mode processes
 * verify the mocks like any HTTPS provider. Nothing here is reused or kept.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";

export type MockTls = {
  dir: string;
  caFile: string;
  ca: string;
  key: string;
  cert: string;
  /** Leaf for simulated coach domains (the edge serves it only after the TLS ask allows the name). */
  domains?: { names: string[]; key: string; cert: string };
  cleanup: () => void;
};

export function createMockTls(parent = tmpdir(), domainNames: string[] = []): MockTls {
  const dir = mkdtempSync(join(parent, "trainer-e2e-tls-"));
  const run = (args: string[]) =>
    execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1"];
  run([
    "req",
    "-x509",
    ...ec,
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "2",
    "-subj",
    "/CN=Trainer E2E throwaway CA " + Date.now(),
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  run([
    "req",
    ...ec,
    "-nodes",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
    "-subj",
    "/CN=localhost",
  ]);
  writeFileSync(
    join(dir, "leaf.ext"),
    [
      "basicConstraints=CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    ].join("\n") + "\n",
  );
  run([
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "leaf.pem",
    "-days",
    "2",
    "-extfile",
    "leaf.ext",
  ]);
  let domains: MockTls["domains"];
  if (domainNames.length) {
    run(["req", ...ec, "-nodes", "-keyout", "domains.key", "-out", "domains.csr", "-subj", "/CN=" + domainNames[0]]);
    writeFileSync(
      join(dir, "domains.ext"),
      [
        "basicConstraints=CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
        "subjectAltName=" + domainNames.map((name) => "DNS:" + name).join(","),
      ].join("\n") + "\n",
    );
    run(["x509", "-req", "-in", "domains.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "domains.pem", "-days", "2", "-extfile", "domains.ext"]);
    domains = {
      names: domainNames,
      key: readFileSync(join(dir, "domains.key"), "utf8"),
      cert: readFileSync(join(dir, "domains.pem"), "utf8"),
    };
  }
  // The CA private key is not needed after signing; remove it immediately.
  rmSync(join(dir, "ca.key"), { force: true });
  return {
    dir,
    caFile: join(dir, "ca.pem"),
    ca: readFileSync(join(dir, "ca.pem"), "utf8"),
    key: readFileSync(join(dir, "leaf.key"), "utf8"),
    cert: readFileSync(join(dir, "leaf.pem"), "utf8"),
    domains,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** In-process trust for tests and the harness (child processes use NODE_EXTRA_CA_CERTS). */
export function trustMockCa(ca: string) {
  const current = tls.getCACertificates("default");
  if (!current.includes(ca)) tls.setDefaultCACertificates([...current, ca]);
}
