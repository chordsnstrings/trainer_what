import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import {
  createDatabase,
  putRecord,
  type Database,
  type Actor,
} from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  bindChatAttachments,
  validateChatAttachments,
  sanitizeChatAttachment,
  exportChatAttachments,
  eraseChatAttachments,
  expireChatAttachments,
} from "../apps/api/src/chat-attachments.ts";
import { exportPersonalData } from "../apps/api/src/privacy-lifecycle.ts";
import { privacyHooks } from "../apps/api/src/privacy-hooks.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  coach: any,
  foreign: any,
  client: any,
  second: any,
  staff: any,
  finance: any;
let photo: Buffer;
const origin = "http://localhost:3000";
function req(
  a: any,
  path: string,
  method: any = "GET",
  body?: Record<string, unknown>,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    headers: { origin, ...(a ? { cookie: a.cookie } : {}) },
    payload: body,
  });
}
async function register(slug: string) {
  const response = await req(null, "/auth/register", "POST", {
    slug,
    name: "Synthetic " + slug,
    email: slug + "@example.test",
    password: "AttachmentOnly2026!",
    accepted: true,
  });
  assert.equal(response.statusCode, 201, response.body);
  const cookie = String(response.headers["set-cookie"]).split(";")[0];
  return { ...(await req({ cookie }, "/bootstrap")).json().user, cookie };
}
async function member(name: string, role = "subscriber") {
  const invitation = await req(coach, "/invitations", "POST", {
    email: name + "@example.test",
    role: "subscriber",
  });
  assert.equal(invitation.statusCode, 200, invitation.body);
  const joined = await req(null, "/invitations/accept", "POST", {
    token: invitation.json().url.split("/").pop(),
    name,
    email: name + "@example.test",
    password: "AttachmentClient2026!",
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  if (role !== "subscriber")
    await db.system((tx) =>
      tx.query(
        "UPDATE memberships SET role=$1 WHERE tenant_id=$2 AND user_id=(SELECT id FROM users WHERE email=$3)",
        [role, coach.tenantId, name + "@example.test"],
      ),
    );
  return { ...(await req({ cookie }, "/bootstrap")).json().user, cookie };
}
function uploadBody(
  subject = client.userId,
  extra: Record<string, unknown> = {},
) {
  return {
    subjectId: subject,
    requestKey: randomUUID(),
    fileName: "Practice photo.png",
    mime: "image/png",
    contentBase64: photo.toString("base64"),
    rightsConfirmed: true,
    ...extra,
  };
}
async function upload(
  a = client,
  subject = client.userId,
  extra: Record<string, unknown> = {},
) {
  const response = await req(
    a,
    "/chat/attachments",
    "POST",
    uploadBody(subject, extra),
  );
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function send(
  a: any,
  subject: string,
  attachmentIds: string[],
  text = "",
) {
  const response = await req(a, "/messages", "POST", {
    subscriberId: subject,
    text,
    attachmentIds,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function insertDraft(a: Actor, subject: string, expired = false) {
  const attachmentId = randomUUID();
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO chat_attachments(id,tenant_id,uploaded_by,subject_user_id,request_key,fingerprint,file_name,mime_type,media,byte_count,expires_at) VALUES($1,$2,$3,$4,$5,'fixture','Expired.jpg','image/jpeg',$6,$7,now()+$8::interval)",
      [
        attachmentId,
        a.tenantId,
        a.userId,
        subject,
        randomUUID(),
        photo,
        photo.length,
        expired ? "-1 hour" : "1 hour",
      ],
    ),
  );
  return attachmentId;
}
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("chat-owner");
  foreign = await register("chat-other");
  client = await member("chat-client");
  second = await member("chat-second");
  staff = await member("chat-staff", "staff");
  finance = await member("chat-finance", "finance");
  photo = await sharp({
    create: { width: 2500, height: 100, channels: 3, background: "#5a7b8d" },
  })
    .png()
    .withMetadata()
    .toBuffer();
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("private image uploads require sharing rights, decode strict formats and normalize metadata", async () => {
  const b = uploadBody(),
    response = await req(client, "/chat/attachments", "POST", b);
  assert.equal(response.statusCode, 200, response.body);
  const file = response.json();
  assert.equal(file.mime, "image/jpeg");
  assert.equal(file.width, 2000);
  assert.equal(file.fileName, "Practice photo.jpg");
  const downloaded = await req(client, "/chat/attachments/" + file.id);
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  const metadata = await sharp(downloaded.rawPayload).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(downloaded.headers["cache-control"], "private, no-store");
  assert.match(
    String(downloaded.headers["content-security-policy"]),
    /sandbox/,
  );
  for (const actor of [coach, second, foreign])
    assert.equal(
      (await req(actor, "/chat/attachments/" + file.id)).statusCode,
      404,
      "Unsent media stays private to its uploader",
    );
  assert.equal(
    (await req(null, "/chat/attachments/" + file.id)).statusCode,
    401,
  );
  assert.equal(
    (await req(client, "/chat/attachments", "POST", b)).json().id,
    file.id,
    "A retry reuses its upload intent",
  );
  assert.equal(
    (
      await req(client, "/chat/attachments", "POST", {
        ...b,
        fileName: "Changed.png",
      })
    ).statusCode,
    409,
  );
  for (const changes of [
    { rightsConfirmed: false },
    { mime: "image/jpeg" },
    { contentBase64: "aW52YWxpZA==" },
    { contentBase64: b.contentBase64 + "\n" },
  ])
    assert.equal(
      (
        await req(client, "/chat/attachments", "POST", {
          ...uploadBody(),
          ...changes,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (await req(client, "/chat/attachments", "POST", uploadBody(second.userId)))
      .statusCode,
    403,
  );
  assert.equal(
    (await req(coach, "/chat/attachments", "POST", uploadBody(foreign.userId)))
      .statusCode,
    404,
  );
  assert.equal(
    (await req(finance, "/chat/attachments", "POST", uploadBody())).statusCode,
    403,
  );
  await assert.rejects(
    sanitizeChatAttachment(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png"),
    /under 5 MB/,
  );
});

test("message attachment binding enforces the sender, client, tenant and single-message ownership", async () => {
  const file = await upload(),
    otherClient = await upload(second, second.userId),
    wrongAuthor = await upload(coach);
  for (const [a, subject, ids, status] of [
    [client, client.userId, [otherClient.id], 404],
    [coach, client.userId, [file.id], 404],
    [client, client.userId, [file.id, file.id], 400],
    [foreign, client.userId, [file.id], 404],
  ] as const) {
    assert.equal(
      (
        await req(a, "/messages", "POST", {
          subscriberId: subject,
          text: "Attachment attempt",
          attachmentIds: ids,
        })
      ).statusCode,
      status,
    );
  }
  const message = await send(client, client.userId, [file.id]);
  assert.equal(message.data.attachments[0].id, file.id);
  assert.equal(message.data.authorUserId, client.userId);
  assert.equal(
    (await req(coach, "/chat/attachments/" + file.id)).statusCode,
    200,
  );
  assert.equal(
    (await req(staff, "/chat/attachments/" + file.id)).statusCode,
    200,
  );
  assert.equal(
    (await req(second, "/chat/attachments/" + file.id)).statusCode,
    404,
  );
  assert.equal(
    (await req(foreign, "/chat/attachments/" + file.id)).statusCode,
    404,
  );
  assert.equal(
    (
      await req(client, "/messages", "POST", {
        text: "Retry rebind",
        attachmentIds: [file.id],
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await req(client, "/messages", "POST", { text: "   ", attachmentIds: [] }))
      .statusCode,
    400,
  );
  const forged = await db.tenant(coach, (tx) =>
    putRecord(
      tx,
      coach,
      "message",
      { text: "Someone else's message", authorUserId: client.userId },
      { ownerId: client.userId, status: "sent" },
    ),
  );
  await assert.rejects(
    db.tenant(coach, (tx) =>
      bindChatAttachments(tx, coach, client.userId, forged.id, [
        wrongAuthor.id,
      ]),
    ),
    /author/,
  );
  await assert.rejects(
    db.tenant(coach, (tx) =>
      tx.query("UPDATE chat_attachments SET message_id=$1 WHERE id=$2", [
        forged.id,
        wrongAuthor.id,
      ]),
    ),
    /author and client/,
  );
  const wrongThread = await db.tenant(coach, (tx) =>
    putRecord(
      tx,
      coach,
      "message",
      { text: "Wrong thread", authorUserId: coach.userId },
      { ownerId: second.userId, status: "sent" },
    ),
  );
  await assert.rejects(
    db.tenant(coach, (tx) =>
      tx.query("UPDATE chat_attachments SET message_id=$1 WHERE id=$2", [
        wrongThread.id,
        wrongAuthor.id,
      ]),
    ),
    /author and client/,
  );
  assert.equal(
    (
      await db.tenant(client, (tx) =>
        tx.query(
          "UPDATE chat_attachments SET file_name='changed.jpg' WHERE id=$1 RETURNING id",
          [otherClient.id],
        ),
      )
    ).length,
    0,
  );
  await assert.rejects(
    db.tenant(coach, (tx) =>
      tx.query(
        "UPDATE chat_attachments SET file_name='changed.jpg' WHERE id=$1",
        [wrongAuthor.id],
      ),
    ),
    /immutable/,
  );
});

test("removing a shared file removes its message reference without deleting conversation text", async () => {
  const own = await upload(client),
    fromCoach = await upload(coach),
    fromStaff = await upload(staff);
  const message = await send(client, client.userId, [own.id], "Keep this text");
  await send(coach, client.userId, [fromCoach.id]);
  await send(staff, client.userId, [fromStaff.id]);
  assert.equal(
    (await req(staff, "/chat/attachments/" + own.id, "DELETE")).statusCode,
    403,
  );
  assert.equal(
    (await req(second, "/chat/attachments/" + own.id, "DELETE")).statusCode,
    404,
  );
  for (const [a, file] of [
    [client, fromCoach],
    [coach, fromStaff],
    [client, own],
  ])
    assert.equal(
      (await req(a, "/chat/attachments/" + file.id, "DELETE")).statusCode,
      200,
    );
  assert.equal(
    (await req(coach, "/chat/attachments/" + own.id)).statusCode,
    404,
  );
  const [saved] = await db.tenant(client, (tx) =>
    tx.query("SELECT data FROM records WHERE id=$1", [message.id]),
  );
  assert.equal(saved.data.text, "Keep this text");
  assert.deepEqual(saved.data.attachments, []);
});

test("expired drafts cannot bind or download and maintenance preserves bound media and other tenants", async () => {
  const bound = await upload(client);
  await send(client, client.userId, [bound.id]);
  const expired = await insertDraft(client, client.userId, true),
    live = await insertDraft(client, client.userId);
  assert.equal(
    (await req(client, "/chat/attachments/" + expired)).statusCode,
    404,
  );
  assert.equal(
    (
      await req(client, "/messages", "POST", {
        text: "Expired file",
        attachmentIds: [expired],
      })
    ).statusCode,
    409,
  );
  const message = await db.tenant(client, (tx) =>
    putRecord(
      tx,
      client,
      "message",
      { text: "Expired binding", authorUserId: client.userId },
      { status: "sent" },
    ),
  );
  await assert.rejects(
    db.tenant(client, (tx) =>
      tx.query("UPDATE chat_attachments SET message_id=$1 WHERE id=$2", [
        message.id,
        expired,
      ]),
    ),
    /expired/,
  );
  const foreignSubject = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Other client',$2,'unused')",
      [foreignSubject, foreignSubject + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [foreign.tenantId, foreignSubject],
    );
  });
  const foreignDraft = await insertDraft(foreign, foreignSubject, true);
  assert.equal(await expireChatAttachments(db, coach.tenantId), 1);
  assert.equal(
    (
      await db.tenant(client, (tx) =>
        tx.query("SELECT id FROM chat_attachments WHERE id=ANY($1::uuid[])", [
          [expired, live, bound.id],
        ]),
      )
    ).length,
    2,
  );
  assert.equal(
    (
      await db.tenant(foreign, (tx) =>
        tx.query("SELECT id FROM chat_attachments WHERE id=$1", [foreignDraft]),
      )
    ).length,
    1,
  );
  await assert.rejects(
    db.tenant(client, (tx) =>
      tx.query("SELECT expire_unattached_chat_media()"),
    ),
    /worker scope/,
  );
});

test("personal export and erasure include private drafts, sent files and author references in other threads", async () => {
  const own = await upload(client),
    addressed = await upload(coach),
    unrelated = await upload(second, second.userId),
    staffFile = await upload(staff);
  const staffMessage = await send(
    staff,
    client.userId,
    [staffFile.id],
    "Staff advice remains",
  );
  const exported = await exportPersonalData(db, client, privacyHooks);
  const attachments = (exported as any).chatAttachments;
  assert.ok(attachments.some((r: any) => r.id === own.id && r.content_base64));
  assert.ok(attachments.some((r: any) => r.id === addressed.id));
  assert.ok(!attachments.some((r: any) => r.id === unrelated.id));
  await assert.rejects(
    db.tenant({ ...client, role: "owner" }, (tx) =>
      exportChatAttachments(tx, second.userId),
    ),
    /requester/,
  );
  await assert.rejects(
    db.tenant(coach, (tx) => eraseChatAttachments(tx, client.userId)),
    /privacy operator/,
  );
  await db.tenant({ ...staff, role: "owner" }, (tx) =>
    privacyHooks.eraseAdditional!(tx, staff.userId),
  );
  const [message] = await db.tenant(coach, (tx) =>
    tx.query("SELECT data FROM records WHERE id=$1", [staffMessage.id]),
  );
  assert.equal(message.data.text, "Staff advice remains");
  assert.deepEqual(message.data.attachments, []);
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [
      coach.userId,
    ]),
  );
  await db.tenant(coach, (tx) =>
    privacyHooks.eraseAdditional!(tx, client.userId),
  );
  assert.equal(
    (
      await db.system((tx) =>
        tx.query(
          "SELECT id FROM chat_attachments WHERE tenant_id=$1 AND (subject_user_id=$2 OR uploaded_by=$2)",
          [coach.tenantId, client.userId],
        ),
      )
    ).length,
    0,
  );
  assert.equal(
    (await req(second, "/chat/attachments/" + unrelated.id)).statusCode,
    200,
  );
  await assert.rejects(
    db.tenant(second, (tx) => privacyHooks.closeAdditional!(tx)),
    /privacy operator/,
  );
  const [priorForeign] = await db.system((tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM chat_attachments WHERE tenant_id=$1",
      [foreign.tenantId],
    ),
  );
  assert.ok(priorForeign.n > 0);
  await db.tenant({ ...coach, tenantId: foreign.tenantId }, (tx) =>
    privacyHooks.closeAdditional!(tx),
  );
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT id FROM chat_attachments WHERE tenant_id=$1", [
          foreign.tenantId,
        ]),
      )
    ).length,
    0,
    "Operator closure also removes private drafts outside the operator's normal RLS view",
  );
});

test("stale member identities and a closed workspace cannot create or bind chat media", async () => {
  const departing = await member("chat-departing"),
    file = await upload(departing, departing.userId);
  await db.system((tx) =>
    tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      coach.tenantId,
      departing.userId,
    ]),
  );
  await assert.rejects(
    db.tenant(departing, (tx) =>
      validateChatAttachments(tx, departing, departing.userId, [file.id]),
    ),
    /membership|access|unavailable/i,
  );
  const response = await req(
    departing,
    "/chat/attachments",
    "POST",
    uploadBody(departing.userId),
  );
  assert.ok([401, 403].includes(response.statusCode), response.body);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      coach.tenantId,
    ]),
  );
  try {
    await assert.rejects(
      db.tenant(client, (tx) =>
        validateChatAttachments(tx, client, client.userId, [file.id]),
      ),
      /membership|access|unavailable/i,
    );
  } finally {
    await db.system((tx) =>
      tx.query("UPDATE tenants SET lifecycle_state='active' WHERE id=$1", [
        coach.tenantId,
      ]),
    );
  }
});

function rc4(key: Buffer, data: Buffer) {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let i = 0;
  j = 0;
  return Buffer.from(
    [...data].map((byte) => {
      i = (i + 1) & 255;
      j = (j + state[i]) & 255;
      [state[i], state[j]] = [state[j], state[i]];
      return byte ^ state[(state[i] + state[j]) & 255];
    }),
  );
}
function pdf(dimensions: number[][], active = false, encrypted = false) {
  const objects: Buffer[] = [
    Buffer.from(
      "<< /Type /Catalog /Pages 2 0 R" +
        (active
          ? " /OpenAction << /S /JavaScript /JS (app.alert\\(UNTRUSTED_SCRIPT\\)) >> /Names << /EmbeddedFiles << /Names [(private.txt) << /Type /Filespec /F (private.txt) >>] >> >>"
          : "") +
        " >>",
    ),
    Buffer.from(""),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  const pad = Buffer.from(
      "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
      "hex",
    ),
    password = (s: string) =>
      Buffer.concat([Buffer.from(s), pad]).subarray(0, 32),
    md5 = (b: Buffer) => createHash("md5").update(b).digest(),
    identifier = Buffer.alloc(16, 7);
  const ownerKey = rc4(md5(password("owner")).subarray(0, 5), password("user")),
    permission = Buffer.from("fcffffff", "hex"),
    documentKey = md5(
      Buffer.concat([password("user"), ownerKey, permission, identifier]),
    ).subarray(0, 5),
    userKey = rc4(documentKey, pad);
  const pageIds: number[] = [];
  for (const [width, height] of dimensions) {
    const page = objects.length + 1,
      stream = page + 1;
    pageIds.push(page);
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R${active ? " /Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 50 50] /A << /S /URI /URI (https://example.invalid/NO_FETCH) >> >>]" : ""} >>`,
      ),
    );
    let content = Buffer.from(
      `BT /F1 16 Tf 30 40 Td (Synthetic page ${pageIds.length}) Tj ET`,
    );
    if (encrypted) {
      const number = Buffer.alloc(5);
      number.writeUIntLE(stream, 0, 3);
      content = rc4(
        md5(Buffer.concat([documentKey, number])).subarray(0, 10),
        content,
      );
    }
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
        content,
        Buffer.from("\nendstream"),
      ]),
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((p) => p + " 0 R").join(" ")}] >>`,
  );
  if (encrypted)
    objects.push(
      Buffer.from(
        `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${ownerKey.toString("hex")}> /U <${userKey.toString("hex")}> >>`,
      ),
    );
  const chunks = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
        .join(
          "",
        )}trailer\n<< /Size ${offsets.length} /Root 1 0 R${encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<${identifier.toString("hex")}> <${identifier.toString("hex")}>]` : ""} >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
test("PDF downloads use newly rendered pages without source actions, links or embedded files", async () => {
  const raw = pdf(
      [
        [300, 200],
        [400, 300],
      ],
      true,
    ),
    file = await upload(client, client.userId, {
      fileName: "Plan.pdf",
      mime: "application/pdf",
      contentBase64: raw.toString("base64"),
    });
  assert.equal(file.pages, 2);
  assert.equal(file.passiveCopy, true);
  const download = await req(client, "/chat/attachments/" + file.id);
  assert.equal(download.statusCode, 200, download.body);
  assert.match(String(download.headers["content-disposition"]), /^attachment;/);
  const copy = download.rawPayload.toString("latin1");
  assert.equal((copy.match(/\/Subtype \/Image/g) ?? []).length, 2);
  assert.match(copy, /\/Count 2/);
  assert.doesNotMatch(
    copy,
    /JavaScript|OpenAction|EmbeddedFiles|UNTRUSTED_SCRIPT|NO_FETCH|\/URI|\/Annots/,
  );
  for (const invalid of [
    Buffer.from("%PDF-corrupt"),
    pdf([
      [300, 200],
      [5000, 300],
    ]),
    pdf(Array.from({ length: 21 }, () => [300, 200])),
    pdf([[300, 200]], false, true),
  ]) {
    const response = await req(
      client,
      "/chat/attachments",
      "POST",
      uploadBody(client.userId, {
        fileName: "Invalid.pdf",
        mime: "application/pdf",
        contentBase64: invalid.toString("base64"),
      }),
    );
    assert.equal(response.statusCode, 400, response.body);
  }
});
