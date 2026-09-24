import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, putRecord, event } from "@trainer/db";
import { z } from "zod";
const execute = promisify(execFile);
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export async function extractDocument(fileName: string, bytes: Buffer) {
  const extension = extname(fileName).toLowerCase();
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw fail(400, "FILE_SIZE", "Choose a document under 5 MB");
  if ([".txt", ".md", ".csv"].includes(extension)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw fail(400, "FILE_ENCODING", "Save this text document as UTF-8");
    }
    return validateText(text);
  }
  if (![".pdf", ".docx"].includes(extension))
    throw fail(415, "FILE_TYPE", "Use PDF, DOCX, UTF-8 text, Markdown or CSV");
  if (
    extension === ".pdf" &&
    !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
  )
    throw fail(400, "FILE_SIGNATURE", "The PDF signature is invalid");
  if (
    extension === ".docx" &&
    !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  )
    throw fail(400, "FILE_SIGNATURE", "The DOCX signature is invalid");
  const directory = await mkdtemp(join(tmpdir(), "trainer-import-"));
  try {
    const file = join(directory, "source" + extension);
    await writeFile(file, bytes, { mode: 0o600 });
    const options = {
      timeout: 10000,
      maxBuffer: 300000,
      encoding: "utf8" as const,
      env: {
        NODE_ENV: "production" as const,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C.UTF-8",
      },
    };
    const { stdout } =
      extension === ".pdf"
        ? await execute(
            "pdftotext",
            ["-layout", "-enc", "UTF-8", file, "-"],
            options,
          )
        : await execute(
            "python3",
            [
              fileURLToPath(
                new URL("../../../scripts/extract-docx.py", import.meta.url),
              ),
              file,
            ],
            options,
          );
    return validateText(stdout);
  } catch (error) {
    if ((error as any).statusCode) throw error;
    throw fail(
      422,
      "EXTRACTION_FAILED",
      "Text could not be extracted. Use an unencrypted text-based document under 60,000 characters; scanned PDFs need an OCR tool first.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function validateText(text: string) {
  text = text.replace(/\r\n/g, "\n").trim();
  if (text.length < 10 || text.length > 60000 || text.includes("\0"))
    throw fail(
      400,
      "EXTRACTED_TEXT_SIZE",
      "Provide 10–60,000 text characters without binary content",
    );
  return text;
}
export function ingestionRoutes(
  app: FastifyInstance,
  db: Database,
  trainer: (r: FastifyRequest) => Actor,
) {
  app.post(
    "/api/v1/brain/documents",
    {
      bodyLimit: 8 * 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req) => {
      const a = trainer(req),
        b = z
          .object({
            fileName: z.string().min(1).max(180),
            contentBase64: z
              .string()
              .max(7 * 1024 * 1024)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/),
            title: z.string().min(2).max(120),
            rights: z.literal(true),
          })
          .strict()
          .parse(req.body);
      if (
        process.env.NODE_ENV === "production" &&
        process.env.FILE_IMPORTS_APPROVED !== "true"
      )
        throw fail(
          503,
          "IMPORT_REVIEW_PENDING",
          "Document import is waiting for parser isolation and security review",
        );
      const bytes = Buffer.from(b.contentBase64, "base64"),
        fileHash = createHash("sha256").update(bytes).digest("hex");
      if (
        extname(b.fileName).toLowerCase() === ".pdf" &&
        !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
      )
        throw fail(400, "FILE_SIGNATURE", "The PDF signature is invalid");
      if (
        extname(b.fileName).toLowerCase() === ".docx" &&
        !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
      )
        throw fail(400, "FILE_SIGNATURE", "The DOCX signature is invalid");
      if (
        ![".pdf", ".docx", ".txt", ".md", ".csv"].includes(
          extname(b.fileName).toLowerCase(),
        )
      )
        throw fail(415, "FILE_TYPE", "Use PDF, DOCX, text, Markdown or CSV");
      const [prior] = await db.tenant(a, (tx) =>
        tx.query(
          "SELECT * FROM records WHERE kind='source' AND data->>'fileHash'=$1",
          [fileHash],
        ),
      );
      if (prior) return prior;
      const text = await extractDocument(b.fileName, bytes),
        hash = createHash("sha256").update(text).digest("hex");
      return db.tenant(a, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId + ":source:" + hash,
        ]);
        const [existing] = await tx.query(
          "SELECT * FROM records WHERE kind='source' AND data->>'hash'=$1",
          [hash],
        );
        if (existing) return existing;
        const r = await putRecord(
          tx,
          a,
          "source",
          {
            title: b.title,
            text,
            hash,
            fileHash,
            fileName: basename(b.fileName),
            byteLength: bytes.length,
            origin: "trainer_upload",
            extraction: "text-v1",
            allowedUses: [
              "render",
              "model_prompt",
              "trainer_specific_learning",
            ],
            rightsAttestedAt: new Date().toISOString(),
          },
          { status: "ready" },
        );
        await event(tx, a, "brain.document_ingested", r.id, {
          format: extname(b.fileName).toLowerCase(),
          characters: text.length,
        });
        return r;
      });
    },
  );
}
