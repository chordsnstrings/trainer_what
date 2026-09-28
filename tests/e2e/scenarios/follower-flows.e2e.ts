/**
 * Follower scenarios over the seeded platform: training, chat, digital
 * coaching, bookings, nutrition, wearables, notifications, billing, account
 * and privacy. Each step names the inventory feature it proves.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { E2EContext, FollowerSeed } from "../harness/context.ts";
import { PASSWORD, sampleJpeg } from "../harness/data.ts";
import { linkIn } from "../mocks/email.ts";
import { fixtureProfile } from "../../nutrition-fixtures.ts";

const F = "followers" as const;
const T = "Trainers" as const;
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function followerFlows(ctx: E2EContext) {
  const paid = ctx.followers.filter((f) => f.paid);
  if (!paid.length) {
    ctx.reporter.skip(F, "Start a workout", "follower scenarios", "no follower completed checkout");
    return;
  }
  const layla = ctx.trainers.find((t) => t.slug === "layla-strength");
  const laylaPaid = paid.filter((f) => f.trainer === layla);
  const workout = laylaPaid.find((f) => f.tier === "workout") ?? paid[0];
  const nutrition = laylaPaid.find((f) => f.tier === "workout_nutrition");
  const billingFollower = paid.find(
    (f) => f !== workout && f.tier === "workout" && f.checkout?.chargeId && f.trainer === layla,
  );
  await training(ctx, workout);
  await chat(ctx, workout);
  await digitalCoach(ctx, workout);
  await bookings(ctx, workout);
  if (nutrition) {
    await nutritionFlows(ctx, nutrition);
    await premiumVoice(ctx, nutrition);
  } else ctx.reporter.skip(F, "Weekly meal plans", "nutrition tier", "no workout + nutrition follower paid");
  await wearables(ctx, workout);
  await notifications(ctx, workout);
  if (billingFollower) await billing(ctx, billingFollower);
  await account(ctx, workout);
  await privacy(ctx, paid.at(-1)!);
  await unpaidGating(ctx);
}

async function training(ctx: E2EContext, f: FollowerSeed) {
  const { client: c, trainer } = f;
  const t = trainer.client;
  let program: any, workout: any, setEvent: any;
  let planned: any[] = [];
  await ctx.reporter.step(T, "Assign a program and auto-schedule the calendar", `${trainer.slug}: template assigned to ${c.label}`, async () => {
    const template = (await t.get("/api/v1/training/overview")).records.find((r: any) => r.id === trainer.programTemplateId);
    program = await t.post(`/api/v1/programs/${trainer.programTemplateId}/assign`, {
      subscriberId: c.userId,
      version: template.version,
      startDate: today(),
      timezone: "Asia/Dubai",
    });
    assert.equal(program.status, "assigned");
  });
  await ctx.reporter.step(F, "View assigned program and training calendar", `${c.label}: sees the program and planned sessions`, async () => {
    const overview = await c.get("/api/v1/training/overview");
    planned = overview.records
      .filter((r: any) => r.kind === "planned_session" && r.status === "planned")
      .sort((a: any, b: any) => a.data.date.localeCompare(b.data.date));
    assert.ok(overview.records.some((r: any) => r.id === program.id));
    assert.ok(planned.length >= 3, "sessions scheduled");
    return `${planned.length} planned sessions`;
  });
  await ctx.reporter.step(F, "Move or skip a planned session", `${c.label}: moves the last session by one day`, async () => {
    const last = planned.at(-1);
    const next = new Date(last.data.date + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    await c.post(`/api/v1/training/sessions/${last.id}/reschedule`, {
      version: last.version,
      date: next.toISOString().slice(0, 10),
      note: "Travelling that day",
    });
  });
  await ctx.reporter.step(F, "Start a workout", `${c.label}: starts the first planned session`, async () => {
    workout = await c.post("/api/v1/workouts/start", { programId: program.id, plannedSessionId: planned[0].id });
    assert.equal(workout.status, "active");
  });
  await ctx.reporter.step(F, "Swap to a coach-approved alternative exercise", `${c.label}: squat swapped for goblet squat`, async () => {
    await c.post(`/api/v1/workouts/${workout.id}/substitute`, {
      version: workout.version,
      exercise: "Barbell back squat",
      replacement: "Goblet squat",
      reason: "equipment_unavailable",
    });
    await c.fails(400, "POST", `/api/v1/workouts/${workout.id}/substitute`, {
      version: workout.version + 1,
      exercise: "Push-up",
      replacement: "Bench press",
      reason: "coach_preference",
    });
  });
  await ctx.reporter.step(F, "Log sets (reps, weight, effort, notes)", `${c.label}: three sets logged, retries are idempotent`, async () => {
    for (let set = 1; set <= 3; set++) {
      const body = {
        eventKey: randomUUID(),
        exercise: "Goblet squat",
        set,
        reps: 10,
        loadKg: 20,
        rir: 2,
        ...(set === 3 ? { notes: "Felt solid" } : {}),
      };
      const saved = await c.post(`/api/v1/workouts/${workout.id}/sets`, body);
      const again = await c.post(`/api/v1/workouts/${workout.id}/sets`, body);
      assert.equal(again.id ?? JSON.stringify(again), saved.id ?? JSON.stringify(saved), "replay returns the same event");
      setEvent ??= saved;
    }
  });
  await ctx.reporter.step(F, "Correct a saved set", `${c.label}: corrects the first set`, async () => {
    const eventId = setEvent?.id ?? setEvent?.event?.id;
    assert.ok(eventId, "set event id: " + JSON.stringify(setEvent).slice(0, 200));
    const correction = await c.post(`/api/v1/workouts/${workout.id}/sets/${eventId}/correct`, {
      revision: 0,
      reps: 9,
      loadKg: 20,
      rir: 1,
      note: "Miscounted the reps",
    });
    assert.equal(correction.data.revision, 1);
  });
  await ctx.reporter.step(F, "Guided session with cues and rest timers", `${c.label}: guided segments available`, async () => {
    const guided = await c.get(`/api/v1/guided/${workout.id}`);
    assert.ok(guided.segments.length >= 1);
    return `premium=${guided.premium}, audioAvailable=${guided.audioAvailable}`;
  });
  await ctx.reporter.step(F, "Finish or end a workout early", `${c.label}: finishes the workout`, async () => {
    await c.post(`/api/v1/workouts/${workout.id}/finish`, {});
    const overview = await c.get("/api/v1/training/overview");
    assert.equal(overview.records.find((r: any) => r.id === workout.id).status, "completed");
  });
  await ctx.reporter.step(T, "Correct a subscriber's logged sets", `${trainer.slug}: sees the corrected set`, async () => {
    const overview = await t.get(`/api/v1/training/overview?subscriberId=${c.userId}`);
    assert.ok(overview.records.some((r: any) => r.kind === "workout_correction"));
    assert.ok(overview.sets.length >= 3);
  });
  await ctx.reporter.step(T, "Adjust exercises and reschedule or cancel sessions", `${trainer.slug}: progression revises the assigned program`, async () => {
    const current = (await t.get(`/api/v1/training/overview?subscriberId=${c.userId}`)).records.find(
      (r: any) => r.kind === "program" && r.status === "assigned" && r.owner_user_id === c.userId,
    );
    const revised = await t.post(`/api/v1/programs/${current.id}/progression`, {
      version: current.version,
      exercise: "Push-up",
      loadKg: 5,
      reps: 10,
      rir: 2,
      note: "Add a light plate next week",
    });
    assert.equal(revised.status, "assigned");
  });
  await ctx.reporter.step(F, "Report pain during a workout", `${c.label}: pain report pauses training`, async () => {
    const assigned = (await c.get("/api/v1/training/overview")).records.find((r: any) => r.kind === "program" && r.status === "assigned");
    const w2 = await c.post("/api/v1/workouts/start", { programId: assigned.id });
    const report = await c.post(`/api/v1/workouts/${w2.id}/pain`, { description: "Sharp pain in my left knee on the second set" });
    assert.ok(report.holdId);
    const blocked = await c.request("POST", "/api/v1/workouts/start", { programId: assigned.id });
    assert.ok(blocked.status >= 400, "training is paused");
  });
  await ctx.reporter.step(T, "Safety holds and hold review", `${trainer.slug}: reviews the hold and ends the session`, async () => {
    const hold = (await t.get("/api/v1/training/holds")).find((h: any) => h.owner_user_id === c.userId && h.status === "active");
    assert.ok(hold, "hold visible to the trainer");
    await t.post(`/api/v1/training/holds/${hold.id}/resolve`, {
      version: hold.version,
      action: "abandon",
      note: "Rest the knee this week and message me before training again.",
      reviewed: true,
    });
  });
  await ctx.reporter.step(F, "Trainer's decision on a safety pause", `${c.label}: notified of the trainer's decision`, async () => {
    const inbox = await c.get("/api/v1/notifications");
    const items = inbox.items ?? inbox.notifications ?? inbox;
    assert.ok(JSON.stringify(items).match(/ended the paused session|resumed your session/i), JSON.stringify(inbox).slice(0, 300));
  });
}

async function chat(ctx: E2EContext, f: FollowerSeed) {
  const { client: c, trainer } = f;
  const t = trainer.client;
  await ctx.reporter.step(F, "Message your trainer", `${c.label} ↔ ${trainer.slug}: two-way chat`, async () => {
    await c.post("/api/v1/messages", { text: "Hi coach, the new program feels great so far." });
    await t.post("/api/v1/messages", { text: "Great to hear. Keep the rest periods honest.", subscriberId: c.userId });
    const thread = await c.get("/api/v1/messages/thread");
    assert.ok(JSON.stringify(thread).includes("rest periods honest"));
  });
  await ctx.reporter.step(F, "Send photos and PDFs in chat", `${c.label}: attaches a photo the trainer can download`, async () => {
    const image = await sampleJpeg("#223344", 3);
    const attachment = await c.post("/api/v1/chat/attachments", {
      subjectId: c.userId,
      requestKey: randomUUID(),
      fileName: "form-check.jpg",
      mime: "image/jpeg",
      contentBase64: image.toString("base64"),
      rightsConfirmed: true,
    });
    await c.post("/api/v1/messages", { text: "Form check photo", attachmentIds: [attachment.id] });
    const download = await t.request("GET", `/api/v1/chat/attachments/${attachment.id}`, undefined, { raw: true });
    assert.equal(download.status, 200);
  });
  await ctx.reporter.step(F, "Automatic safety pause from worrying messages", `${c.label}: chest pain message opens a hold`, async () => {
    await c.post("/api/v1/messages", { text: "I felt chest pain and dizziness after yesterday's session." });
    const hold = (await t.get("/api/v1/training/holds")).find((h: any) => h.owner_user_id === c.userId && h.status === "active");
    assert.ok(hold, "hold opened from chat");
    await t.post(`/api/v1/training/holds/${hold.id}/resolve`, {
      version: hold.version,
      action: "resume",
      note: "We spoke by phone; cleared to continue at easy effort.",
      reviewed: true,
    });
  });
  await ctx.reporter.step(T, "Scheduled follow-up messages", `${trainer.slug}: schedules a follow-up for ${c.label}`, async () => {
    const r = await t.post("/api/v1/coaching/followups", {
      subscriberId: c.userId,
      requestKey: randomUUID(),
      text: "How did the week go? Reply with your hardest set.",
      dueAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      timezone: "Asia/Dubai",
      reviewed: true,
    });
    assert.ok(r.id);
  });
  await ctx.reporter.step(T, "Personal takeover of a client", `${trainer.slug}: takes over, digital coach defers, then hands back`, async () => {
    await t.post("/api/v1/takeover", { subscriberId: c.userId, active: true });
    const reply = await c.post("/api/v1/coaching/ask", { message: "Can I add an extra cardio day this week?" });
    assert.match(JSON.stringify(reply), /handling this conversation personally/i);
    await t.post("/api/v1/takeover", { subscriberId: c.userId, active: false });
  });
}

async function digitalCoach(ctx: E2EContext, f: FollowerSeed) {
  const { client: c, trainer } = f;
  await ctx.reporter.step(F, "Ask the digital coach (AI reply)", `${c.label}: qualified automatic answer from an approved action`, async () => {
    const before = ctx.mocks.model.calls.length;
    const answer = await c.post("/api/v1/coaching/ask", { message: "I missed a week because of a work trip, how should I restart?" });
    assert.ok(ctx.mocks.model.calls.length > before, "the model was consulted");
    const text = JSON.stringify(answer);
    assert.match(text, /next scheduled session|pick up/i, "approved response delivered: " + text.slice(0, 300));
    return text.slice(0, 160);
  });
  await ctx.reporter.step(T, "Digital coach replies to subscribers", `${c.label}: unmatched question goes to trainer review`, async () => {
    const answer = await c.post("/api/v1/coaching/ask", { message: "Should I add 2.5 kg to my squat next session if all sets felt easy?" });
    assert.equal(answer.pendingReview, true, JSON.stringify(answer));
  });
  await ctx.reporter.step(T, "Review AI decisions: corrections, teaching drafts, regression checks and outcomes", `${trainer.slug}: the held reply waits for review with its evidence; feedback queue readable`, async () => {
    const records = (await trainer.client.get("/api/v1/bootstrap")).records;
    const held = records.find((r: any) => r.kind === "decision" && r.status === "pending_review" && /2\.5 kg/.test(String(r.data?.request)));
    assert.ok(held, "the held reply is visible to the trainer");
    assert.ok(held.data.evidenceIds?.length > 0, "the held reply cites evidence");
    assert.ok(records.some((r: any) => r.kind === "exception" && r.data?.decisionId === held.id), "review exception opened");
    await trainer.client.get("/api/v1/coaching/feedback");
    return String(held.data.message).slice(0, 200);
  });
  await ctx.reporter.step(F, "Coaching context (Client Twin) view", `${trainer.slug}: client twin for ${c.label}`, async () => {
    const twin = await trainer.client.get(`/api/v1/clients/${c.userId}/twin`);
    assert.ok(twin);
  });
}

async function bookings(ctx: E2EContext, f: FollowerSeed) {
  const { client: c, trainer } = f;
  const t = trainer.client;
  let free: any, paidSlot: any;
  await ctx.reporter.step(T, "Booking policy and session slots", `${trainer.slug}: policy, a free and a paid slot`, async () => {
    const current = await t.get("/api/v1/bookings");
    await t.post("/api/v1/bookings/policy", {
      revision: current.policy?.version ?? 0,
      timezone: "Asia/Dubai",
      cancellationHours: 12,
      noShowPolicy: "coach_review",
    });
    const start = new Date(Date.now() + 3 * 86400000);
    start.setUTCMinutes(0, 0, 0);
    free = await t.post("/api/v1/bookings/slots", { title: "Group mobility class", location: "Studio A, Dubai", startsAt: start.toISOString(), durationMinutes: 60, capacity: 8, priceMinor: 0 });
    const later = new Date(start.getTime() + 2 * 3600000);
    paidSlot = await t.post("/api/v1/bookings/slots", { title: "One-to-one technique session", location: "Studio B, Dubai", startsAt: later.toISOString(), durationMinutes: 45, capacity: 1, priceMinor: 15000 });
  });
  await ctx.reporter.step(F, "Reserve or cancel a free session", `${c.label}: reserves the free class`, async () => {
    const r = await c.post(`/api/v1/bookings/slots/${free.id}/reserve`, {});
    assert.equal(r.status, "confirmed");
  });
  await ctx.reporter.step(F, "Pay for a paid session, with refund on cancellation", `${c.label}: pays through Stripe checkout, cancels and is refunded`, async () => {
    const r = await c.post(`/api/v1/bookings/slots/${paidSlot.id}/reserve`, {});
    const link = r.checkoutUrl ?? r.url;
    assert.ok(link, "checkout link: " + JSON.stringify(r).slice(0, 200));
    const sessionId = new URL(link).pathname.split("/").pop()!;
    const completed = await ctx.mocks.stripe.completeCheckout(sessionId);
    for (const d of completed.deliveries ?? []) assert.equal(d.status, 200, `${d.type}: ${d.body}`);
    const booking = (await c.get("/api/v1/bookings")).bookings.find((b: any) => b.slot_id === paidSlot.id);
    assert.equal(booking.status, "confirmed");
    assert.equal(booking.payment_status, "paid");
    await c.post(`/api/v1/bookings/${booking.id}/cancel`, { reason: "Schedule changed" });
    const refunded = await ctx.waitUntil("booking refund", async () => {
      const b = (await c.get("/api/v1/bookings")).bookings.find((x: any) => x.id === booking.id);
      return b.payment_status === "refunded" && b;
    }, 30000);
    const refund = [...ctx.mocks.stripe.refunds.values()].find((x) => x.metadata?.booking_payment_id);
    assert.ok(refund, "refund created in the Stripe mock");
    const failures = ctx.mocks.stripe.deliveries.filter((d) => d.status !== 200 && (d.objectId === refund.charge || d.objectId === refund.id));
    assert.deepEqual(failures.map((d) => `${d.type} ${d.status} ${d.body}`), [], "refund webhooks processed");
    return refunded.payment_status;
  });
  await ctx.reporter.step(F, "Add bookings to my calendar", `${c.label}: calendar file lists own bookings`, async () => {
    const ics = await c.request("GET", "/api/v1/bookings/calendar.ics");
    assert.equal(ics.status, 200);
    assert.match(ics.text, /BEGIN:VCALENDAR/);
    assert.match(ics.text, /Group mobility class/);
  });
}

async function nutritionFlows(ctx: E2EContext, f: FollowerSeed) {
  const { client: c } = f;
  let plan: any;
  await ctx.reporter.step(F, "Nutrition profile and consents", `${c.label}: profile with processing and model consent`, async () => {
    await c.post("/api/v1/nutrition/profile", { profile: fixtureProfile, processingConsent: true, modelConsent: true, version: 0 });
    assert.ok(await c.get("/api/v1/nutrition"));
  });
  await ctx.reporter.step(F, "Weekly meal plans", `${c.label}: model-generated week delivered automatically`, async () => {
    const requestKey = randomUUID();
    const result = await c.post("/api/v1/nutrition/generate", { requestKey, weekStart: today() });
    assert.equal(result.plan.status, "delivered", JSON.stringify(result).slice(0, 400));
    plan = result.plan;
    assert.equal(plan.data.view.days.length, 7);
    const again = await c.post("/api/v1/nutrition/generate", { requestKey, weekStart: today() });
    assert.equal(again.plan.id, plan.id, "idempotent by request key");
  });
  if (!plan) return;
  await ctx.reporter.step(F, "Recipe options and meal swaps", `${c.label}: swaps breakfast to the microwave option`, async () => {
    assert.ok(await c.get(`/api/v1/nutrition/plans/${plan.id}/options`));
    const day = plan.data.view.days[0],
      meal = day.meals[0];
    const swap = await c.post(`/api/v1/nutrition/plans/${plan.id}/swap`, {
      expectedVersion: plan.version,
      date: day.date,
      slot: meal.slot,
      recipeId: meal.recipeId,
      variantKey: "microwave",
      servings: meal.servings,
    });
    plan = swap.plan;
  });
  await ctx.reporter.step(F, "Grocery and shopping lists", `${c.label}: grocery CSV`, async () => {
    const csv = await c.request("GET", `/api/v1/nutrition/groceries/${plan.id}`);
    assert.equal(csv.status, 200);
    assert.ok(csv.text.split("\n").length > 1);
  });
  await ctx.reporter.step(F, "Food diary", `${c.label}: logs a planned meal`, async () => {
    const day = plan.data.view.days[0],
      meal = day.meals[0];
    const log = await c.post("/api/v1/nutrition/logs", {
      eventKey: randomUUID(),
      date: day.date,
      timezone: "Asia/Dubai",
      name: meal.name,
      notes: "As planned",
      kcal: meal.nutrients.kcal,
      planId: plan.id,
      slot: meal.slot,
    });
    assert.ok(log.id);
  });
  await ctx.reporter.step(F, "Weekly nutrition check-ins", `${c.label}: check-in saved`, async () => {
    await c.post("/api/v1/nutrition/checkins", { eventKey: randomUUID(), date: today(), hunger: 3, difficulty: 2, weightKg: 72.5, notes: "Manageable week" });
  });
  await ctx.reporter.step(F, "Barcode lookup", `${c.label}: Open Food Facts mock product and a not-found code`, async () => {
    const before = ctx.mocks.food.server.log.length;
    const capture = await c.post("/api/v1/nutrition/captures/barcode", { requestKey: randomUUID(), code: "6291003000010" });
    assert.ok(ctx.mocks.food.server.log.length > before, "lookup reached the mock");
    assert.match(JSON.stringify(capture), /Mock Greek Yogurt Plain/);
    const missing = await c.request("POST", "/api/v1/nutrition/captures/barcode", { requestKey: randomUUID(), code: "4006381333931" });
    assert.equal(missing.status, 404, missing.text.slice(0, 200));
  });
  await ctx.reporter.step(F, "Meal photo estimates", `${c.label}: vision estimate reviewed and confirmed`, async () => {
    const image = await sampleJpeg("#c8a064", 7);
    const capture = await c.post("/api/v1/nutrition/captures/photo", {
      requestKey: randomUUID(),
      base64: image.toString("base64"),
      mime: "image/jpeg",
      context: "Lunch plate",
      photoConsent: true,
    });
    const items = capture.data?.estimate?.items ?? capture.estimate?.items ?? capture.draft?.estimate?.items;
    assert.ok(items?.length >= 1, JSON.stringify(capture).slice(0, 300));
    // The member edits before confirming; an estimate that identified nothing (a reviewed replay
    // answer) is replaced by what the member says they ate.
    const edited = items.some((i: any) => i.kcal === null)
      ? [{ name: "Chicken and rice", portion: "one plate", amount: 330, unit: "g", kcal: 480, protein: 48, carbohydrate: 51, fat: 6, preparation: "cooked", uncertainty: "Entered by the member" }]
      : items;
    const confirmed = await c.post(`/api/v1/nutrition/captures/${capture.id}/confirm`, {
      eventKey: randomUUID(),
      date: today(),
      timezone: "Asia/Dubai",
      name: "Chicken and rice",
      notes: "Adjusted rice portion",
      items: edited,
      confirmed: true,
    });
    assert.ok(confirmed.id);
    assert.ok(ctx.mocks.model.calls.some((m) => m.kind === "meal_photo"), "vision request reached the model mock");
    return items.map((i: any) => `${i.name} ${i.kcal ?? "?"} kcal`).join("; ");
  });
}

async function premiumVoice(ctx: E2EContext, f: FollowerSeed) {
  const { client: c, trainer } = f;
  await ctx.reporter.step(F, "Add premium voice to the membership", `${c.label}: buys the voice add-on through a subscription checkout at the Stripe mock`, async () => {
    const before = await c.get("/api/v1/membership/voice-addon");
    assert.equal(before.available, true, JSON.stringify(before));
    assert.equal(before.active, false);
    const { url } = await c.post("/api/v1/membership/voice-addon", {});
    const sessionId = new URL(url).pathname.split("/").pop()!;
    const completed = await ctx.mocks.stripe.completeCheckout(sessionId);
    for (const d of completed.deliveries ?? []) assert.equal(d.status, 200, `${d.type}: ${d.body}`);
    const after = await ctx.waitUntil("voice add-on active", async () => {
      const v = await c.get("/api/v1/membership/voice-addon");
      return v.active && v;
    }, 30000);
    return `voice add-on ${after.status} until ${after.periodEnd}`;
  });
  await ctx.reporter.step(F, "Trainer's voice reading the guided session", `${c.label}: premium member hears the verified trainer voice`, async () => {
    const template = (await trainer.client.get("/api/v1/training/overview")).records.find((r: any) => r.id === trainer.programTemplateId);
    const program = await trainer.client.post(`/api/v1/programs/${trainer.programTemplateId}/assign`, {
      subscriberId: c.userId,
      version: template.version,
      startDate: today(),
      timezone: "Asia/Dubai",
    });
    const workout = await c.post("/api/v1/workouts/start", { programId: program.id });
    const guided = await c.get(`/api/v1/guided/${workout.id}`);
    assert.equal(guided.premium, true, "the voice add-on on the membership enables premium voice");
    assert.equal(guided.audioAvailable, true);
    const before = ctx.mocks.voice.syntheses.length;
    const audio = await c.post(`/api/v1/guided/${workout.id}/audio`, { segment: 0, consent: true });
    assert.equal(audio.status, "ready", JSON.stringify(audio));
    assert.equal(ctx.mocks.voice.syntheses.length, before + 1, "one synthesis at the voice mock");
    const again = await c.post(`/api/v1/guided/${workout.id}/audio`, { segment: 0, consent: true });
    assert.equal(again.id, audio.id, "the same segment is not synthesized twice");
    assert.equal(ctx.mocks.voice.syntheses.length, before + 1);
    const file = await c.request("GET", audio.audioUrl, undefined, { raw: true });
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-type") ?? "", /audio\/mpeg/);
    await c.post(`/api/v1/workouts/${workout.id}/finish`, {});
  });
}

async function wearables(ctx: E2EContext, f: FollowerSeed) {
  const { client: c } = f;
  for (const provider of ["whoop", "zepp"] as const) {
    const feature = provider === "whoop" ? "WHOOP connection" : "Amazfit / Zepp connection";
    await ctx.reporter.step(F, feature, `${c.label}: OAuth through the ${provider} mock, sync and revoke`, async () => {
      const { url } = await c.post(`/api/v1/integrations/${provider}/connect`, { consent: true });
      const authorize = await fetch(url, { redirect: "manual" });
      assert.equal(authorize.status, 302, "provider authorization redirects back");
      const callback = new URL(authorize.headers.get("location")!);
      assert.equal(callback.origin, ctx.publicUrl);
      const back = await c.request("GET", callback.pathname + callback.search);
      assert.ok(back.status < 400, `callback ${back.status}: ${back.text.slice(0, 200)}`);
      const connected = await ctx.waitUntil(`${provider} connection`, async () => {
        const conn = (await c.get("/api/v1/integrations/connections")).connections.find((x: any) => x.provider === provider);
        return conn && conn.status !== "pending" && conn;
      }, 30000);
      await c.post(`/api/v1/integrations/${provider}/sync`, {});
      const synced = await ctx.waitUntil(`${provider} observations`, async () => {
        const conn = (await c.get("/api/v1/integrations/connections")).connections.find((x: any) => x.provider === provider);
        return conn && (conn.last_synced_at || conn.lastSyncedAt) ? conn : false;
      }, 150000);
      await c.post(`/api/v1/integrations/${provider}/revoke`, {});
      return `${connected.status} → synced ${JSON.stringify(synced.summary ?? {}).slice(0, 120)}`;
    });
  }
  await ctx.reporter.step(F, "Apple Health export import", `${c.label}: consented manual import listed with the connections`, async () => {
    await c.post("/api/v1/wearables/import", {
      source: "apple_health",
      consent: true,
      observations: [
        { type: "steps", value: 9120, unit: "count", measuredAt: new Date(Date.now() - 86400000).toISOString() },
        { type: "resting_heart_rate", value: 58, unit: "bpm", measuredAt: new Date(Date.now() - 86400000).toISOString() },
      ],
    });
    const list = await c.get("/api/v1/integrations/connections");
    assert.ok(list.imports.some((i: any) => i.source === "apple_health"), JSON.stringify(list.imports));
  });
}

async function notifications(ctx: E2EContext, f: FollowerSeed) {
  const { client: c, trainer } = f;
  await ctx.reporter.step(F, "Phone and browser push notifications", `${c.label}: device registered and a push delivered with a valid VAPID signature`, async () => {
    const status = await c.get("/api/v1/notifications/push");
    assert.equal(status.configured, true);
    const device = ctx.mocks.push.endpoint();
    await c.post("/api/v1/notifications/push", { endpoint: device, expirationTime: null, publicKey: status.publicKey, label: "Sandbox browser" });
    // Default quiet hours (22:00–08:00 in the member's zone) defer non-urgent
    // pushes; a message sent now is scheduled for later when it is quiet.
    await trainer.client.post("/api/v1/messages", { text: "Quiet-hours check.", subscriberId: c.userId });
    const [deferred] = await ctx.sqlRead<{ due: boolean }>(
      "SELECT available_at>now()+interval '1 minute' AS due FROM jobs WHERE kind='push' AND data->>'userId'=$1 ORDER BY created_at DESC LIMIT 1",
      [c.userId],
    );
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const minute = part("hour") * 60 + part("minute");
    const quietNow = minute >= 1320 || minute < 480;
    assert.equal(deferred?.due, quietNow, "push deferred exactly when inside default quiet hours");
    const prefs = await c.get("/api/v1/notifications/preferences");
    await c.put("/api/v1/notifications/preferences", { version: prefs.version, data: { ...prefs.data, quietStart: 0, quietEnd: 0 } });
    const before = ctx.mocks.push.deliveries.length;
    await trainer.client.post("/api/v1/messages", { text: "Push check: your next session is ready.", subscriberId: c.userId });
    const delivered = await ctx.waitUntil("push delivery", async () =>
      ctx.mocks.push.deliveries.slice(before).find((d) => device.endsWith(d.subscription)), 150000);
    assert.equal(delivered.vapidValid, true, "VAPID JWT verifies against the configured key");
    assert.equal(delivered.bodyBytes, 0, "no message content is sent to the push service");
    return quietNow ? "first push deferred by quiet hours; delivered after turning quiet hours off" : "delivered";
  });
  await ctx.reporter.step(F, "Notification preferences and quiet hours", `${c.label}: saved quiet-hours choice persists`, async () => {
    const prefs = await c.get("/api/v1/notifications/preferences");
    assert.equal(prefs.data.quietStart, 0);
    assert.equal(prefs.data.quietEnd, 0);
    assert.ok(prefs.version >= 1);
  });
  await ctx.reporter.step(F, "Email copies of notifications", `${c.label}: notification email delivered by the worker`, async () => {
    const mail = await ctx.mocks.email.waitFor(c.email, (m) => !/verify-email|magic-link|reset-password/.test(m.text), 150000);
    return mail.subject;
  });
  await ctx.reporter.step(F, "In-app notification inbox", `${c.label}: inbox lists and marks read`, async () => {
    const inbox = await c.get("/api/v1/notifications");
    const items = inbox.items ?? inbox.notifications ?? inbox;
    assert.ok(Array.isArray(items) && items.length > 0, JSON.stringify(inbox).slice(0, 200));
    await c.post(`/api/v1/notifications/${items[0].id}/read`, {});
  });
}

async function billing(ctx: E2EContext, f: FollowerSeed) {
  const { client: c, trainer } = f;
  const stripe = ctx.mocks.stripe;
  await ctx.reporter.step(F, "Billing history and invoices", `${c.label}: invoice and charge listed`, async () => {
    const billing = await c.get("/api/v1/membership/billing");
    assert.ok(billing.invoices.length >= 1 && billing.charges.length >= 1);
    assert.match(billing.invoices[0].data.hostedUrl ?? "", /^https:\/\/invoice\.stripe\.com\//);
  });
  await ctx.reporter.step(F, "Cancel or reactivate renewal", `${c.label}: cancel then reactivate through the Stripe mock`, async () => {
    await c.post("/api/v1/membership/cancel", {});
    assert.equal(stripe.subscriptions.get(f.checkout!.subscriptionId!)!.cancel_at_period_end, true);
    await ctx.waitUntil("cancel webhook", async () => (await c.get("/api/v1/bootstrap")).subscriptions[0]?.cancel_at_period_end === true, 15000);
    await c.post("/api/v1/membership/reactivate", {});
    assert.equal(stripe.subscriptions.get(f.checkout!.subscriptionId!)!.cancel_at_period_end, false);
  });
  await ctx.reporter.step(F, "Grace period after a failed payment", `${c.label}: failed renewal → past_due with grace; next renewal pays`, async () => {
    const failed = await stripe.renew(f.checkout!.subscriptionId!, { fail: true });
    for (const d of failed.deliveries) assert.equal(d.status, 200, `${d.type}: ${d.body}`);
    const sub = (await c.get("/api/v1/bootstrap")).subscriptions[0];
    assert.equal(sub.status, "past_due");
    assert.ok(sub.data.graceUntil, "grace window recorded");
    const paidAgain = await stripe.renew(f.checkout!.subscriptionId!);
    for (const d of paidAgain.deliveries) assert.equal(d.status, 200, `${d.type}: ${d.body}`);
    assert.equal((await c.get("/api/v1/bootstrap")).subscriptions[0].status, "active");
  });
  await ctx.reporter.step(F, "Request a refund", `${c.label}: request → trainer approval → Stripe refund → ledger`, async () => {
    const billing = await c.get("/api/v1/membership/billing");
    const charge = billing.charges.find((x: any) => x.eligible);
    assert.ok(charge, "an eligible charge: " + JSON.stringify(billing.charges).slice(0, 300));
    const request = await c.post("/api/v1/refund-requests", { chargeId: charge.chargeId, reason: "Could not attend this month" });
    await trainer.client.okMfa("POST", `/api/v1/refund-requests/${request.id}/decision`, { approve: true, reason: "Approved goodwill refund" });
    await ctx.waitUntil("refund journal", async () => {
      const after = await c.get("/api/v1/membership/billing");
      return after.charges.find((x: any) => x.chargeId === charge.chargeId)?.refundedMinor === charge.amountMinor;
    }, 20000);
  });
  await ctx.reporter.step(T, "Refund decisions", `${trainer.slug}: refund reflected in the trainer ledger`, async () => {
    const boot = await trainer.client.get("/api/v1/bootstrap");
    assert.ok(boot.journals.some((j: any) => j.source_key.startsWith("stripe-refund:")));
  });
  const second = ctx.followers.find((x) => x.paid && x !== f && x.trainer === trainer && x.tier === "workout" && x.checkout?.chargeId);
  if (second)
    await ctx.reporter.step("Super admin", "Reconciliation exceptions", `${second.client.label}: dispute opened and lost; reserve and loss journals`, async () => {
      const { dispute, delivery } = await stripe.openDispute(second.checkout!.chargeId!);
      assert.equal(delivery.status, 200, delivery.body);
      const closed = await stripe.closeDispute(dispute.id, "lost");
      assert.equal(closed.status, 200, closed.body);
      const boot = await trainer.client.get("/api/v1/bootstrap");
      assert.ok(boot.journals.some((j: any) => j.source_key === "dispute-reserve:" + dispute.id));
      assert.ok(boot.journals.some((j: any) => j.source_key === "dispute-resolution:" + dispute.id));
    });
  const changer = ctx.followers.find(
    (x) => x.paid && x.trainer === trainer && trainer.products.nutrition && x.tier === "workout" && x !== f && x !== second && x.checkout?.subscriptionId,
  );
  if (changer)
    await ctx.reporter.step(F, "Switch between workout-only and workout + nutrition", `${changer.client.label}: upgrade through the billing portal flow`, async () => {
      const { url } = await changer.client.post("/api/v1/membership/change-plan", { productId: trainer.products.nutrition.id });
      const portalId = new URL(url).pathname.split("/").pop()!;
      const result = await stripe.confirmPortalUpdate(portalId);
      for (const d of result.deliveries) assert.equal(d.status, 200, `${d.type}: ${d.body}`);
      const sub = (await changer.client.get("/api/v1/bootstrap")).subscriptions[0];
      assert.equal(sub.data.tier, "workout_nutrition");
      changer.tier = "workout_nutrition";
    });
}

async function account(ctx: E2EContext, f: FollowerSeed) {
  const { client: c } = f;
  await ctx.reporter.step(F, "See and sign out other devices", `${c.label}: second session listed and signed out`, async () => {
    const other = ctx.newClient(c.label + "-phone", c.email, c.password);
    await other.login();
    const account = await c.get("/api/v1/auth/account");
    assert.ok((account.sessions ?? []).length >= 2, JSON.stringify(account).slice(0, 200));
    await c.post("/api/v1/auth/sessions/revoke", {});
    await other.fails(401, "GET", "/api/v1/bootstrap");
  });
  await ctx.reporter.step(F, "Email sign-in link", `${c.label}: magic link by email signs in`, async () => {
    const fresh = ctx.newClient(c.label + "-magic", c.email, c.password);
    const before = ctx.mocks.email.inbox(c.email).length;
    await fresh.post("/api/v1/auth/magic-link", { email: c.email });
    const mail = await ctx.mocks.email.waitFor(c.email, (m) => /magic-link\//.test(m.text), 90000, before);
    const token = linkIn(mail, "/magic-link/").pathname.split("/").pop();
    await fresh.post("/api/v1/auth/magic-link/consume", { token });
    assert.equal((await fresh.get("/api/v1/bootstrap")).user.userId, c.userId);
  });
  await ctx.reporter.step(F, "Forgot-password reset email", `${c.label}: reset link by email sets a new password`, async () => {
    const fresh = ctx.newClient(c.label + "-reset", c.email, c.password);
    const before = ctx.mocks.email.inbox(c.email).length;
    await fresh.post("/api/v1/auth/forgot-password", { email: c.email });
    const mail = await ctx.mocks.email.waitFor(c.email, (m) => /reset-password\//.test(m.text), 90000, before);
    const token = linkIn(mail, "/reset-password/").pathname.split("/").pop();
    c.password = PASSWORD + "-2";
    await fresh.post("/api/v1/auth/reset-password", { token, password: c.password });
    await c.login();
  });
  await ctx.reporter.step(F, "Change password", `${c.label}: changes password and signs in again`, async () => {
    await c.post("/api/v1/auth/password", { current: c.password, password: PASSWORD });
    c.password = PASSWORD;
    await c.login();
  });
}

async function privacy(ctx: E2EContext, f: FollowerSeed) {
  const { client: c } = f;
  await ctx.reporter.step(F, "Download my data", `${c.label}: personal export`, async () => {
    const r = await c.request("GET", "/api/v1/privacy/export");
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(c.email));
  });
  await ctx.reporter.step(F, "Support requests", `${c.label}: support request`, async () => {
    const r = await c.post("/api/v1/support", { subject: "Invoice question", message: "Can I get the invoice in my company name?", category: "billing" });
    assert.ok(r.id);
  });
  await ctx.reporter.step(F, "Request account deletion and track it", `${c.label}: deletion request pending review`, async () => {
    const r = await c.post("/api/v1/privacy/delete-request", {});
    assert.equal(r.status, "pending_review");
    assert.ok(await c.get("/api/v1/privacy/status"));
  });
}

async function unpaidGating(ctx: E2EContext) {
  const unpaid = ctx.followers.find((f) => !f.paid);
  if (!unpaid) {
    ctx.reporter.missingPrerequisite("a seeded follower without a paid membership");
    return;
  }
  await ctx.reporter.step(F, "Only your own data is visible", `${unpaid.client.label}: unpaid member cannot use paid coaching and sees only own records`, async () => {
    await unpaid.client.fails(402, "POST", "/api/v1/coaching/ask", { message: "What should I do today?" }, "MEMBERSHIP_REQUIRED");
    const boot = await unpaid.client.get("/api/v1/bootstrap");
    assert.equal(boot.members, undefined, "member list hidden from subscribers");
    const foreign = boot.records.filter(
      (r: any) => r.owner_user_id && r.owner_user_id !== unpaid.client.userId && !["product", "brain_release", "rule", "program"].includes(r.kind),
    );
    assert.deepEqual(foreign.map((r: any) => r.kind), [], "no other member's records");
  });
}
