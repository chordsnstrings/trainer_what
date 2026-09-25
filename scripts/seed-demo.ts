import { randomUUID } from "node:crypto";
import { createDatabase, putRecord } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { passwordHash } from "../apps/api/src/auth.ts";
import { recordCharge } from "../apps/api/src/finance.ts";
import { seedNutritionDemo } from "./seed-nutrition-demo.ts";
if (process.env.NODE_ENV === "production")
  throw new Error("Synthetic seed is forbidden in production");
const db = await createDatabase();
const app = await buildApp({ db, testing: true });
const email = "coach@example.test",
  password = process.env.DEMO_PASSWORD ?? "TrainerDemo2026!";
const r = await app.inject({
  url: "/api/v1/auth/register",
  method: "POST",
  headers: { origin: process.env.PUBLIC_APP_URL ?? "http://localhost:3000" },
  payload: {
    name: "Alex Morgan",
    email,
    password,
    slug: "alex-morgan",
    accepted: true,
  },
});
if (r.statusCode === 409) {
  const [a] = await db.system((tx) =>
    tx.query(
      "SELECT m.tenant_id,m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email=$1 AND m.role='owner'",
      [email],
    ),
  );
  if (a)
    await seedNutritionDemo(db, {
      tenantId: a.tenant_id,
      userId: a.user_id,
      role: "owner",
    });
  console.log("Demo workspace exists; added nutrition fixtures if absent.");
} else {
  if (r.statusCode !== 201) throw new Error(r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const boot = await app.inject({
    url: "/api/v1/bootstrap",
    headers: { cookie },
  });
  const a = boot.json().user;
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [a.userId]),
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET theme=$2 WHERE id=$1", [
      a.tenantId,
      JSON.stringify({
        headline: "Strong for life. Built around you.",
        bio: "I help busy people build lasting strength with thoughtful training, consistent practice and room for real life.",
        category: "Strength & sustainable progress",
        accent: "#244c46",
      }),
    ]),
  );
  for (const name of ["Sam Taylor", "Jamie Lee", "Riley Park"]) {
    const uid = randomUUID();
    await db.system(async (tx) => {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,$3,$4,true)",
        [
          uid,
          name.toLowerCase().replace(" ", ".") + "@example.test",
          name,
          await passwordHash(password),
        ],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
        [a.tenantId, uid],
      );
    });
    await db.tenant(a, async (tx) => {
      await putRecord(
        tx,
        a,
        "program",
        {
          title: "Strength foundations",
          goal: "Three well-paced sessions. Build consistency before adding complexity.",
          daysPerWeek: 3,
          exercises: [
            {
              name: "Goblet squat",
              sets: 3,
              reps: 10,
              restSeconds: 90,
              loadKg: 16,
              cue: "Control the lowering phase.",
            },
            {
              name: "Dumbbell bench press",
              sets: 3,
              reps: 10,
              restSeconds: 90,
              loadKg: 14,
              cue: "Keep your movement smooth.",
            },
            {
              name: "Cable row",
              sets: 3,
              reps: 12,
              restSeconds: 75,
              loadKg: 30,
              cue: "Pause briefly at the finish.",
            },
          ],
        },
        { ownerId: uid, status: "assigned" },
      );
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,price_minor,period_end,data) VALUES($1,$2,$3,'active',19900,now()+interval '30 days',$4)",
        [randomUUID(), a.tenantId, uid, JSON.stringify({ synthetic: true })],
      );
      await recordCharge(tx, a, "demo:" + uid, 19900, 1, {
        userId: uid,
        synthetic: true,
      });
    });
  }
  await db.tenant(a, async (tx) => {
    for (const [title, category, condition, directive] of [
      [
        "Technique before load",
        "progression",
        "A beginner is still finding consistent technique",
        "Keep load stable until movement quality is repeatable.",
      ],
      [
        "Keep the habit when time is short",
        "schedule",
        "A client has only twenty minutes to train",
        "Prioritize the primary movements and reduce accessory volume.",
      ],
      [
        "New pain needs human review",
        "safety",
        "A client reports new pain during a workout",
        "Pause the session and escalate to the trainer.",
      ],
    ])
      await putRecord(
        tx,
        a,
        "rule",
        {
          title,
          category,
          condition,
          directive,
          reason: "Trainer-authored demonstration rule",
          sourceIds: [],
          allowedUses: ["render", "model_prompt"],
        },
        { status: "confirmed" },
      );
    await putRecord(
      tx,
      a,
      "source",
      {
        title: "The principles behind my coaching",
        text: "Progress begins with consistency. I prioritize repeatable technique, useful feedback and a workload that fits the client’s life. New pain always goes to human review.",
        allowedUses: ["render", "model_prompt"],
        origin: "trainer_upload",
      },
      { status: "ready" },
    );
    await putRecord(
      tx,
      a,
      "product",
      {
        name: "Everyday strength",
        description:
          "Personal programming, workout tracking and thoughtful coach support.",
        priceMinor: 19900,
      },
      { status: "draft" },
    );
  });
  await seedNutritionDemo(db, a);
  console.log(
    "Synthetic development workspace created for coach@example.test. Password is DEMO_PASSWORD, or the documented development-only default.",
  );
}
await app.close();
await db.close();
