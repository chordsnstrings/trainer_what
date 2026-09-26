import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import sharp from "sharp";
import { createDatabase, type Database } from "@trainer/db";
import {
  ingestionRoutes,
  extractDocument,
  extractDocumentDetailed,
  privacyMatches,
  redactPersonalData,
  buildSourceEvidence,
  compilationMaterial,
} from "../apps/api/src/ingestion.ts";
const exec = promisify(execFile);
let db: Database;
const app = Fastify({ bodyLimit: 8 * 1024 * 1024 });
const a = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" },
  foreign = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const who of [a, foreign]) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Import fixture','unused')",
        [who.userId, who.userId + "@example.test"],
      );
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1::uuid,$1::uuid::text,'Import fixture')",
        [who.tenantId],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
        [who.tenantId, who.userId],
      );
    }
  });
  app.setErrorHandler((e: any, _r, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  ingestionRoutes(app, db, (req) =>
    req.headers["x-actor"] === "foreign"
      ? foreign
      : req.headers["x-actor"] === "subscriber"
        ? { ...a, role: "subscriber" }
        : a,
  );
});
after(async () => {
  await app.close();
  await db.close();
});
const req = (url: string, method: any = "GET", payload?: any, who = "owner") =>
  app.inject({
    url: "/api/v1/brain" + url,
    method,
    payload,
    headers: { "x-actor": who },
  });
async function archive(entries: Record<string, string>) {
  const { stdout } = await exec("python3", [
    "-c",
    'import io,sys,json,zipfile,base64; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); [z.writestr(k,v) for k,v in json.loads(sys.argv[1]).items()]; z.close(); print(base64.b64encode(b.getvalue()).decode())',
    JSON.stringify(entries),
  ]);
  return Buffer.from(stdout.trim(), "base64");
}
async function xlsx(body: string, extra: Record<string, string> = {}) {
  return archive({
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Program" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>',
    "xl/worksheets/sheet1.xml":
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      body +
      "</sheetData></worksheet>",
    ...extra,
  });
}
test("CSV and XLSX parse actual quoted/literal cells and reject formulas/external links", async () => {
  const csv = await extractDocument(
    "plan.csv",
    Buffer.from(
      'Exercise,Sets,Notes\nSquat,3,"slow, controlled repetitions"\n',
    ),
  );
  assert.match(csv, /slow, controlled repetitions/);
  const sheet = await extractDocument(
    "plan.xlsx",
    await xlsx(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Goblet squat</t></is></c><c r="B1"><v>3</v></c></row>',
    ),
  );
  assert.match(sheet, /A1: Goblet squat/);
  assert.match(sheet, /B1: 3/);
  await assert.rejects(
    extractDocument(
      "formula.xlsx",
      await xlsx('<row><c r="A1"><f>1+1</f><v>2</v></c></row>'),
    ),
    /Formula cells/,
  );
  await assert.rejects(
    extractDocument(
      "formula.csv",
      Buffer.from('Exercise,Sets\n=HYPERLINK("secret"),3\n'),
    ),
  );
  await assert.rejects(
    extractDocument(
      "external.xlsx",
      await xlsx('<row><c r="A1"><v>12345</v></c></row>', {
        "xl/externalLinks/externalLink1.xml": "<externalLink/>",
      }),
    ),
  );
});
test("office archive paths, XML entities and expansion limits are rejected", async () => {
  const doc =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Use a comfortable range.</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(
    await extractDocument(
      "notes.docx",
      await archive({ "word/document.xml": doc }),
    ),
    "Use a comfortable range.",
  );
  await assert.rejects(
    extractDocument(
      "bad.docx",
      await archive({
        "word/document.xml":
          '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + doc,
      }),
    ),
  );
  await assert.rejects(
    extractDocument(
      "bad.docx",
      await archive({
        "word/document.xml": doc,
        "../escape.txt": "never write me",
      }),
    ),
  );
  const entries: Record<string, string> = { "word/document.xml": doc };
  for (let n = 0; n < 513; n++) entries[`extra/${n}`] = "small";
  await assert.rejects(extractDocument("many.docx", await archive(entries)));
});
test("program JSON is validated and cannot smuggle arbitrary executable fields", async () => {
  const program = {
    title: "Strength basics",
    goal: "Build a consistent pain-free routine",
    daysPerWeek: 3,
    exercises: [
      {
        name: "Goblet squat",
        sets: 3,
        reps: 8,
        restSeconds: 90,
        loadKg: 10,
        cue: "Comfortable range",
      },
    ],
  };
  const parsed = await extractDocumentDetailed(
    "plan.json",
    Buffer.from(JSON.stringify(program)),
  );
  assert.equal(parsed.extraction, "program-json-v1");
  assert.match(parsed.text, /3 sets × 8 reps/);
  await assert.rejects(
    extractDocument(
      "bad.json",
      Buffer.from(JSON.stringify({ ...program, script: "execute()" })),
    ),
    /Program JSON/,
  );
  await assert.rejects(
    extractDocument("bad.json", Buffer.from('{"programs":[]}')),
    /Program JSON/,
  );
});
test("local OCR extracts image text, rejects SVG disguise and removes temporary raw files", async () => {
  const before = new Set(
    (await readdir(tmpdir())).filter((n) => n.startsWith("trainer-import-")),
  );
  const png = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="300"><rect width="100%" height="100%" fill="white"/><text x="45" y="130" font-family="DejaVu Sans" font-size="60" fill="black">Use a comfortable range of motion.</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  const result = await extractDocumentDetailed("notes.png", png);
  assert.equal(result.extraction, "local-tesseract-eng-v1");
  assert.match(result.text, /comfortable range of motion/i);
  const jpeg = await sharp(png).jpeg().toBuffer();
  const content = "q 1500 0 0 300 0 0 cm /Im1 Do Q";
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1500 300] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    ),
    Buffer.from(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1500 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
  ];
  const parts = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let length = parts[0].length;
  objects.forEach((object, i) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    length += part.length;
  });
  parts.push(
    Buffer.from(
      "xref\n0 6\n0000000000 65535 f \n" +
        offsets
          .slice(1)
          .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
          .join("") +
        `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`,
    ),
  );
  const scanned = await extractDocumentDetailed(
    "scanned.pdf",
    Buffer.concat(parts),
  );
  assert.equal(scanned.extraction, "pdf-local-ocr-eng-v1");
  assert.match(scanned.text, /comfortable range of motion/i);
  await assert.rejects(
    extractDocument(
      "disguise.png",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
      ),
    ),
    /valid non-animated/,
  );
  const after = (await readdir(tmpdir())).filter(
    (n) => n.startsWith("trainer-import-") && !before.has(n),
  );
  assert.deepEqual(after, []);
});
test("imports remain private until redacted review, and stale reviews cannot overwrite", async () => {
  const body = {
    title: "Private teaching example",
    fileName: "notes.md",
    rights: true,
    contentBase64: Buffer.from(
      "Client: Sample Person\nEmail sample@example.test\nUse conservative progress after consistent repetitions.",
    ).toString("base64"),
  };
  const uploaded = await req("/documents", "POST", body);
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const row = uploaded.json();
  assert.equal(row.kind, "source_import");
  assert.equal(row.status, "needs_review");
  assert.deepEqual(row.data.allowedUses, []);
  assert.ok(row.data.rawDeletedAt);
  assert.equal((await req("/documents", "POST", body)).json().id, row.id);
  assert.equal(
    (await req("/imports", "GET", undefined, "foreign")).json().length,
    0,
  );
  assert.equal(
    (await req("/documents", "POST", body, "subscriber")).statusCode,
    403,
  );
  const approve = {
    revision: row.version,
    title: body.title,
    text: row.data.text,
    rights: true,
    privacyReviewed: true,
  };
  assert.equal(
    (await req(`/imports/${row.id}/review`, "POST", approve)).statusCode,
    400,
  );
  const redacted = await req(`/imports/${row.id}/redact`, "POST", {
    revision: row.version,
  });
  assert.equal(redacted.statusCode, 200, redacted.body);
  assert.equal(privacyMatches(redacted.json().data.text).length, 0);
  assert.equal(
    (
      await req(`/imports/${row.id}/review`, "POST", {
        ...approve,
        text: redacted.json().data.text,
      })
    ).statusCode,
    409,
  );
  const ready = await req(`/imports/${row.id}/review`, "POST", {
    ...approve,
    revision: redacted.json().version,
    text: redacted.json().data.text,
  });
  assert.equal(ready.statusCode, 200, ready.body);
  assert.equal(ready.json().kind, "source");
  assert.equal(ready.json().status, "ready");
  assert.ok(ready.json().data.allowedUses.includes("model_prompt"));
  assert.equal(ready.json().data.text.includes("sample@example.test"), false);
  const [scrubbed] = (await req("/imports")).json();
  assert.equal(scrubbed.data.text, undefined);
  assert.equal(scrubbed.data.privacyMatches, undefined);
});
test("failed imports can retry original bytes and discard deletes extracted personal content", async () => {
  const body = {
    title: "Failed PDF fixture",
    fileName: "broken.pdf",
    rights: true,
    contentBase64: Buffer.from("%PDF-1.4 broken structure").toString("base64"),
  };
  const failed = await req("/documents", "POST", body);
  assert.equal(failed.statusCode, 422, failed.body);
  const r = (await req("/imports"))
    .json()
    .find((r: any) => r.data.title === body.title);
  assert.equal(r.status, "failed");
  assert.equal(r.data.text, undefined);
  const retry = await req("/documents", "POST", { ...body, retryOf: r.id });
  assert.equal(retry.statusCode, 422);
  const current = (await req("/imports"))
    .json()
    .find((row: any) => row.id === r.id);
  assert.ok(current.version > r.version);
  const discard = await req(`/imports/${r.id}`, "DELETE", {
    revision: current.version,
  });
  assert.equal(discard.statusCode, 200, discard.body);
  const stored = (await req("/imports"))
    .json()
    .find((row: any) => row.id === r.id);
  assert.equal(stored.status, "discarded");
  assert.equal(stored.data.error, undefined);
  assert.deepEqual(stored.data.allowedUses, []);
});
test("redaction merges overlapping identifiers and evidence chunks stay bounded", () => {
  const text =
    "Client: Example member +971 50 123 4567\nRepeat controlled breathing between sets.";
  const redacted = redactPersonalData(text);
  assert.equal(
    redacted,
    "[redacted]\nRepeat controlled breathing between sets.",
  );
  assert.equal(privacyMatches(redacted).length, 0);
  const long = "A useful coaching sentence with repeatable evidence. ".repeat(
    1100,
  );
  const evidence = buildSourceEvidence(long);
  assert.ok(evidence.chunks.length <= 40);
  assert.ok(evidence.chunks.every((c) => c.text.length <= 2000));
  assert.equal(evidence.chunks[0].start, 0);
  assert.equal(evidence.chunks.at(-1)!.end, long.trim().length);
});
test("compilation rejects private/archived inputs and strips redundant chunk payloads", () => {
  const source = {
    id: randomUUID(),
    kind: "source",
    status: "ready",
    version: 1,
    data: {
      text: "Use a repeatable coaching progression.",
      allowedUses: ["model_prompt", "trainer_specific_learning"],
      chunks: [{ text: "must not duplicate" }],
      privateNote: "not part of model input",
    },
  };
  const prepared = compilationMaterial([source]);
  assert.equal((prepared[0].data as any).privateNote, undefined);
  assert.equal((prepared[0].data as any).chunks, undefined);
  assert.throws(
    () =>
      compilationMaterial([
        { ...source, kind: "source_import", status: "needs_review" },
      ]),
    /reviewed/,
  );
  assert.throws(
    () => compilationMaterial([{ ...source, status: "archived" }]),
    /reviewed/,
  );
  assert.throws(
    () =>
      compilationMaterial(
        Array.from({ length: 3 }, () => ({
          ...source,
          data: { ...source.data, text: "x".repeat(50000) },
        })),
      ),
    /120,000/,
  );
});
