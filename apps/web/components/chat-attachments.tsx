"use client";
import { useErrorText, useT } from "../lib/i18n/react";
import { FileInput } from "./phone-ui";
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
    throw Object.assign(
      new Error(result.message ?? "The attachment could not be saved"),
      { status: response.status, code: result.code },
    );
  return result;
}
function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(
        Object.assign(new Error("This file could not be read"), {
          code: "ATTACHMENT_DATA",
        }),
      );
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
  const t = useT("training"),
    toError = useErrorText();
  async function remove(file: ChatAttachment) {
    setRemoving(file.id);
    setError("");
    try {
      await request("/" + file.id, "DELETE");
      onRemove(file.id);
    } catch (e) {
      setError(toError(e));
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
              <>{t("download", { name: file.fileName })}</>
            )}
          </a>
          <figcaption className="muted" style={{ overflowWrap: "anywhere" }}>
            {file.mime === "image/jpeg" && (
              <>
                <bdi>{file.fileName}</bdi>
                {" · "}
              </>
            )}
            {t("sizeKb", { kb: Math.max(1, Math.round(file.bytes / 1024)) })}
            {file.pages ? t("pages", { count: file.pages }) : ""}
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
              {removing === file.id ? t("removing") : t("removeFile")}
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
  const t = useT("training"),
    toError = useErrorText();
  async function upload(chosen: File[]) {
    setError("");
    if (chosen.length + files.length > 5) {
      setError(t("upToFive"));
      return;
    }
    setUploading(true);
    onBusy(true);
    let current = files;
    try {
      for (const file of chosen) {
        if (!file.size || file.size > 5 * 1024 * 1024)
          throw Object.assign(new Error(t("under5mb")), { local: true });
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
          throw Object.assign(new Error(t("fileTypes")), { local: true });
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
      // Checks made here are already in the member's language.
      setError(
        (e as { local?: boolean }).local ? (e as Error).message : toError(e),
      );
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
      <legend>{t("photosPdfs")}</legend>
      <p className="muted">{t("attachHelp")}</p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={rights}
          onChange={(event) => setRights(event.target.checked)}
        />{" "}
        {t("permission")}
      </label>
      <FileInput
        label={t("photosOrPdfs")}
        buttonLabel={t("attach")}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        disabled={!rights || files.length >= 5}
        disabledReason={
          files.length >= 5
            ? t("mostFiles")
            : !rights
              ? t("tickPermission")
              : undefined
        }
        emptyText={files.length ? "" : t("noFiles")}
        onFiles={(selected) => void upload(selected)}
      />
      {uploading && <p role="status">{t("preparing")}</p>}
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
