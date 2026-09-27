/**
 * Lean payouts double for the two calls the LeanGateway adapter makes:
 * destination creation and payment initiation, both idempotent by key.
 * Bank finality is never simulated as automatic; scenarios record outcomes
 * through the application's operator reconciliation routes. Test-only.
 */
import { MockServer, bearer, randomId, unauthorized } from "./http.ts";

type Obj = Record<string, any>;
export class LeanMock {
  readonly server: MockServer;
  destinations = new Map<string, Obj>();
  payments = new Map<string, Obj>();
  private replay = new Map<string, Obj>();
  constructor(
    tlsMaterial: { key: string; cert: string },
    public accessToken: string,
    public sourceAccountId: string,
  ) {
    this.server = new MockServer("lean", tlsMaterial);
    const idempotent = (key: unknown, create: () => Obj) => {
      if (typeof key === "string" && this.replay.has(key))
        return this.replay.get(key)!;
      const value = create();
      if (typeof key === "string") this.replay.set(key, value);
      return value;
    };
    this.server.route("POST", "/payouts/v1/payment/destinations", (r) => {
      if (bearer(r) !== this.accessToken) return unauthorized();
      const b = r.json ?? {};
      const iban = String(b.iban ?? "");
      if (b.country !== "ARE" || !/^AE\d{21}$/.test(iban) || !b.name)
        return { status: 422, body: { error: "invalid destination" } };
      const destination = idempotent(r.headers["idempotency-key"], () => {
        const value = {
          id: randomId("dest"),
          status: "PENDING_VERIFICATION",
          name: b.name,
          iban_last4: iban.slice(-4),
          city: b.city,
          country: b.country,
          created_at: new Date().toISOString(),
        };
        this.destinations.set(value.id, value);
        return value;
      });
      return { status: 201, body: destination };
    });
    this.server.route("POST", "/payouts/v1/payment", (r) => {
      if (bearer(r) !== this.accessToken) return unauthorized();
      const b = r.json ?? {};
      if (b.source_account_id !== this.sourceAccountId)
        return { status: 403, body: { error: "unknown source account" } };
      if (!this.destinations.has(b.destination_id))
        return { status: 404, body: { error: "unknown destination" } };
      if (b.currency !== "AED" || !(Number(b.amount) > 0))
        return { status: 422, body: { error: "invalid amount" } };
      const payment = idempotent(r.headers["idempotency-key"], () => {
        const value = {
          id: randomId("pay"),
          status: "AWAITING_AUTHORIZATION",
          amount: Number(b.amount),
          currency: b.currency,
          destination_id: b.destination_id,
          description: b.description,
          idempotency_key: r.headers["idempotency-key"],
          created_at: new Date().toISOString(),
        };
        this.payments.set(value.id, value);
        return value;
      });
      return { status: 201, body: payment };
    });
    this.server.route("GET", "/payouts/v1/payment/:id", (r) => {
      if (bearer(r) !== this.accessToken) return unauthorized();
      const payment = this.payments.get(r.params.id);
      return payment ? { body: payment } : { status: 404, body: { error: "not found" } };
    });
  }
  get url() {
    return this.server.url;
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
}
