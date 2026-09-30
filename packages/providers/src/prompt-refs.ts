/**
 * Short, stable references for the identifiers in one model request.
 *
 * Models miscopy 36-character UUIDs: in the September 2026 model trial one
 * model dropped, added or truncated characters in coaching, plan and meal-plan
 * replies, and cited well-formed IDs one character away from the real rule, so
 * correct answers failed the evidence checks. A reference such as `R3` is short
 * enough to copy exactly.
 *
 * Use one table per request:
 *
 * 1. `createPromptRefs(payload, options)` replaces every UUID in the payload
 *    (object keys, values and text inside strings) with a reference and keeps
 *    the table. Send `refs.payload`, never the original.
 * 2. `refs.decode(output, { idKeys })` maps the model's answer back: refs and
 *    the original full UUIDs become the original IDs. Anything that names an
 *    identifier this request did not show is reported in `unknown`/`issues`
 *    and left unchanged, so callers can reject it. Nothing is guessed.
 *
 * References are only meaningful inside the request that issued them; never
 * store them. See docs/features/prompt-refs.md.
 */

/** A JSON value, as sent to or received from a model. */
export type PromptJson =
  | string
  | number
  | boolean
  | null
  | PromptJson[]
  | { [key: string]: PromptJson };

/** Where a value sits: property names and array indexes from the root. */
export type PromptRefPath = ReadonlyArray<string | number>;

/** Identifiers that share a reference prefix, numbered in the listed order. */
export interface PromptRefKind {
  /** One to four upper-case letters, for example `"R"` for rules. */
  prefix: string;
  /** UUIDs of this kind. Only the ones that occur in the payload get a reference. */
  ids: Iterable<string>;
}

export interface PromptRefsOptions {
  /**
   * Explicit kinds. Their identifiers are numbered first, in list order, so
   * `R1` is the first listed rule that appears in the payload.
   */
  kinds?: readonly PromptRefKind[];
  /**
   * Prefix for an identifier that no kind lists, chosen from where the walk
   * first met it (for a UUID inside an object key, the path of that
   * property). Return `undefined` for `defaultPrefix`.
   */
  prefixAt?: (path: PromptRefPath, id: string) => string | undefined;
  /** Prefix for every other identifier. Defaults to `"ID"`. */
  defaultPrefix?: string;
}

/**
 * One issued reference. Identifiers are compared without regard to letter
 * case: every spelling of one UUID shares a reference.
 */
export interface PromptRefEntry {
  ref: string;
  /** The identifier as the caller wrote it (the kind's spelling, else the payload's first). */
  id: string;
  prefix: string;
}

/**
 * - `unknown_ref`: shaped like one of this request's references (a known
 *   prefix and a number) but never issued.
 * - `unknown_uuid`: a well-formed UUID that the request did not contain.
 * - `malformed_uuid`: UUID-like text that is not a valid UUID (a miscopy).
 * - `not_a_reference`: a value in an `idKeys` field that is neither.
 * - `duplicate_key`: two object keys decode to the same key; the first is kept.
 */
export type PromptRefIssueReason =
  | "unknown_ref"
  | "unknown_uuid"
  | "malformed_uuid"
  | "not_a_reference"
  | "duplicate_key";

export interface PromptRefIssue {
  path: Array<string | number>;
  /** The text the model wrote (trimmed for a whole `idKeys` value). */
  token: string;
  reason: PromptRefIssueReason;
}

export interface PromptRefDecoded<T> {
  /** A copy with every recognised reference or UUID replaced by the original ID. */
  value: T;
  /** No issues: every identifier the output names was in this request. */
  ok: boolean;
  /** Distinct unrecognised identifier tokens, in the order they were met. */
  unknown: string[];
  issues: PromptRefIssue[];
}

export interface PromptRefDecodeOptions {
  /**
   * Property names (at any depth) whose value must be an identifier or a list
   * of identifiers, such as `evidenceIds` or `recipeId`. There, a value is
   * trimmed and must resolve; anything else is reported as an issue.
   * `null` stays `null`.
   */
  idKeys?: Iterable<string>;
  /**
   * Also decode references and UUIDs inside longer text (default `true`).
   * With `false`, a string outside `idKeys` is decoded only when it is
   * exactly one reference or UUID; other text (for example a message shown
   * to a subscriber) is returned exactly as written and not checked.
   */
  inText?: boolean;
}

/**
 * A sentence for a system prompt of a request whose payload was encoded. A
 * prompt that changes should also change its prompt version.
 */
export const promptRefsInstruction =
  "Identifiers in the input are short references such as R1 or A2. Wherever an ID is asked for, use one of these references exactly as written. Never invent, shorten or alter one.";

const ALNUM = "0-9A-Za-z";
const HEX = "[0-9A-Fa-f]";
// A UUID counts only where it is not glued to a letter or digit; the same
// boundary applies to references, so a reference that replaces a UUID is
// always found again.
const UUID_TEXT = new RegExp(
  `(?<![${ALNUM}])${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}(?![${ALNUM}])`,
  "g",
);
const UUID_EXACT = new RegExp(
  `^${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}$`,
);
// A dash-separated hex run (4 to 6 groups) or a letters-then-digits token.
const RUN_OR_REF = new RegExp(
  `(?<![${ALNUM}])(?:(${HEX}+(?:-${HEX}+){3,5})|[A-Za-z]+[0-9]+)(?![${ALNUM}])`,
  "g",
);
const REF_TEXT = new RegExp(
  `(?<![${ALNUM}])[A-Za-z]+[0-9]+(?![${ALNUM}])`,
  "g",
);
const REF_EXACT = /^([A-Za-z]+)[0-9]+$/;
const RUN_EXACT = new RegExp(`^${HEX}+(?:-${HEX}+){3,5}$`);
const PREFIX = /^[A-Z]{1,4}$/;

/** A hex run that reads as a damaged UUID: 24 to 40 hex digits including a letter. */
function uuidLike(run: string) {
  const hex = run.replace(/-/g, "");
  return hex.length >= 24 && hex.length <= 40 && /[a-f]/i.test(hex);
}

interface Token {
  kind: "uuid" | "run" | "ref";
  text: string;
  start: number;
  end: number;
}
/** Identifier-shaped tokens of a string, left to right, never overlapping. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const segment = (from: number, to: number) => {
    // Segment edges sit next to a UUID's non-alphanumeric boundary, so the
    // look-arounds see the same neighbours as in the whole string.
    for (const m of text.slice(from, to).matchAll(RUN_OR_REF)) {
      const start = from + m.index!;
      if (m[1] === undefined)
        tokens.push({
          kind: "ref",
          text: m[0],
          start,
          end: start + m[0].length,
        });
      else if (uuidLike(m[1]))
        tokens.push({
          kind: "run",
          text: m[1],
          start,
          end: start + m[1].length,
        });
      else
        for (const r of m[1].matchAll(REF_TEXT))
          tokens.push({
            kind: "ref",
            text: r[0],
            start: start + r.index!,
            end: start + r.index! + r[0].length,
          });
    }
  };
  let last = 0;
  for (const m of text.matchAll(UUID_TEXT)) {
    segment(last, m.index!);
    tokens.push({
      kind: "uuid",
      text: m[0],
      start: m.index!,
      end: m.index! + m[0].length,
    });
    last = m.index! + m[0].length;
  }
  segment(last, text.length);
  return tokens;
}

interface DecodeContext {
  idKeys: ReadonlySet<string>;
  inText: boolean;
  issues: PromptRefIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
/** Sets an own property, including `__proto__`, without touching prototypes. */
function define(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
/** The value with every UUID in lower case, for comparing spellings of one identifier. */
function foldUuids(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(UUID_TEXT, (m) => m.toLowerCase());
  if (Array.isArray(value)) return value.map(foldUuids);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [foldUuids(k), foldUuids(v)]),
    );
  return value;
}
function describe(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value !== null && typeof value === "object")
    return (JSON.stringify(value) ?? "").slice(0, 80);
  return String(value);
}
function checkPrefix(prefix: unknown, where: string): string {
  if (typeof prefix !== "string" || !PREFIX.test(prefix))
    throw new TypeError(
      `${where} must be one to four upper-case letters, got ${JSON.stringify(prefix)}`,
    );
  return prefix;
}

/**
 * The reference table of one model request. Build it with
 * {@link createPromptRefs}; it is immutable once built.
 */
export class PromptRefs {
  /**
   * The payload to send: the JSON form of the input (what `JSON.stringify`
   * sends) with every UUID replaced by its reference. `undefined` when the
   * input has no JSON form.
   */
  readonly payload: PromptJson | undefined;
  readonly #entries: PromptRefEntry[] = [];
  /** "R1" -> original ID. */
  readonly #idByRef = new Map<string, string>();
  /** lower-case UUID -> "R1". */
  readonly #refByKey = new Map<string, string>();
  /** lower-case UUID -> original ID. */
  readonly #idByKey = new Map<string, string>();
  readonly #prefixes = new Set<string>();
  /** Reference-shaped tokens already in the payload (upper case): never issued, never flagged. */
  readonly #literalRefs = new Set<string>();
  /** UUID-like runs already in the encoded payload (lower case): never flagged. */
  readonly #literalRuns = new Set<string>();

  constructor(payload: unknown, options: PromptRefsOptions = {}) {
    const defaultPrefix = checkPrefix(
      options.defaultPrefix ?? "ID",
      "defaultPrefix",
    );
    this.#prefixes.add(defaultPrefix);
    const listed = new Map<string, { id: string; prefix: string }>();
    for (const kind of options.kinds ?? []) {
      const prefix = checkPrefix(kind.prefix, "A kind prefix");
      this.#prefixes.add(prefix);
      for (const id of kind.ids) {
        if (typeof id !== "string" || !UUID_EXACT.test(id))
          throw new TypeError(
            `Kind ${prefix} lists ${JSON.stringify(id)}, which is not a UUID`,
          );
        const key = id.toLowerCase();
        const known = listed.get(key);
        if (known && known.prefix !== prefix)
          throw new TypeError(
            `${id} is listed under both ${known.prefix} and ${prefix}`,
          );
        if (!known) listed.set(key, { id, prefix });
      }
    }

    const text = JSON.stringify(payload);
    const json: PromptJson | undefined =
      text === undefined ? undefined : JSON.parse(text);

    // Pass 1: every UUID in walk order with where it was first met, and the
    // reference-shaped text the payload already contains.
    const found = new Map<string, { id: string; path: PromptRefPath }>();
    const scan = (value: string, path: PromptRefPath) => {
      for (const t of tokenize(value)) {
        if (t.kind === "uuid") {
          const key = t.text.toLowerCase();
          if (!found.has(key)) found.set(key, { id: t.text, path });
        } else if (t.kind === "ref")
          this.#literalRefs.add(t.text.toUpperCase());
      }
    };
    const walk = (
      value: PromptJson | undefined,
      path: Array<string | number>,
    ) => {
      if (typeof value === "string") scan(value, path);
      else if (Array.isArray(value))
        value.forEach((v, i) => walk(v, [...path, i]));
      else if (value !== null && typeof value === "object")
        for (const [key, v] of Object.entries(value)) {
          scan(key, [...path, key]);
          walk(v, [...path, key]);
        }
    };
    walk(json, []);

    // Numbering: listed kinds first (list order), then the rest in walk order.
    // A number whose reference already appears as text in the payload is
    // skipped, so every reference in the encoded payload was issued here.
    const counters = new Map<string, number>();
    const issue = (key: string, id: string, prefix: string) => {
      let n = counters.get(prefix) ?? 0;
      do n++;
      while (this.#literalRefs.has(prefix + n));
      counters.set(prefix, n);
      const ref = prefix + n;
      this.#entries.push({ ref, id, prefix });
      this.#idByRef.set(ref, id);
      this.#refByKey.set(key, ref);
      this.#idByKey.set(key, id);
    };
    for (const [key, { id, prefix }] of listed)
      if (found.has(key)) issue(key, id, prefix);
    for (const [key, { id, path }] of found) {
      if (this.#refByKey.has(key)) continue;
      const chosen = options.prefixAt?.(path, id);
      const prefix =
        chosen === undefined
          ? defaultPrefix
          : checkPrefix(chosen, "prefixAt's result");
      this.#prefixes.add(prefix);
      issue(key, id, prefix);
    }

    // Pass 2: rebuild with references.
    let mergedKeys = false;
    const encodeText = (value: string) =>
      value.replace(UUID_TEXT, (m) => this.#refByKey.get(m.toLowerCase())!);
    const encode = (value: PromptJson | undefined): PromptJson | undefined => {
      if (typeof value === "string") {
        const encoded = encodeText(value);
        for (const t of tokenize(encoded))
          if (t.kind === "run") this.#literalRuns.add(t.text.toLowerCase());
        return encoded;
      }
      if (Array.isArray(value))
        return value.map((v) => encode(v) as PromptJson);
      if (value !== null && typeof value === "object") {
        const out: Record<string, PromptJson> = {};
        for (const [key, v] of Object.entries(value)) {
          const encodedKey = encode(key) as string;
          // Keys naming one UUID in two letter cases would merge.
          if (Object.hasOwn(out, encodedKey)) mergedKeys = true;
          define(out, encodedKey, encode(v));
        }
        return out;
      }
      return value;
    };
    this.payload = encode(json);

    // Every request is proven reversible before it can be sent: decoding the
    // encoded payload must give back the original, with no issues. The only
    // allowed difference is a UUID's letter case: one identifier, one spelling.
    const back = this.decode(this.payload);
    if (
      mergedKeys ||
      !back.ok ||
      JSON.stringify(foldUuids(back.value)) !== JSON.stringify(foldUuids(json))
    )
      throw Object.assign(
        new Error(
          "The model request could not be given unambiguous identifier references; nothing has been sent.",
        ),
        { statusCode: 409, code: "PROMPT_REFS_UNSAFE" },
      );
  }

  /** Number of issued references. */
  get size() {
    return this.#entries.length;
  }

  /** Issued references in numbering order (listed kinds first, then walk order). */
  entries(): PromptRefEntry[] {
    return this.#entries.map((e) => ({ ...e }));
  }

  /** The reference issued for an ID (any letter case), if it was in the payload. */
  refOf(id: string): string | undefined {
    return this.#refByKey.get(id.trim().toLowerCase());
  }

  /**
   * One identifier from model output: an issued reference or the original
   * full UUID, in any letter case and with surrounding whitespace. Returns
   * the original ID, or `undefined` for anything else (including a
   * reference-shaped token that only appeared as text).
   */
  resolve(token: unknown): string | undefined {
    if (typeof token !== "string") return undefined;
    const t = token.trim();
    return UUID_EXACT.test(t)
      ? this.#idByKey.get(t.toLowerCase())
      : this.#idByRef.get(t.toUpperCase());
  }

  /** A list of identifiers, in order. Unresolvable entries are left out of `ids` and listed in `unknown`. */
  resolveAll(tokens: readonly unknown[]): { ids: string[]; unknown: string[] } {
    const ids: string[] = [];
    const unknown: string[] = [];
    for (const token of tokens) {
      const id = this.resolve(token);
      if (id === undefined) unknown.push(describe(token));
      else ids.push(id);
    }
    return { ids, unknown };
  }

  /**
   * Maps model output back to original IDs: a single string, a list, or any
   * nested object (keys included). Inside text, a reference or UUID is
   * replaced where it stands and the rest of the text is unchanged. Fields
   * named in `idKeys` are resolved strictly (see {@link PromptRefDecodeOptions}).
   * Unrecognised identifiers are reported, never replaced or guessed.
   */
  decode<T>(
    value: T,
    options: PromptRefDecodeOptions = {},
  ): PromptRefDecoded<T> {
    const ctx: DecodeContext = {
      idKeys: new Set(options.idKeys ?? []),
      inText: options.inText ?? true,
      issues: [],
    };
    const issues = ctx.issues;
    const decoded = this.#decodeValue(value, [], ctx) as T;
    const unknown = [
      ...new Set(
        issues.filter((i) => i.reason !== "duplicate_key").map((i) => i.token),
      ),
    ];
    return { value: decoded, ok: issues.length === 0, unknown, issues };
  }

  #decodeValue(
    value: unknown,
    path: Array<string | number>,
    ctx: DecodeContext,
  ): unknown {
    if (typeof value === "string") return this.#decodeText(value, path, ctx);
    if (Array.isArray(value))
      return value.map((v, i) => this.#decodeValue(v, [...path, i], ctx));
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const at = [...path, key];
      const decodedKey = this.#decodeText(key, at, ctx);
      const decoded = ctx.idKeys.has(key)
        ? this.#decodeIdField(v, at, ctx.issues)
        : this.#decodeValue(v, at, ctx);
      if (Object.hasOwn(out, decodedKey))
        ctx.issues.push({ path: at, token: key, reason: "duplicate_key" });
      else define(out, decodedKey, decoded);
    }
    return out;
  }

  #decodeIdField(
    value: unknown,
    path: Array<string | number>,
    issues: PromptRefIssue[],
  ) {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return this.#decodeId(value, path, issues);
    if (Array.isArray(value))
      return value.map((v, i) => {
        if (typeof v === "string")
          return this.#decodeId(v, [...path, i], issues);
        issues.push({
          path: [...path, i],
          token: describe(v),
          reason: "not_a_reference",
        });
        return v;
      });
    issues.push({ path, token: describe(value), reason: "not_a_reference" });
    return value;
  }

  #decodeId(
    value: string,
    path: Array<string | number>,
    issues: PromptRefIssue[],
  ) {
    const id = this.resolve(value);
    if (id !== undefined) return id;
    const token = value.trim();
    const reason: PromptRefIssueReason = UUID_EXACT.test(token)
      ? "unknown_uuid"
      : RUN_EXACT.test(token) && uuidLike(token)
        ? "malformed_uuid"
        : REF_EXACT.test(token)
          ? "unknown_ref"
          : "not_a_reference";
    issues.push({ path, token, reason });
    return value;
  }

  #decodeText(value: string, path: Array<string | number>, ctx: DecodeContext) {
    const tokens = tokenize(value);
    if (!tokens.length) return value;
    if (!ctx.inText) {
      const [only] = tokens;
      return tokens.length === 1 &&
        only.start === 0 &&
        only.end === value.length
        ? this.#decodeToken(only, path, ctx.issues)
        : value;
    }
    let out = "";
    let last = 0;
    for (const t of tokens) {
      out +=
        value.slice(last, t.start) + this.#decodeToken(t, path, ctx.issues);
      last = t.end;
    }
    return out + value.slice(last);
  }

  #decodeToken(
    t: Token,
    path: Array<string | number>,
    issues: PromptRefIssue[],
  ) {
    if (t.kind === "uuid") {
      const id = this.#idByKey.get(t.text.toLowerCase());
      if (id !== undefined) return id;
      issues.push({ path, token: t.text, reason: "unknown_uuid" });
    } else if (t.kind === "run") {
      if (!this.#literalRuns.has(t.text.toLowerCase()))
        issues.push({ path, token: t.text, reason: "malformed_uuid" });
    } else {
      const upper = t.text.toUpperCase();
      const id = this.#idByRef.get(upper);
      if (id !== undefined) return id;
      if (
        this.#prefixes.has(REF_EXACT.exec(upper)![1]) &&
        !this.#literalRefs.has(upper)
      )
        issues.push({ path, token: t.text, reason: "unknown_ref" });
    }
    return t.text;
  }
}

/**
 * Builds the reference table for one model request and encodes its payload.
 *
 * ```ts
 * const refs = createPromptRefs(
 *   { rules, actions },
 *   { kinds: [{ prefix: "A", ids: actions.map((a) => a.id) }, { prefix: "R", ids: rules.map((r) => r.id) }] },
 * );
 * send(JSON.stringify(refs.payload));
 * const { value, ok, unknown } = refs.decode(JSON.parse(reply), { idKeys: ["actionId", "evidenceIds"] });
 * if (!ok) throw new ModelOutputInvalid(); // route to the trainer; nothing is guessed
 * ```
 *
 * Numbering is deterministic: listed kinds first in list order, then the
 * remaining UUIDs in the order a depth-first walk meets them (object keys in
 * insertion order, each key before its value, arrays by index). Per-prefix
 * numbers start at 1 and skip any reference that already appears as text in
 * the payload. Throws a `TypeError` for invalid options, and an error with
 * code `PROMPT_REFS_UNSAFE` (nothing sent) if the encoded payload would not
 * decode back to the original exactly.
 */
export function createPromptRefs(
  payload: unknown,
  options: PromptRefsOptions = {},
) {
  return new PromptRefs(payload, options);
}
