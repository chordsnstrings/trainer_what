/**
 * Minimal HTTPS mock server used by every provider double. Plain node:https,
 * no dependencies. Each server keeps a request log so scenarios can assert
 * what the application actually sent.
 */
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type MockRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  rawBody: string;
  params: Record<string, string>;
  /** Parsed JSON body, or undefined. */
  json?: any;
  /** Parsed application/x-www-form-urlencoded body with bracket nesting (Stripe style). */
  form?: any;
};
export type MockResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};
export type Handler = (
  request: MockRequest,
) => MockResponse | Promise<MockResponse>;
export type LoggedRequest = {
  at: string;
  method: string;
  path: string;
  query: string;
  status: number;
  body?: unknown;
  headers: Record<string, string>;
};

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

/** Stripe/qs style: a[b][0][c]=1 → {a:{b:[{c:"1"}]}}. Numeric keys build arrays. */
export function parseNestedForm(text: string): any {
  const root: any = {};
  for (const [rawKey, value] of new URLSearchParams(text)) {
    const parts = rawKey
      .replace(/\]/g, "")
      .split("[")
      .map((part) => part);
    let node = root;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      const nextIsIndex = !last && /^\d*$/.test(parts[index + 1]);
      const key: string | number =
        Array.isArray(node) && /^\d*$/.test(part)
          ? part === ""
            ? node.length
            : Number(part)
          : part;
      if (last) {
        node[key as any] = value;
        return;
      }
      if (node[key as any] === undefined)
        node[key as any] = nextIsIndex ? [] : {};
      node = node[key as any];
    });
  }
  return root;
}

export class MockServer {
  readonly name: string;
  readonly log: LoggedRequest[] = [];
  private routes: Route[] = [];
  private server?: Server;
  url = "";
  constructor(
    name: string,
    private tlsMaterial: { key: string; cert: string },
    private options: { logBodies?: boolean } = {},
  ) {
    this.name = name;
  }
  route(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_, key) => {
          keys.push(key);
          return "([^/]+)";
        }) +
        "$",
    );
    this.routes.push({ method: method.toUpperCase(), pattern, keys, handler });
    return this;
  }
  async start(port = 0): Promise<string> {
    this.server = createServer(
      { key: this.tlsMaterial.key, cert: this.tlsMaterial.cert },
      (req, res) => void this.handle(req, res),
    );
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => resolve());
    });
    const address = this.server.address() as AddressInfo;
    this.url = `https://127.0.0.1:${address.port}`;
    return this.url;
  }
  async stop() {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
      this.server!.closeAllConnections?.();
    });
    this.server = undefined;
  }
  requests(method?: string, pathPrefix?: string) {
    return this.log.filter(
      (entry) =>
        (!method || entry.method === method.toUpperCase()) &&
        (!pathPrefix || entry.path.startsWith(pathPrefix)),
    );
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "https://mock.invalid");
    const type = String(req.headers["content-type"] ?? "");
    const request: MockRequest = {
      method: (req.method ?? "GET").toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      rawBody,
      params: {},
    };
    if (rawBody && type.includes("json"))
      try {
        request.json = JSON.parse(rawBody);
      } catch {}
    if (type.includes("x-www-form-urlencoded"))
      request.form = parseNestedForm(rawBody);
    if (request.method === "GET" && !rawBody && url.search)
      request.form = parseNestedForm(url.search.slice(1));
    let response: MockResponse;
    try {
      const route = this.routes.find(
        (r) => r.method === request.method && r.pattern.test(request.path),
      );
      if (!route) response = { status: 404, body: { error: "mock route not found" } };
      else {
        const match = route.pattern.exec(request.path)!;
        route.keys.forEach(
          (key, i) => (request.params[key] = decodeURIComponent(match[i + 1])),
        );
        response = await route.handler(request);
      }
    } catch (error) {
      response = {
        status: 500,
        body: { error: { message: (error as Error).message } },
      };
    }
    const status = response.status ?? 200;
    this.log.push({
      at: new Date().toISOString(),
      method: request.method,
      path: request.path,
      query: url.search,
      status,
      headers: Object.fromEntries(
        Object.entries(req.headers)
          .filter(([key]) => !["authorization", "xi-api-key"].includes(key))
          .map(([key, value]) => [key, String(value)]),
      ),
      ...(this.options.logBodies !== false
        ? { body: request.json ?? request.form ?? (rawBody || undefined) }
        : {}),
    });
    const body = response.body;
    const headers = { ...(response.headers ?? {}) };
    let payload: Buffer | string | undefined;
    if (Buffer.isBuffer(body)) payload = body;
    else if (typeof body === "string") payload = body;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["content-type"] ??= "application/json";
    }
    res.writeHead(status, headers);
    res.end(payload);
  }
}

export const bearer = (req: MockRequest) =>
  String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
export const unauthorized = (message = "Invalid API key"): MockResponse => ({
  status: 401,
  body: { error: { message, type: "invalid_request_error" } },
});
export function randomId(prefix: string) {
  return (
    prefix +
    "_" +
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(36).padStart(2, "0"),
    )
      .join("")
      .slice(0, 24)
  );
}
