"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
    [loading, setLoading] = useState(false),
    [directoryLoading, setDirectoryLoading] = useState(!trainer),
    [notice, setNotice] = useState("");
  const [contract, setContract] = useState(emptyContract);
  const loadVersion = useRef(0);
  const agreementForm = useRef<HTMLFormElement>(null);
  const base = trainer
    ? "/api/v1/affiliates"
    : `/api/v1/admin/tenants/${tenant}/affiliates`;
  const load = useCallback(async () => {
    if (!trainer && !tenant) return false;
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const next = await request(base);
      if (version !== loadVersion.current) return false;
      setData(next);
      return true;
    } catch (e) {
      if (version === loadVersion.current) setError((e as Error).message);
      return false;
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [base, trainer, tenant]);
  const loadTenants = useCallback(async () => {
    setDirectoryLoading(true);
    setError("");
    try {
      const next = await request("/api/v1/admin/affiliates");
      setTenants(next.tenants);
      setTenant((current) =>
        next.tenants.some((t: any) => t.id === current)
          ? current
          : (next.tenants[0]?.id ?? ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDirectoryLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!trainer) void loadTenants();
  }, [trainer, loadTenants]);
  useEffect(() => {
    setContract(emptyContract);
    setData(null);
    setNotice("");
    void load();
    return () => {
      loadVersion.current++;
    };
  }, [load]);
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(base + path, body);
      const refreshed = await load();
      setNotice(
        refreshed
          ? "Saved. Financial history is retained."
          : "Saved. Refresh earnings to see the latest records.",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit =
    (fn: (f: FormData) => Promise<boolean | void>) =>
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (await fn(new FormData(form))) form.reset();
    };
  const contractName = (id: string) =>
    data?.contracts.find((c: any) => c.id === id)?.provider ?? id;
  return (
    <div
      className="affiliate-page"
      aria-busy={busy || loading || directoryLoading}
    >
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
      <div className="af-toolbar">
        {!trainer && (
          <label className="field af-workspace">
            Workspace
            <select
              value={tenant}
              disabled={busy || loading || directoryLoading || !tenants.length}
              onChange={(e) => setTenant(e.target.value)}
            >
              {!tenants.length && (
                <option value="">
                  {directoryLoading
                    ? "Loading workspaces…"
                    : "No workspaces available"}
                </option>
              )}
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={
            busy || loading || directoryLoading || (!trainer && !tenant)
          }
          onClick={() => void load()}
        >
          {loading ? "Refreshing…" : "Refresh earnings"}
        </button>
      </div>
      {error && (
        <div className="notice af-feedback" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading || directoryLoading}
            onClick={() => void (!trainer && !tenant ? loadTenants() : load())}
          >
            Try again
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {(loading || directoryLoading) && !data && (
        <p className="af-empty" role="status">
          Loading affiliate earnings…
        </p>
      )}
      {!trainer && !directoryLoading && !tenants.length && !error && (
        <p className="af-empty">No active workspaces are available yet.</p>
      )}
      {busy && <p role="status">Saving changes…</p>}
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
                    disabled={busy || loading}
                    onClick={() => {
                      setContract({
                        provider: c.provider,
                        revision: c.revision,
                        enabled: c.enabled,
                        termsReference: c.terms_reference,
                        disclosure: c.disclosure,
                        trainerShareBps: c.trainer_share_bps,
                        providerPermissionConfirmed: false,
                        reason: "",
                      });
                      agreementForm.current?.scrollIntoView({
                        block: "center",
                      });
                      agreementForm.current
                        ?.querySelector<HTMLInputElement>(
                          'input[name="termsReference"]',
                        )
                        ?.focus({ preventScroll: true });
                    }}
                  >
                    Edit agreement
                  </button>
                )}
              </div>
            ))}
            {!data.contracts.length && (
              <p className="af-empty">
                No provider agreements are configured.
                {!trainer && " Add an approved agreement below to get started."}
              </p>
            )}
          </section>
          {!trainer && (
            <section className="card">
              <h2>
                {contract.revision ? "Update agreement" : "Add agreement"}
              </h2>
              <form
                ref={agreementForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("/contracts", contract).then((ok) => {
                    if (ok) setContract(emptyContract);
                  });
                }}
              >
                <fieldset className="af-form" disabled={busy || loading}>
                  <label className="field">
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
                  <label className="field">
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
                  <label className="field af-wide">
                    Approved agreement reference
                    <input
                      required
                      minLength={10}
                      maxLength={500}
                      name="termsReference"
                      value={contract.termsReference}
                      onChange={(e) =>
                        setContract({
                          ...contract,
                          termsReference: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field af-wide">
                    Customer disclosure
                    <textarea
                      rows={4}
                      required
                      minLength={10}
                      maxLength={1000}
                      value={contract.disclosure}
                      onChange={(e) =>
                        setContract({ ...contract, disclosure: e.target.value })
                      }
                    />
                  </label>
                  <label className="field af-wide">
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
                  <label className="check-field af-wide">
                    <input
                      type="checkbox"
                      checked={contract.enabled}
                      onChange={(e) =>
                        setContract({ ...contract, enabled: e.target.checked })
                      }
                    />
                    Enable new earnings under this agreement
                  </label>
                  <label className="check-field af-wide">
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
                  <div className="af-actions af-wide">
                    <button className="button">Save agreement</button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setContract(emptyContract)}
                    >
                      {contract.revision ? "Cancel edit" : "Clear form"}
                    </button>
                  </div>
                </fieldset>
              </form>
            </section>
          )}
          {!trainer && data.contracts.length > 0 && (
            <section className="card">
              <h2>Record provider earnings</h2>
              {!data.contracts.some((c: any) => c.enabled) && (
                <p className="af-empty">
                  Enable an approved agreement before recording earnings.
                </p>
              )}
              <form
                onSubmit={submit(async (f) => {
                  const c = data.contracts.find(
                    (c: any) => c.id === f.get("contractId"),
                  );
                  if (!c) {
                    setError("Enable an approved agreement first.");
                    return;
                  }
                  return act("/receipts", {
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
                <fieldset
                  className="af-form"
                  disabled={
                    busy ||
                    loading ||
                    !data.contracts.some((c: any) => c.enabled)
                  }
                >
                  <label className="field">
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
                  <label className="field">
                    Provider statement reference
                    <input
                      required
                      name="reference"
                      minLength={5}
                      maxLength={200}
                    />
                  </label>
                  <label className="field">
                    Reporting month
                    <input required type="month" name="period" />
                  </label>
                  <label className="field">
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
                  <label className="field af-wide">
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
            {!data.receipts.length && (
              <p className="af-empty">No provider earnings recorded yet.</p>
            )}
            {data.receipts.map((r: any) => (
              <details className="af-record" key={r.id}>
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
                        return act(`/receipts/${r.id}/reverse`, {
                          requestId: crypto.randomUUID(),
                          period: f.get("period"),
                          providerReference: f.get("reference"),
                          evidenceReference: f.get("evidence"),
                        });
                      })}
                    >
                      <fieldset className="af-form" disabled={busy || loading}>
                        <legend>
                          Reverse an incorrect or returned earning
                        </legend>
                        <label className="field">
                          Open reporting month
                          <input required name="period" type="month" />
                        </label>
                        <label className="field">
                          Correction reference
                          <input
                            required
                            name="reference"
                            minLength={5}
                            maxLength={200}
                          />
                        </label>
                        <label className="field">
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
                  return act("/statements", {
                    contractId: f.get("contractId"),
                    period: f.get("period"),
                  });
                })}
              >
                <fieldset className="af-form" disabled={busy || loading}>
                  <label className="field">
                    Agreement
                    <select name="contractId">
                      {data.contracts.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.provider}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
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
            {!data.statements.length && (
              <p className="af-empty">
                No statements yet. Closed statements and their bank evidence
                will appear here.
              </p>
            )}
            {data.statements.map((s: any) => (
              <details className="af-record" key={s.id}>
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
                        return act(`/statements/${s.id}/settle`, {
                          amountMinor: Number(s.amount_minor),
                          bankReference: f.get("bank"),
                          evidenceReference: f.get("evidence"),
                        });
                      })}
                    >
                      <fieldset className="af-form" disabled={busy || loading}>
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
                        <label className="field">
                          Bank / offset reference
                          <input
                            required
                            name="bank"
                            minLength={5}
                            maxLength={200}
                          />
                        </label>
                        <label className="field">
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
    </div>
  );
}
