import type { Actor, Database } from "@trainer/db";
import { putRecord } from "@trainer/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { normalizeAnswer } from "../../../packages/domain/src/onboarding-language.ts";
import { forwardWorkspaceRequest as forward } from "./internal-request.ts";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function profileSummary(facts: Record<string, any>) {
  return [facts.goal && `Goal: ${facts.goal}`, facts.experience && `Experience: ${facts.experience}`,
    facts.daysPerWeek && `Training: ${facts.daysPerWeek} days a week`,
    facts.availableWeekdays && `Available days: ${facts.availableWeekdays.map((d: number) => weekdays[d]).join(", ")}`,
    facts.maxSessionMinutes && `Session length: ${facts.maxSessionMinutes} minutes`, facts.equipment && `Equipment: ${facts.equipment}`,
    facts.age && `Age: ${facts.age}`, facts.limitations && `Movement and health notes: ${facts.limitations}`,
  ].filter(Boolean).join("\n").slice(0, 2600);
}

/** Route app operations only. This selects a capability, never extracts profile facts. */
export function memberChatIntent(input: string): "profile" | "edit_profile" | "training" | "nutrition" | "progress" | undefined {
  const text = normalizeAnswer(input);
  if (/\b(?:don't|do not|not yet|before|if|maybe|suppose)\b/.test(text)) return;
  const read = /^(?:please |can you |could you |i(?:'d| would) like to )?(?:show|check|review|open|see|summari[sz]e|what (?:is|are|do you have)|where|how (?:am i|is my)|take me|look at)\b/.test(text);
  if (read && /\b(?:profile|preferences|saved (?:details|answers)|my details)\b/.test(text)) return "profile";
  if (read && /\b(?:progress|completed|workout history)\b/.test(text)) return "progress";
  if (read && /\b(?:nutrition|meal plan|food plan)\b/.test(text)) return "nutrition";
  if (read && /\b(?:training|workouts?|my plan|schedule)\b/.test(text)) return "training";
  // Questions seeking advice continue to the coach; explicit change requests use
  // the evidence-grounded profile editor and still need a visible save confirmation.
  if (/^(?:should|could|would|what if|do you think)\b/.test(text)) return;
  if (/\b(?:change|update|edit|correct|adjust|set)\b.{0,45}\b(?:profile|goal|availability|available days|session length|equipment|fitness level|training days)\b/.test(text) ||
      /\b(?:i (?:can|want to|will|now)|i'm|i am|actually|instead)\b.{0,65}\b(?:days (?:a|per) week|minutes (?:per|a|each) session|train (?:on|at)|available|no longer have|home gym)\b/.test(text) ||
      /\b(?:my (?:goal|availability|equipment|schedule) (?:is|has|changed)|i can only train|i only have \d+ minutes|\w+ no longer works)\b/.test(text)) return "edit_profile";
}

/** Read authoritative saved state or continue a profile edit in the same member thread. */
export async function memberChatAction(app: FastifyInstance, db: Database, req: FastifyRequest, a: Actor,
  text: string, requestMessageId: string, intake: any) {
  const intent = memberChatIntent(text);
  const [last] = await db.tenant(a, tx => tx.query("SELECT data FROM records WHERE kind='message' AND owner_user_id=$1 AND data->>'author'<>'subscriber' ORDER BY created_at DESC,id DESC LIMIT 1", [a.userId]));
  const explicitEditReply = /^(?:yes|yes please|save(?: these)? changes|save it|confirm|apply(?: these)? changes|cancel|cancel (?:that|the changes)|keep my saved profile|discard (?:these )?changes|never mind|nevermind)[.! ]*$/i.test(text.trim());
  const [draft] = explicitEditReply ? await db.tenant(a, tx => tx.query("SELECT data FROM records WHERE kind='onboarding_chat' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [a.userId])) : [];
  const editing = intent === "edit_profile" || !intent && (!!last?.data.profileEditing || explicitEditReply && !!draft?.data.profileEditing);
  if (!intent && !editing) return null;
  let response = "", actions: string[] = [], profileEditing = false, suggestions: string[] = [];
  if (intent === "profile") {
    response = "Here's the profile currently saved for your coaching. Tell me what you'd like to change.\n\n" + profileSummary(intake.data);
    actions = ["profile"]; suggestions = ["Change my profile"];
  } else if (intent === "training") {
    const rows = await db.tenant(a, tx => tx.query("SELECT kind,status,data FROM records WHERE owner_user_id=$1 AND ((kind='program' AND status='assigned') OR (kind='plan_generation')) ORDER BY created_at DESC,id DESC LIMIT 12", [a.userId]));
    const program = rows.find(r => r.kind === "program"), generation = rows.find(r => r.kind === "plan_generation");
    response = program ? `Your current training plan is ${program.data.title ?? "your assigned programme"}.\n` +
      (program.data.exercises ?? []).slice(0, 6).map((e: any) => e.name).join(" · ") + "\nOpen Training for the full sessions and saved workout logs. Tell me which part you'd like to adjust."
      : generation ? "Your plan is being prepared or needs review. Open Training to see its current status."
      : "There isn't an assigned workout yet. Open Training to check the next step.";
    actions = ["training"];
  } else if (intent === "nutrition") {
    const [consent] = await db.tenant(a, tx => tx.query("SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='nutrition' ORDER BY created_at DESC,id DESC LIMIT 1", [a.userId]));
    const rows = consent?.granted ? await db.tenant(a, tx => tx.query("SELECT kind,status,data FROM records WHERE owner_user_id=$1 AND ((kind='nutrition_profile' AND status='current') OR (kind='nutrition_plan' AND status='delivered')) ORDER BY created_at DESC,id DESC LIMIT 4", [a.userId])) : [];
    const plan = rows.find(r => r.kind === "nutrition_plan"), profile = rows.find(r => r.kind === "nutrition_profile");
    response = plan ? "Your meal plan is ready in Nutrition. You can check the meals, log what you ate and edit your food preferences there."
      : profile ? "Your food preferences are saved. Open Nutrition to check meal preparation and make changes."
      : "Open Nutrition to check food support and set your preferences when you're ready.";
    actions = ["nutrition"];
  } else if (intent === "progress") {
    const [count] = await db.tenant(a, tx => tx.query("SELECT count(*)::int AS total FROM records WHERE owner_user_id=$1 AND kind='workout' AND status='completed' AND (data->>'completedAt')::timestamptz>=now()-interval '28 days'", [a.userId]));
    response = `You have ${count?.total ?? 0} completed workouts recorded in the last 28 days. Open Progress to review your logs. These records alone don't tell us how your body composition has changed.`;
    actions = ["progress"];
  } else if (editing) {
    const before = await forward(app, req, "GET", "/api/v1/onboarding-chat");
    const editRequestId = randomUUID();
    const cancel = /^(?:cancel|cancel (?:that|the changes)|keep my saved profile|discard (?:these )?changes|never mind|nevermind)[.! ]*$/i.test(text.trim());
    const after = cancel
      ? await forward(app, req, "POST", "/api/v1/onboarding-chat/actions", { id: editRequestId, version: before.version, action: "discard-profile" })
      : await forward(app, req, "POST", "/api/v1/onboarding-chat/messages", { id: editRequestId, version: before.version, text, purpose: "profile_edit", timezone: intake.data.timezone ?? "Asia/Dubai" });
    const known = new Set(before.messages.map((m: any) => m.id));
    response = after.messages.filter((m: any) => m.from === "assistant" && !known.has(m.id)).map((m: any) => m.text).join("\n\n");
    if (after.error) response = "Your message is saved. " + after.error;
    profileEditing = !cancel && !!after.profileEditing;
    actions = ["profile"];
    if (!after.error && after.profileDirty && after.ready && after.lastQuestion?.field === "review") {
      response = "Here's the proposed profile. These changes aren't saved yet.\n\n" + profileSummary(after.facts) + "\n\nSave these changes, or tell me what else to adjust?";
      suggestions = ["Save these changes", "Keep my saved profile"];
    } else if (after.error && after.profileDirty) suggestions = ["Keep my saved profile"];
    else if (!profileEditing && after.applied.profile) actions.push("training");
    if (!response) response = "What would you like to change in your profile?";
  }
  const message = await db.tenant(a, tx => putRecord(tx, a, "message", {
    text: response.slice(0, 4000), author: "system", subscriberId: a.userId, requestMessageId,
    actions, profileEditing, ...(suggestions.length ? { suggestions } : {}),
  }, { status: "sent" }));
  return { messageId: message.id, message: message.data.text, messageSaved: true, pendingReview: false };
}
import { randomUUID } from "node:crypto";
