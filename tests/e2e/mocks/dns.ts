/**
 * Loopback DNS double for custom coach domains (UDP, RFC 1035 subset). It
 * answers A, AAAA, NS, DS, TXT and CNAME questions from an in-memory zone
 * (NS as a resolver would report a delegation) the scenarios
 * fill the way an operator would at the registrar (ownership TXT record,
 * CNAME to the platform target, address of the local TLS edge). Unknown
 * names get NXDOMAIN. The application reaches it only through the
 * sandbox-only DOMAIN_DNS_SERVER override. Test tooling only.
 */
import { createSocket, type Socket } from "node:dgram";

// NS carries the delegation a registrar double publishes (checked by the
// delegation step); AAAA and DS let scenarios show IPv6 and DNSSEC problems.
const TYPES = { A: 1, NS: 2, CNAME: 5, TXT: 16, AAAA: 28, DS: 43 } as const;
function ipv6Bytes(value: string) {
  const [head, tail = ""] = value.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = value.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  const out = Buffer.alloc(16);
  groups.slice(0, 8).forEach((g, i) => out.writeUInt16BE(parseInt(g || "0", 16), i * 2));
  return out;
}
type RecordType = keyof typeof TYPES;
export type DnsQuery = { at: string; name: string; type: string; answered: number; rcode: number };

function readName(message: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let position = offset;
  for (let guard = 0; guard < 128; guard++) {
    const length = message[position];
    if (length === undefined) throw new Error("truncated name");
    if (length === 0) return { name: labels.join(".").toLowerCase(), next: position + 1 };
    if ((length & 0xc0) === 0xc0) throw new Error("compressed question names are not expected");
    labels.push(message.subarray(position + 1, position + 1 + length).toString("ascii"));
    position += 1 + length;
  }
  throw new Error("name too long");
}
function encodeName(name: string) {
  const parts = name.replace(/\.$/, "").split(".").filter(Boolean);
  return Buffer.concat([
    ...parts.map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, "ascii")])),
    Buffer.from([0]),
  ]);
}
function rdata(type: RecordType, value: string) {
  if (type === "A") return Buffer.from(value.split(".").map(Number));
  if (type === "CNAME" || type === "NS") return encodeName(value);
  if (type === "AAAA") return ipv6Bytes(value);
  if (type === "DS") {
    // "<key tag> <algorithm> <digest type> <hex digest>"
    const [tag, algorithm, digestType, digest = ""] = value.split(/\s+/);
    const fixed = Buffer.alloc(4);
    fixed.writeUInt16BE(Number(tag) & 0xffff, 0);
    fixed.writeUInt8(Number(algorithm) & 0xff, 2);
    fixed.writeUInt8(Number(digestType) & 0xff, 3);
    return Buffer.concat([fixed, Buffer.from(digest, "hex")]);
  }
  const chunks: Buffer[] = [];
  for (let i = 0; i < value.length || i === 0; i += 255) {
    const piece = Buffer.from(value.slice(i, i + 255), "utf8");
    chunks.push(Buffer.from([piece.length]), piece);
    if (!value.length) break;
  }
  return Buffer.concat(chunks);
}

export class DnsMock {
  private socket?: Socket;
  private zone = new Map<string, Array<{ type: RecordType; value: string }>>();
  readonly queries: DnsQuery[] = [];
  port = 0;
  get server() {
    return `127.0.0.1:${this.port}`;
  }
  /** Replaces every record of one type for a name. */
  set(name: string, type: RecordType, values: string[]) {
    const key = name.toLowerCase().replace(/\.$/, "");
    const kept = (this.zone.get(key) ?? []).filter((r) => r.type !== type);
    this.zone.set(key, [...kept, ...values.map((value) => ({ type, value }))]);
  }
  remove(name: string) {
    this.zone.delete(name.toLowerCase().replace(/\.$/, ""));
  }
  records(name: string) {
    return this.zone.get(name.toLowerCase()) ?? [];
  }
  answer(message: Buffer): Buffer {
    const id = message.readUInt16BE(0);
    const flags = message.readUInt16BE(2);
    const { name, next } = readName(message, 12);
    const qtype = message.readUInt16BE(next);
    const question = message.subarray(12, next + 4);
    const entries = this.zone.get(name);
    const type = (Object.keys(TYPES) as RecordType[]).find((k) => TYPES[k] === qtype);
    // Answers: [owner name, record]. An A question for an alias answers the
    // CNAME and the target's addresses, as a recursive resolver would.
    const answers: Array<[string, { type: RecordType; value: string }]> = [];
    if (entries && type) {
      for (const record of entries.filter((r) => r.type === type)) answers.push([name, record]);
      const alias = entries.find((r) => r.type === "CNAME");
      if (type === "A" && !answers.length && alias) {
        answers.push([name, alias]);
        const target = alias.value.toLowerCase().replace(/\.$/, "");
        for (const record of (this.zone.get(target) ?? []).filter((r) => r.type === "A")) answers.push([target, record]);
      }
    }
    const rcode = entries ? 0 : 3; // NXDOMAIN for names outside the zone
    const header = Buffer.alloc(12);
    header.writeUInt16BE(id, 0);
    // QR, AA, RD copied from the question, RA.
    header.writeUInt16BE(0x8000 | 0x0400 | (flags & 0x0100) | 0x0080 | rcode, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(answers.length, 6);
    const records = answers.map(([owner, record]) => {
      const data = rdata(record.type, record.value);
      const ownerName = owner === name ? Buffer.from([0xc0, 0x0c]) : encodeName(owner);
      const fixed = Buffer.alloc(10);
      fixed.writeUInt16BE(TYPES[record.type], 0);
      fixed.writeUInt16BE(1, 2); // IN
      fixed.writeUInt32BE(5, 4); // short TTL
      fixed.writeUInt16BE(data.length, 8);
      return Buffer.concat([ownerName, fixed, data]);
    });
    this.queries.push({ at: new Date().toISOString(), name, type: type ?? String(qtype), answered: answers.length, rcode });
    return Buffer.concat([header, question, ...records]);
  }
  async start() {
    const socket = createSocket("udp4");
    socket.on("message", (message, remote) => {
      try {
        socket.send(this.answer(message), remote.port, remote.address);
      } catch {
        // Malformed questions are dropped, as a resolver would time out.
      }
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, "127.0.0.1", () => resolve());
    });
    this.port = socket.address().port;
    this.socket = socket;
  }
  async stop() {
    await new Promise<void>((resolve) => (this.socket ? this.socket.close(() => resolve()) : resolve()));
    this.socket = undefined;
  }
}
