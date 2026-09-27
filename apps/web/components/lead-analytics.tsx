"use client";

const cell = { overflowWrap: "anywhere" as const };

/** Trainer analytics: website inquiries counted as leads, with consented attribution. */
export function LeadAnalytics({ leads }: { leads: any }) {
  if (!leads) return null;
  return (
    <section className="card" aria-labelledby="lead-analytics-heading">
      <h2 id="lead-analytics-heading">Website inquiries and leads</h2>
      <p className="muted">{leads.note}</p>
      {leads.monthly.length ? (
        <div className="table-wrap">
          <table>
            <caption className="muted" style={{ textAlign: "start" }}>
              Inquiries by month
            </caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Inquiries</th>
                <th scope="col">Handled</th>
                <th scope="col">With source</th>
              </tr>
            </thead>
            <tbody>
              {leads.monthly.map((r: any) => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td>{r.inquiries}</td>
                  <td>{r.handled}</td>
                  <td>{r.attributed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          No website inquiries yet. Inquiries arrive once your website is
          published.
        </p>
      )}
      {leads.sources.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="muted" style={{ textAlign: "start" }}>
              Lead sources, last 90 days
            </caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Campaign</th>
                <th scope="col">Medium</th>
                <th scope="col">Referral</th>
                <th scope="col">Leads</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {leads.sources.map((r: any, i: number) => (
                <tr key={i}>
                  <td style={cell}>
                    {r.outside ? "Other platform pages" : r.source}
                  </td>
                  <td style={cell}>{r.campaign || "—"}</td>
                  <td style={cell}>{r.medium || "—"}</td>
                  <td style={cell}>{r.referral || "—"}</td>
                  <td>{r.leads}</td>
                  <td>{r.joined}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Inquiry inbox: where a consenting visitor came from. */
export function InquirySource({ attribution }: { attribution: any }) {
  if (!attribution)
    return (
      <small className="muted" style={{ display: "block" }}>
        Source not recorded (the visitor did not allow optional analytics).
      </small>
    );
  if (attribution.outside)
    return (
      <small className="muted" style={{ display: "block" }}>
        Source not recorded: no tagged visit to your own website pages.
      </small>
    );
  const parts = [
    `Source: ${attribution.source}`,
    attribution.campaign && `campaign ${attribution.campaign}`,
    attribution.medium && `medium ${attribution.medium}`,
    attribution.referral && `referral ${attribution.referral}`,
    attribution.lastSource &&
      attribution.lastSource !== attribution.source &&
      `latest visit via ${attribution.lastSource}`,
  ].filter(Boolean);
  return (
    <small className="muted" style={{ display: "block", ...cell }}>
      {parts.join(" · ")}
    </small>
  );
}
