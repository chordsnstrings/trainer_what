/**
 * Transactional email API double: accepts Bearer-authenticated JSON
 * {from,to,subject,text} like the configured provider contract and keeps an
 * inbox the scenarios can read. Test-only.
 */
import { MockServer, bearer, randomId, unauthorized } from "./http.ts";

export type CapturedEmail = {
  id: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  receivedAt: string;
};

export class EmailMock {
  readonly server: MockServer;
  readonly messages: CapturedEmail[] = [];
  /** Answer the next N sends with this HTTP status (failure drills). */
  failNext: { count: number; status: number } = { count: 0, status: 503 };
  constructor(
    tlsMaterial: { key: string; cert: string },
    public apiKey: string,
  ) {
    this.server = new MockServer("email", tlsMaterial, { logBodies: false });
    this.server.route("POST", "/v1/send", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      if (this.failNext.count > 0) {
        this.failNext.count--;
        return { status: this.failNext.status, body: { error: "mock failure" } };
      }
      const body = r.json ?? {};
      if (
        typeof body.from !== "string" ||
        typeof body.to !== "string" ||
        typeof body.subject !== "string" ||
        typeof body.text !== "string"
      )
        return { status: 422, body: { error: "from, to, subject and text are required" } };
      const message = {
        id: randomId("msg"),
        from: body.from,
        to: body.to.toLowerCase(),
        subject: body.subject,
        text: body.text,
        receivedAt: new Date().toISOString(),
      };
      this.messages.push(message);
      return { status: 202, body: { id: message.id, status: "queued" } };
    });
    this.server.route("GET", "/v1/inbox", (r) => ({
      body: this.inbox(r.query.get("to") ?? undefined),
    }));
  }
  get url() {
    return this.server.url;
  }
  /** The value to save as EMAIL_API_URL. */
  get sendUrl() {
    return this.server.url + "/v1/send";
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
  inbox(to?: string) {
    return this.messages.filter((m) => !to || m.to === to.toLowerCase());
  }
  async waitFor(
    to: string,
    predicate: (m: CapturedEmail) => boolean = () => true,
    timeoutMs = 60000,
    after = 0,
  ): Promise<CapturedEmail> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.inbox(to)
        .slice(after)
        .find(predicate);
      if (hit) return hit;
      if (Date.now() > deadline)
        throw new Error(`No email for ${to} within ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** First URL in a message whose path starts with the given prefix. */
export function linkIn(message: CapturedEmail, pathPrefix: string) {
  for (const match of message.text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = new URL(match[0]);
    if (url.pathname.startsWith(pathPrefix)) return url;
  }
  throw new Error(`No ${pathPrefix} link in "${message.subject}"`);
}
