"use client";
import { Field } from "./field";
import { SafetyReviewDue } from "./safety-review-due";
import { TrainingHoldReview } from "./coaching-completion";
import {
  ExceptionCorrection,
  CoachingFeedbackQueue,
} from "./coaching-feedback";
import { urgentFirst } from "./workspace-paging";
import { unsavedMark } from "./pwa";
import { useState } from "react";
import { ArrowRight, Check, Brain } from "lucide-react";
import {
  type Row,
  LoadMore,
  api,
  Button,
  Empty,
  Badge,
  Card,
  Heading,
  type ViewProps,
  total,
} from "./workspace-ui";
export function Messages({ state, records, action, busy }: ViewProps) {
  const sub = state.user.role === "subscriber";
  const [target, setTarget] = useState(
    sub
      ? state.user.userId
      : (state.members?.find((m) => m.role === "subscriber")?.id ?? ""),
  );
  const [text, setText] = useState("");
  const messages = records("message")
    .filter((m) => m.data.subscriberId === target)
    .reverse();
  return (
    <>
      <Heading
        eyebrow="A HUMAN CONNECTION"
        title={sub ? "Talk to your coach." : "Stay close to your people."}
        detail="Digital guidance is identified clearly. Human conversations always have room here."
      />
      <Card>
        {!sub && (
          <div className="button-row">
            <select
              aria-label="Select subscriber"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose subscriber</option>
              {state.members
                ?.filter((m) => m.role === "subscriber")
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <Button
              secondary
              onClick={() =>
                void action(
                  () =>
                    api("/takeover", "POST", {
                      subscriberId: target,
                      active: true,
                    }),
                  "Human takeover enabled",
                )
              }
            >
              Take over
            </Button>
            <Button
              secondary
              onClick={() =>
                void action(
                  () =>
                    api("/takeover", "POST", {
                      subscriberId: target,
                      active: false,
                    }),
                  "Digital review flow resumed",
                )
              }
            >
              Resume digital review
            </Button>
          </div>
        )}
        <div className="conversation">
          {messages.length ? (
            messages.map((m) => (
              <div
                key={m.id}
                className={
                  "message " +
                  (m.data.author === "subscriber" ? "from-client" : "")
                }
              >
                <span className="small-label">
                  {m.data.author === "digital_reviewed"
                    ? "Digital coach · trainer reviewed"
                    : m.data.author}
                </span>
                <p>{m.data.text}</p>
                <small>
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </div>
            ))
          ) : (
            <Empty
              title="Start a useful conversation"
              detail="Share a question, an observation or the context behind a workout."
            />
          )}
        </div>
        <form
          {...unsavedMark(!!text.trim())}
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () => api("/messages", "POST", { text, subscriberId: target }),
              "Message sent",
            ).then((r) => {
              if (r) setText("");
            });
          }}
        >
          <Field label="Your message">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              minLength={1}
              required
              rows={3}
              placeholder="What would you like your coach to know?"
            />
          </Field>
          <div className="button-row">
            <Button type="submit" disabled={busy || !target}>
              Send to {sub ? "trainer" : "subscriber"}
              <ArrowRight size={16} />
            </Button>
            {sub && (
              <Button
                secondary
                disabled={busy || !text}
                onClick={() =>
                  void action(
                    () => api("/coaching/ask", "POST", { message: text }),
                    "Sent to digital coaching for review",
                  ).then((r) => {
                    if (r) setText("");
                  })
                }
              >
                Ask digital coach <Brain size={16} />
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  );
}
/**
 * The decision an exception quotes. The bootstrap pins the decisions of the
 * exceptions it sends and every older attention-list page carries its own, so
 * no card needs a request of its own.
 */
export function DecisionQuote({ known }: { known?: Row }) {
  const message = known?.data?.message;
  return message ? <blockquote>{message}</blockquote> : null;
}
export function Exceptions({ records, state, action, busy, more }: ViewProps) {
  const exceptions = urgentFirst(
    records("exception").filter((e) => e.status === "open"),
  );
  return (
    <>
      <TrainingHoldReview
        onChange={() => action(async () => {}, "Training review saved")}
      />
      <Heading
        title="Needs you."
        detail="Safety reports, questions for you and replies your Brain was unsure about. The inbox shows these too."
      />
      {exceptions.length ? (
        exceptions.map((e) => (
          <Card key={e.id}>
            <div className="card-heading">
              <Badge tone={e.data.category === "safety" ? "amber" : ""}>
                {e.data.category.replaceAll("_", " ")}
              </Badge>
              <span className="muted">
                {state.members?.find((m) => m.id === e.data.subscriberId)
                  ?.name ?? "Subscriber"}
              </span>
            </div>
            <h3>{e.data.description}</h3>
            <SafetyReviewDue record={e} />
            {e.data.decisionId && (
              <DecisionQuote
                known={records("decision").find(
                  (d) => d.id === e.data.decisionId,
                )}
              />
            )}
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                const f = new FormData(ev.currentTarget);
                void action(
                  () =>
                    api(`/exceptions/${e.id}/resolve`, "POST", {
                      ...(String(f.get("note") ?? "").trim()
                        ? { note: String(f.get("note")).trim() }
                        : {}),
                      approveDecision: f.get("approve") === "on",
                    }),
                  "Review recorded",
                );
              }}
            >
              <Field label="A note for your records (needed only if you close it without sending anything)">
                <textarea name="note" rows={2} />
              </Field>
              {e.data.decisionId && (
                <label className="check-field">
                  <input name="approve" type="checkbox" />
                  Send your Brain’s reply
                </label>
              )}
              <Button type="submit" disabled={busy}>
                Done <Check size={16} />
              </Button>
            </form>
            {e.data.decisionId && (
              <ExceptionCorrection
                exceptionId={e.id}
                onChange={() =>
                  action(async () => {}, "Coaching correction saved")
                }
              />
            )}
          </Card>
        ))
      ) : (
        <Card>
          <Empty
            title="Nothing needs you right now"
            detail="Safety reports, questions for you and replies your Brain was unsure about will appear here."
          />
        </Card>
      )}
      {exceptions.length > 0 && (
        <p className="muted" role="status">
          Showing {exceptions.length} of{" "}
          {total(state, "openExceptions", exceptions.length)} open items
        </p>
      )}
      <LoadMore
        more={more}
        collection="records"
        kind="exception"
        label="Load older open items"
      />
      <CoachingFeedbackQueue owner={state.user.role === "owner"} />
    </>
  );
}
