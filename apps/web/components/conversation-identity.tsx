"use client";
import { useT } from "../lib/i18n/react";

export function conversationKind(author?: string) {
  if (author === "subscriber") return "member";
  if (author === "trainer") return "personal";
  if (
    ["digital", "digital_qualified", "digital_reviewed"].includes(author ?? "")
  )
    return "assisted";
  return "update";
}

/** Colour always has a text equivalent. Stored authorship is never relabelled. */
export function ConversationIdentity({
  author,
  coach,
  client,
  trainer = false,
}: {
  author?: string;
  coach: string;
  client?: string;
  trainer?: boolean;
}) {
  const t = useT("chat"),
    kind = conversationKind(author);
  const name =
    kind === "member"
      ? trainer
        ? client || t("client")
        : t("you")
      : kind === "personal"
        ? trainer
          ? t("you")
          : coach
        : kind === "assisted"
          ? coach
          : t("update");
  return (
    <span className="conversation-identity" data-author-kind={kind}>
      <strong dir="auto">{name}</strong>
      {(kind === "assisted" || kind === "personal") && (
        <span
          className={`conversation-source is-${kind}`}
          title={
            kind === "assisted"
              ? t(
                  author === "digital_reviewed"
                    ? "reviewedExplanation"
                    : "assistedExplanation",
                  { coach },
                )
              : t("personalExplanation", { coach })
          }
        >
          <i aria-hidden="true" />
          {t(kind === "assisted" ? "assisted" : "personalReply")}
        </span>
      )}
    </span>
  );
}

export function ConversationLegend({ coach }: { coach: string }) {
  const t = useT("chat");
  return (
    <div className="conversation-legend">
      <p>
        <span className="conversation-source is-assisted">
          <i aria-hidden="true" />
          {t("assisted")}
        </span>{" "}
        {t("assistedExplanation", { coach })}
      </p>
      <p>
        <span className="conversation-source is-personal">
          <i aria-hidden="true" />
          {t("personalReply")}
        </span>{" "}
        {t("personalExplanation", { coach })}
      </p>
    </div>
  );
}
