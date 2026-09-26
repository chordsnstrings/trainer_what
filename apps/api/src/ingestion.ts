import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, putRecord, event } from "@trainer/db";
import { programSchema } from "@trainer/domain";
import { z } from "zod";
const execute = promisify(execFile);
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const supported = [
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".pdf",
  ".docx",
  ".xlsx",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
];
const options = {
  timeout: 20000,
  maxBuffer: 700000,
  encoding: "utf8" as const,
  env: {
    NODE_ENV: "production" as const,
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    OMP_THREAD_LIMIT: "1",
  },
};
function validateText(text: string) {
  text = text.replace(/\r\n/g, "\n").trim();
  if (text.length < 10 || text.length > 60000 || text.includes("\0"))
    throw fail(
      400,
      "EXTRACTED_TEXT_SIZE",
      "Provide 10–60,000 text characters without binary content.",
    );
  return text;
}
function utf8(bytes: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw fail(400, "FILE_ENCODING", "Save this text document as UTF-8.");
  }
}
function validateFile(fileName: string, bytes: Buffer) {
  const extension = extname(fileName).toLowerCase();
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw fail(400, "FILE_SIZE", "Choose a file under 5 MB.");
  if (!supported.includes(extension))
    throw fail(
      415,
      "FILE_TYPE",
      "Use PDF, DOCX, XLSX, CSV/TSV, program JSON, text, Markdown, JPEG, PNG or WebP.",
    );
  if (
    extension === ".pdf" &&
    !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
  )
    throw fail(400, "FILE_SIGNATURE", "The PDF signature is invalid.");
  if (
    [".docx", ".xlsx"].includes(extension) &&
    !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  )
    throw fail(
      400,
      "FILE_SIGNATURE",
      "The office document signature is invalid.",
    );
  return extension;
}
export type Extraction = {
  text: string;
  extraction: string;
  warnings: string[];
  pages?: number;
};
async function ocr(file: string) {
  const { stdout } = await execute(
    "tesseract",
    [file, "stdout", "-l", "eng", "--psm", "6"],
    options,
  );
  return stdout.trim();
}
export async function extractDocumentDetailed(
  fileName: string,
  bytes: Buffer,
): Promise<Extraction> {
  const extension = validateFile(fileName, bytes);
  if ([".txt", ".md"].includes(extension))
    return {
      text: validateText(utf8(bytes)),
      extraction: "utf8-v2",
      warnings: [],
    };
  if (extension === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8(bytes));
    } catch {
      throw fail(
        400,
        "PROGRAM_JSON",
        "Use a valid structured program JSON file.",
      );
    }
    const result = z
      .union([
        programSchema,
        z.object({ programs: z.array(programSchema).min(1).max(30) }).strict(),
      ])
      .safeParse(parsed);
    if (!result.success)
      throw fail(
        400,
        "PROGRAM_JSON",
        "Program JSON must match title, goal, daysPerWeek and a bounded exercises list (name, sets, reps, restSeconds, loadKg, cue), or a programs array.",
      );
    const programs =
      "programs" in result.data ? result.data.programs : [result.data];
    const text = programs
      .map(
        (p) =>
          `Program: ${p.title}\nGoal: ${p.goal}\nDays per week: ${p.daysPerWeek}\n` +
          p.exercises
            .map(
              (e, i) =>
                `${i + 1}. ${e.name}: ${e.sets} sets × ${e.reps} reps, ${e.loadKg} kg, ${e.restSeconds}s rest. ${e.cue}`,
            )
            .join("\n"),
      )
      .join("\n\n");
    return {
      text: validateText(text),
      extraction: "program-json-v1",
      warnings: [
        "Structured programs become teaching material after review. They do not assign a workout to any client.",
      ],
    };
  }
  const directory = await mkdtemp(join(tmpdir(), "trainer-import-"));
  try {
    const file = join(directory, "source" + extension);
    await writeFile(file, bytes, { mode: 0o600 });
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
      let image: Buffer;
      try {
        const source = sharp(bytes, {
            limitInputPixels: 24000000,
            failOn: "warning",
          }),
          metadata = await source.metadata();
        if (
          !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
          (metadata.pages ?? 1) > 1
        )
          throw new Error("Unsupported image");
        image = await source
          .rotate()
          .flatten({ background: "white" })
          .resize({
            width: 3000,
            height: 3000,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer();
      } catch {
        throw fail(
          400,
          "IMAGE_INVALID",
          "Choose a valid non-animated JPEG, PNG or WebP under 24 megapixels.",
        );
      }
      const clean = join(directory, "image.png");
      await writeFile(clean, image, { mode: 0o600 });
      return {
        text: validateText(await ocr(clean)),
        extraction: "local-tesseract-eng-v1",
        warnings: [
          "Local English OCR may misread names, numbers, tables and handwriting. Check all extracted text before approval.",
        ],
      };
    }
    if (extension !== ".pdf") {
      const script =
        extension === ".docx"
          ? "extract-docx.py"
          : extension === ".xlsx"
            ? "extract-xlsx.py"
            : "extract-csv.py";
      const { stdout } = await execute(
        "python3",
        [
          fileURLToPath(new URL("../../../scripts/" + script, import.meta.url)),
          file,
        ],
        options,
      );
      return {
        text: validateText(stdout),
        extraction: extension.slice(1) + "-bounded-v2",
        warnings:
          extension === ".xlsx"
            ? [
                "Only visible literal cells are imported. Formula cells, macros and external data links are rejected; export values only. Numeric date serials remain numbers for your review.",
              ]
            : [],
      };
    }
    const { stdout: info } = await execute("pdfinfo", [file], options);
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (
      !Number.isInteger(pages) ||
      pages < 1 ||
      pages > 30 ||
      /^Encrypted:\s+yes/im.test(info)
    )
      throw fail(
        400,
        "PDF_LIMIT",
        "Use an unencrypted PDF with at most 30 pages.",
      );
    const { stdout } = await execute(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", file, "-"],
      options,
    );
    const pageText = stdout.split("\f").slice(0, pages);
    while (pageText.length < pages) pageText.push("");
    const scans = pageText
      .map((text, index) => (text.trim().length < 10 ? index : -1))
      .filter((i) => i >= 0);
    if (scans.length > 6)
      throw fail(
        400,
        "OCR_PAGE_LIMIT",
        "Choose at most six scanned pages per upload.",
      );
    for (const index of scans) {
      const prefix = join(directory, "page-" + index);
      await execute(
        "pdftoppm",
        [
          "-f",
          String(index + 1),
          "-l",
          String(index + 1),
          "-singlefile",
          "-r",
          "140",
          "-scale-to",
          "2400",
          "-png",
          file,
          prefix,
        ],
        options,
      );
      pageText[index] = await ocr(prefix + ".png");
    }
    validateText(pageText.join("\n"));
    return {
      text: validateText(
        pageText
          .map((text, i) => `[Page ${i + 1}]\n${text.trim()}`)
          .join("\n\n"),
      ),
      extraction: scans.length ? "pdf-local-ocr-eng-v1" : "pdf-text-v2",
      warnings: scans.length
        ? [
            "Local English OCR was used on scanned pages. Check all numbers and wording; no raw document is retained.",
          ]
        : [],
      pages,
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    if (String(error.stderr ?? "").includes("Formula cells are not accepted"))
      throw fail(
        400,
        "FORMULAS_UNSUPPORTED",
        "Formula cells are not imported. Export spreadsheet values only.",
      );
    if (error.code === "ENOENT")
      throw fail(
        503,
        "EXTRACTION_TOOL_UNAVAILABLE",
        "The required local extraction tool is unavailable on this server.",
      );
    throw fail(
      422,
      "EXTRACTION_FAILED",
      "The file could not be safely extracted. Use an unencrypted, valid document with no embedded files, external XML/data links or formulas, and at most 60,000 text characters.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function extractDocument(fileName: string, bytes: Buffer) {
  return (await extractDocumentDetailed(fileName, bytes)).text;
}
export function privacyMatches(text: string) {
  const patterns: [string, RegExp][] = [
    ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
    ["phone", /(?<!\w)(?:\+?\d[\d ()-]{8,}\d)(?!\w)/g],
    ["bank account", /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/gi],
    [
      "person reference",
      /\b(?:client|patient|member|date of birth|dob)\s*:\s*[^\n|]{2,100}/gi,
    ],
  ];
  const matches: { type: string; start: number; end: number; value: string }[] =
    [];
  for (const [type, pattern] of patterns)
    for (const match of text.matchAll(pattern)) {
      if (type === "phone" && match[0].replace(/\D/g, "").length < 9) continue;
      matches.push({
        type,
        start: match.index!,
        end: match.index! + match[0].length,
        value: match[0],
      });
      if (matches.length >= 100)
        return matches.sort((a, b) => a.start - b.start);
    }
  return matches.sort((a, b) => a.start - b.start);
}
export function redactPersonalData(text: string) {
  const merged: { start: number; end: number }[] = [];
  for (const match of privacyMatches(text)) {
    const previous = merged.at(-1);
    if (previous && match.start <= previous.end)
      previous.end = Math.max(previous.end, match.end);
    else merged.push({ start: match.start, end: match.end });
  }
  for (const match of merged.reverse()) {
    text = text.slice(0, match.start) + "[redacted]" + text.slice(match.end);
  }
  return text;
}
export function buildSourceEvidence(text: string) {
  text = validateText(text);
  const chunks = [];
  for (let start = 0; start < text.length; start += 1800) {
    const end = Math.min(start + 2000, text.length),
      content = text.slice(start, end);
    chunks.push({ id: hash(content).slice(0, 24), start, end, text: content });
    if (end === text.length) break;
  }
  return { hash: hash(text), chunks };
}
export function compilationMaterial(records: any[]) {
  if (!records.length || records.length > 20)
    throw fail(
      400,
      "COMPILATION_LIMIT",
      "Compile between one and twenty reviewed sources at a time.",
    );
  let characters = 0;
  return records.map((record) => {
    const ready =
      (record.kind === "source" && record.status === "ready") ||
      (record.kind === "interview" && record.status === "answered");
    if (
      !ready ||
      !record.data.allowedUses?.includes("model_prompt") ||
      !record.data.allowedUses?.includes("trainer_specific_learning")
    )
      throw fail(
        400,
        "SOURCE_NOT_REVIEWED",
        "Only reviewed, permitted trainer teaching material can be compiled.",
      );
    const text =
      record.kind === "interview"
        ? String(record.data.answer ?? "")
        : String(record.data.text ?? "");
    characters += text.length;
    if (text.length > 60000 || characters > 120000)
      throw fail(
        400,
        "COMPILATION_LIMIT",
        "Choose selected teaching excerpts totaling at most 120,000 characters.",
      );
    return {
      id: record.id,
      data: {
        title: record.data.title,
        question: record.data.question,
        text,
        allowedUses: record.data.allowedUses,
        hash: record.data.hash,
        sourceVersion: record.version,
      },
    };
  });
}
let extracting = 0;
export function ingestionRoutes(
  app: FastifyInstance,
  db: Database,
  trainer: (r: FastifyRequest) => Actor,
) {
  const safeTrainer = (req: FastifyRequest) => {
    const a = trainer(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "TRAINER_REQUIRED", "Trainer access is required.");
    return a;
  };
  app.get("/api/v1/brain/imports", async (req) => {
    const a = safeTrainer(req);
    return db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM records WHERE kind='source_import' ORDER BY created_at DESC LIMIT 100",
      ),
    );
  });
  app.post(
    "/api/v1/brain/documents",
    {
      bodyLimit: 8 * 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req) => {
      const a = safeTrainer(req),
        b = z
          .object({
            fileName: z.string().min(1).max(180),
            contentBase64: z
              .string()
              .max(7 * 1024 * 1024)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/),
            title: z.string().trim().min(2).max(120),
            rights: z.literal(true),
            retryOf: z.string().uuid().optional(),
          })
          .strict()
          .parse(req.body);
      if (
        process.env.NODE_ENV === "production" &&
        runtimeConfig().FILE_IMPORTS_APPROVED !== "true"
      )
        throw fail(
          503,
          "IMPORT_REVIEW_PENDING",
          "Document import is waiting for parser isolation and security review.",
        );
      const bytes = Buffer.from(b.contentBase64, "base64");
      if (bytes.toString("base64") !== b.contentBase64)
        throw fail(400, "FILE_ENCODING", "The upload encoding is invalid.");
      const extension = validateFile(b.fileName, bytes),
        fileHash = hash(bytes),
        fileName = b.fileName.split(/[\\/]/).pop()!;
      const claim = await db.tenant(a, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId + ":import:" + fileHash,
        ]);
        const [prior] = await tx.query(
          "SELECT * FROM records WHERE kind IN ('source_import','source') AND data->>'fileHash'=$1 AND status<>'discarded' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [fileHash],
        );
        if (prior && !b.retryOf) return { record: prior, run: false };
        if (
          b.retryOf &&
          (!prior ||
            prior.id !== b.retryOf ||
            !["failed", "processing"].includes(prior.status))
        )
          throw fail(
            409,
            "IMPORT_RETRY",
            "Only the original failed or expired import can be retried.",
          );
        if (
          prior?.status === "processing" &&
          new Date(prior.data.leaseUntil).getTime() > Date.now()
        )
          throw fail(
            409,
            "IMPORT_PROCESSING",
            "This import is still processing.",
          );
        const data = {
          title: b.title,
          fileHash,
          fileName,
          byteLength: bytes.length,
          origin: "trainer_upload",
          allowedUses: [],
          rightsAttestedAt: new Date().toISOString(),
          leaseUntil: new Date(Date.now() + 5 * 60000).toISOString(),
        };
        if (prior) {
          const [r] = await tx.query(
            "UPDATE records SET data=$2,status='processing',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [prior.id, JSON.stringify(data)],
          );
          return { record: r, run: true };
        }
        return {
          record: await putRecord(tx, a, "source_import", data, {
            status: "processing",
          }),
          run: true,
        };
      });
      if (!claim.run) return claim.record;
      try {
        if (extracting >= 2)
          throw fail(
            429,
            "IMPORT_BUSY",
            "Two documents are already processing. Retry this import shortly.",
          );
        extracting++;
        let result: Extraction;
        try {
          result = await extractDocumentDetailed(fileName, bytes);
        } finally {
          extracting--;
          bytes.fill(0);
        }
        return await db.tenant(a, async (tx) => {
          const [r] = await tx.query(
            "UPDATE records SET status='needs_review',data=data||$3::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND status='processing' RETURNING *",
            [
              claim.record.id,
              claim.record.version,
              JSON.stringify({
                ...result,
                privacyMatches: privacyMatches(result.text),
                rawDeletedAt: new Date().toISOString(),
                leaseUntil: null,
              }),
            ],
          );
          if (!r)
            throw fail(
              409,
              "IMPORT_CHANGED",
              "This import changed while extraction was running.",
            );
          await event(tx, a, "brain.document_extracted", r.id, {
            format: extension,
            characters: result.text.length,
            extraction: result.extraction,
          });
          return r;
        });
      } catch (error: any) {
        await db.tenant(a, async (tx) => {
          await tx.query(
            "UPDATE records SET status='failed',data=(data-'text')||$3::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND status='processing'",
            [
              claim.record.id,
              claim.record.version,
              JSON.stringify({
                error: {
                  code: error.code ?? "EXTRACTION_FAILED",
                  message: error.statusCode
                    ? error.message
                    : "Extraction failed.",
                },
                rawDeletedAt: new Date().toISOString(),
                leaseUntil: null,
              }),
            ],
          );
        });
        throw error;
      }
    },
  );
  app.post("/api/v1/brain/imports/:id/review", async (req) => {
    const a = safeTrainer(req),
      importId = z
        .string()
        .uuid()
        .parse((req.params as any).id),
      b = z
        .object({
          revision: z.number().int().min(1),
          title: z.string().trim().min(2).max(120),
          text: z.string().min(10).max(60000),
          rights: z.literal(true),
          privacyReviewed: z.literal(true),
        })
        .strict()
        .parse(req.body);
    const text = validateText(b.text);
    if (privacyMatches(text).length)
      throw fail(
        400,
        "PERSONAL_DATA_REMAINS",
        "Remove or replace the flagged personal identifiers before adding this teaching material.",
      );
    const evidence = buildSourceEvidence(text);
    return db.tenant(a, async (tx) => {
      const [record] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='source_import' FOR UPDATE",
        [importId],
      );
      if (!record) throw fail(404, "IMPORT_NOT_FOUND", "Import unavailable.");
      if (record.status !== "needs_review" || record.version !== b.revision)
        throw fail(
          409,
          "IMPORT_CHANGED",
          "This import changed. Reload before reviewing.",
        );
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":source:" + evidence.hash,
      ]);
      let [source] = await tx.query(
        "SELECT * FROM records WHERE kind='source' AND status='ready' AND data->>'hash'=$1",
        [evidence.hash],
      );
      if (!source)
        source = await putRecord(
          tx,
          a,
          "source",
          {
            title: b.title,
            text,
            ...evidence,
            fileHash: record.data.fileHash,
            fileName: record.data.fileName,
            origin: "trainer_upload",
            extraction: record.data.extraction,
            importId,
            allowedUses: [
              "render",
              "model_prompt",
              "trainer_specific_learning",
            ],
            rightsAttestedAt: new Date().toISOString(),
            privacyReviewedAt: new Date().toISOString(),
            reviewedBy: a.userId,
          },
          { status: "ready" },
        );
      await tx.query(
        "UPDATE records SET status='approved',data=(data-'text'-'privacyMatches')||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
        [
          importId,
          JSON.stringify({
            sourceId: source.id,
            reviewedHash: evidence.hash,
            reviewedAt: new Date().toISOString(),
          }),
        ],
      );
      await event(tx, a, "brain.document_approved", source.id, {
        importId,
        characters: text.length,
        chunks: evidence.chunks.length,
      });
      return source;
    });
  });
  app.post("/api/v1/brain/imports/:id/redact", async (req) => {
    const a = safeTrainer(req),
      importId = z
        .string()
        .uuid()
        .parse((req.params as any).id),
      b = z
        .object({ revision: z.number().int().min(1) })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='source_import' AND status='needs_review' FOR UPDATE",
        [importId],
      );
      if (!r || r.version !== b.revision)
        throw fail(409, "IMPORT_CHANGED", "This import changed. Reload first.");
      const text = redactPersonalData(r.data.text),
        [updated] = await tx.query(
          "UPDATE records SET data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [
            importId,
            JSON.stringify({ text, privacyMatches: privacyMatches(text) }),
          ],
        );
      await event(tx, a, "brain.import_redacted", importId);
      return updated;
    });
  });
  app.delete("/api/v1/brain/imports/:id", async (req) => {
    const a = safeTrainer(req),
      importId = z
        .string()
        .uuid()
        .parse((req.params as any).id),
      b = z
        .object({ revision: z.number().int().min(1) })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE records SET status='discarded',data=jsonb_build_object('title',data->>'title','fileHash',data->>'fileHash','discardedAt',now(),'allowedUses','[]'::jsonb),version=version+1,updated_at=now() WHERE id=$1 AND kind='source_import' AND status IN ('processing','needs_review','failed') AND version=$2 RETURNING id,status",
        [importId, b.revision],
      );
      if (!r)
        throw fail(
          409,
          "IMPORT_CHANGED",
          "Only an unapproved current import can be discarded.",
        );
      await event(tx, a, "brain.import_discarded", r.id);
      return r;
    });
  });
}
