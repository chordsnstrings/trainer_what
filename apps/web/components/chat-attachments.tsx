"use client";
import { useRef, useState } from "react";

export type ChatAttachment = {
  id: string;
  fileName: string;
  mime: string;
  bytes: number;
  uploadedBy: string;
  subjectId: string;
  width?: number;
  height?: number;
  pages?: number;
};
async function request(path: string, method: string, body?: unknown) {
  const response = await fetch("/api/v1/chat/attachments" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok && !(method === "DELETE" && response.status === 404))
    throw new Error(result.message ?? "The attachment could not be saved");
  return result;
}
function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("This file could not be read"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}
export function ChatAttachmentList({
  files,
  user,
  onRemove,
  disabled = false,
}: {
  files: ChatAttachment[];
  user: { userId: string; role: string };
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const [removing, setRemoving] = useState(""),
    [error, setError] = useState("");
  async function remove(file: ChatAttachment) {
    setRemoving(file.id);
    setError("");
    try {
      await request("/" + file.id, "DELETE");
      onRemove(file.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemoving("");
    }
  }
  return (
    <div>
      {error && <p role="alert">{error}</p>}
      {files.map((file) => (
        <figure key={file.id} style={{ margin: "12px 0", maxWidth: 340 }}>
          <a
            href={"/api/v1/chat/attachments/" + file.id}
            target="_blank"
            rel="noreferrer"
          >
            {file.mime === "image/jpeg" ? (
              <img
                src={"/api/v1/chat/attachments/" + file.id}
                alt={file.fileName}
                loading="lazy"
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: 260,
                  objectFit: "contain",
                  borderRadius: "var(--radius)",
                }}
              />
            ) : (
              <>Download {file.fileName}</>
            )}
          </a>
          <figcaption className="muted" style={{ overflowWrap: "anywhere" }}>
            {file.mime === "image/jpeg" && file.fileName + " · "}
            {Math.max(1, Math.round(file.bytes / 1024))} KB
            {file.pages ? ` · ${file.pages} pages` : ""}
          </figcaption>
          {(user.role === "owner" ||
            user.userId === file.uploadedBy ||
            user.userId === file.subjectId) && (
            <button
              type="button"
              className="text-button"
              disabled={disabled || !!removing}
              onClick={() => void remove(file)}
            >
              {removing === file.id ? "Removing…" : "Remove file"}
            </button>
          )}
        </figure>
      ))}
    </div>
  );
}
export function ChatAttachmentPicker({
  subjectId,
  files,
  user,
  onChange,
  onBusy,
  disabled,
}: {
  subjectId: string;
  files: ChatAttachment[];
  user: { userId: string; role: string };
  onChange: (files: ChatAttachment[]) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [rights, setRights] = useState(false),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false),
    retries = useRef(new Map<string, string>());
  async function upload(chosen: File[]) {
    setError("");
    if (chosen.length + files.length > 5) {
      setError("Attach up to five files to one message");
      return;
    }
    setUploading(true);
    onBusy(true);
    let current = files;
    try {
      for (const file of chosen) {
        if (!file.size || file.size > 5 * 1024 * 1024)
          throw new Error("Each photo or PDF must be under 5 MB");
        const mime =
          file.type ||
          (
            {
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              png: "image/png",
              webp: "image/webp",
              pdf: "application/pdf",
            } as Record<string, string>
          )[file.name.split(".").pop()?.toLowerCase() ?? ""];
        if (
          ![
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
          ].includes(mime ?? "")
        )
          throw new Error("Choose a JPEG, PNG, WebP or PDF file");
        const intent = `${subjectId}:${file.name}:${file.size}:${file.lastModified}`;
        if (!retries.current.has(intent))
          retries.current.set(intent, crypto.randomUUID());
        const saved = await request("", "POST", {
          subjectId,
          requestKey: retries.current.get(intent),
          fileName: file.name,
          mime,
          contentBase64: await fileData(file),
          rightsConfirmed: rights,
        });
        current = [...current.filter((item) => item.id !== saved.id), saved];
        onChange(current);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      onBusy(false);
    }
  }
  return (
    <fieldset
      disabled={disabled || uploading || !subjectId}
      style={{ marginBlock: 16 }}
    >
      <legend>Photos and PDFs</legend>
      <p className="muted">
        Up to five files, 5 MB each. PDFs allow up to 20 pages and are shared as
        viewing copies. Unsent files expire after 24 hours.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={rights}
          onChange={(event) => setRights(event.target.checked)}
        />{" "}
        I have permission to share these files in this conversation.
      </label>
      <label className="field">
        <span>Choose photos or PDFs</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          disabled={!rights || files.length >= 5}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (selected.length) void upload(selected);
          }}
        />
      </label>
      {uploading && <p role="status">Preparing your attachments…</p>}
      {error && <p role="alert">{error}</p>}
      <ChatAttachmentList
        files={files}
        user={user}
        disabled={disabled || uploading}
        onRemove={(id) => {
          retries.current.clear();
          onChange(files.filter((file) => file.id !== id));
        }}
      />
    </fieldset>
  );
}
