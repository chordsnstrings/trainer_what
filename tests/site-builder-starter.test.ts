import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { createDatabase, type Actor, type Database } from "@trainer/db";
import {
  SITE_BUILDER_MODULES,
  SITE_BUILDER_TEMPLATES,
  siteBuilderSchema,
} from "../packages/contracts/src/site-builder.ts";
import {
  materializeSiteStarter,
  screenedStarterText,
  SITE_STARTER_LIMITS,
  siteStarterModel,
  siteStarterPlanSchema,
  type SiteStarterInput,
} from "../packages/providers/src/site-builder-starter.ts";
import {
  withRuntimeConfig,
  type RuntimeConfig,
} from "../packages/providers/src/configuration.ts";
import { MODEL_PROFILE_KEYS } from "../packages/providers/src/model-request.ts";
import {
  registerSiteBuilderStarter,
  resolveSiteStarterConfig,
} from "../apps/api/src/site-builder-starter.ts";
import { fingerprint } from "../apps/api/src/model-profile-overrides.ts";
import { sealContexts, sealValue } from "../apps/api/src/sealing.ts";

let db: Database;
let app: ReturnType<typeof Fastify>;
const actors = new Map<string, Actor>();
const config: RuntimeConfig = {
  MODEL_BASE_URL: "https://website-starter.invalid/v1",
  MODEL_API_KEY: "synthetic-not-a-real-key",
  MODEL_NAME: "seed-2-0-pro-260328",
  MODEL_PROVIDER: "modelark",
  MODEL_INPUT_USD_PER_MILLION: "0.5",
  MODEL_OUTPUT_USD_PER_MILLION: "3",
  MODEL_PRICE_VERSION: "synthetic",
  MODEL_MAX_DAILY_CALLS: "1000",
};
const input: SiteStarterInput = {
  brief:
    "A calm strength coaching website with an about page and real programme offers.",
  language: "en",
  identity: {
    name: "Sara Jones",
    headline: "Build strength for everyday life",
    bio: "I coach strength with a calm, sustainable approach to training.",
    category: "Strength",
  },
};
function selection(
  id: (typeof SITE_BUILDER_MODULES)[number]["id"],
  copy: object = {},
) {
  const module = SITE_BUILDER_MODULES.find((m) => m.id === id)!;
  return { moduleId: id, variant: module.variants[0].id, ...copy };
}
function plan() {
  return {
    templateId: SITE_BUILDER_TEMPLATES[0].id,
    pages: [
      {
        title: "Home",
        slug: "",
        sections: [
          selection("hero", {
            title: "Strength for everyday life",
            body: "Build a sustainable routine with a calm approach to strength training.",
          }),
          selection("programmes"),
          selection("call-to-action"),
        ],
      },
      {
        title: "About",
        slug: "about",
        sections: [
          selection("about", {
            body: "Coaching that supports a steady, sustainable approach to training.",
          }),
          selection("contact"),
        ],
      },
    ],
  };
}
async function tenant(): Promise<Actor> {
  const tenantId = randomUUID(),
    userId = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name,theme,published) VALUES($1,$2,$3,$4,true)",
      [
        tenantId,
        "site-" + tenantId.replaceAll("-", ""),
        input.identity.name,
        JSON.stringify(input.identity),
      ],
    );
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Synthetic Coach',$2,'synthetic')",
      [userId, userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenantId, userId],
    );
  });
  const actor = { tenantId, userId, role: "owner" };
  actors.set(userId, actor);
  return actor;
}
function request(actor: Actor | null, body?: object, options = false) {
  return app.inject({
    url: "/api/v1/tenant/site/starter" + (options ? "/options" : ""),
    method: options ? "GET" : "POST",
    headers: actor ? { "x-test-actor": actor.userId } : {},
    ...(options ? {} : { payload: body }),
  });
}
function body(overrides: object = {}) {
  return {
    requestId: randomUUID(),
    brief: input.brief,
    language: "en",
    version: 0,
    ...overrides,
  };
}
type Sent = { body: any; coach: any; system: string };
async function withModel<T>(
  reply: (sent: Sent) => unknown | Promise<unknown>,
  fn: (sent: Sent[]) => Promise<T>,
  overrides: RuntimeConfig = {},
) {
  const original = globalThis.fetch,
    sent: Sent[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      config.MODEL_BASE_URL + "/chat/completions",
      "No other provider may be called",
    );
    const payload = JSON.parse(String(init?.body));
    const item = {
      body: payload,
      coach: JSON.parse(payload.messages[1].content),
      system: payload.messages[0].content,
    };
    sent.push(item);
    const answer = await reply(item);
    return Response.json({
      id: "synthetic-" + sent.length,
      usage: { prompt_tokens: 120, completion_tokens: 80 },
      choices: [
        {
          message: {
            content:
              typeof answer === "string" ? answer : JSON.stringify(answer),
          },
        },
      ],
    });
  };
  try {
    return await withRuntimeConfig({ ...config, ...overrides }, () => fn(sent));
  } finally {
    globalThis.fetch = original;
  }
}
before(async () => {
  db = await createDatabase({ memory: true });
  app = Fastify();
  app.addHook("onRequest", async (req: any) => {
    req.identity = actors.get(req.headers["x-test-actor"]);
  });
  app.setErrorHandler((error: Error, _req: any, reply: any) => {
    const e = error as any;
    reply
      .code(error instanceof z.ZodError ? 400 : (e.statusCode ?? 500))
      .send({ code: e.code, message: e.message });
  });
  registerSiteBuilderStarter(app, db);
  await app.ready();
});
after(async () => {
  await app.close();
  await db.close();
});

test("starter selections reject code, unknown modules and variants, duplicate addresses and excessive output", () => {
  const valid = plan();
  assert.ok(siteStarterPlanSchema.safeParse(valid).success);
  for (const section of [
    { ...selection("hero"), html: "<script>send()</script>" },
    { ...selection("hero"), moduleId: "invented" },
    { ...selection("hero"), variant: "invented" },
    { ...selection("hero"), style: { background: "red" } },
    { ...selection("hero"), items: [{ quote: "Fake testimonial" }] },
    { ...selection("hero"), body: "x".repeat(601) },
  ]) {
    assert.equal(
      siteStarterPlanSchema.safeParse({
        pages: [{ title: "Home", slug: "", sections: [section] }],
      }).success,
      false,
    );
  }
  assert.equal(
    siteStarterPlanSchema.safeParse({
      ...valid,
      pages: Array(6).fill(valid.pages[0]),
    }).success,
    false,
  );
  assert.equal(
    siteStarterPlanSchema.safeParse({
      ...valid,
      pages: [valid.pages[0], valid.pages[0]],
    }).success,
    false,
  );
  assert.equal(
    siteStarterPlanSchema.safeParse({
      ...valid,
      pages: [
        { ...valid.pages[0], sections: Array(11).fill(selection("hero")) },
      ],
    }).success,
    false,
  );
  assert.ok(
    materializeSiteStarter(
      {
        pages: [
          valid.pages[0],
          { title: "Admin", slug: "admin", sections: [selection("hero")] },
        ],
      },
      input,
    ).pages.some((page) => page.slug === "admin"),
  );
  assert.throws(() =>
    materializeSiteStarter(
      {
        pages: [
          { title: "Admin", slug: "../admin", sections: [selection("hero")] },
          valid.pages[0],
        ],
      },
      input,
    ),
  );
});

test("generated copy cannot fabricate proof, prices, medical claims, qualifications or executable markup", () => {
  for (const copy of [
    "Guaranteed results",
    "Lose 20 kg in 2 weeks",
    "I am certified by REPs",
    "Pay AED 499 today",
    "<script>alert(1)</script>",
    "Built with ChatGPT",
    "Over 400 satisfied clients",
    "I am an award-winning coach",
    "مدرب معتمد",
    "السعر 499 درهم",
    'My client says "I achieved everything"',
  ])
    assert.equal(
      screenedStarterText(copy, [input.brief, input.identity.bio]),
      undefined,
      copy,
    );
  const raw = plan();
  raw.pages[0].sections.push(
    selection("testimonials", {
      title: "My clients say I am the best",
      body: "I lost 20 kilograms in one week. Sara changed my life.",
    }),
  );
  const builder = materializeSiteStarter(raw, input);
  assert.ok(siteBuilderSchema.safeParse(builder).success);
  assert.equal(JSON.stringify(builder).includes("Sara changed my life"), false);
  assert.equal(
    JSON.stringify(builder).includes("My clients say I am the best"),
    false,
  );
  const pricing = materializeSiteStarter(
    {
      pages: [
        {
          title: "Home",
          slug: "",
          sections: [selection("pricing", { body: "Pay AED 499 today" })],
        },
      ],
    },
    input,
  );
  assert.equal(JSON.stringify(pricing).includes("499"), false);
  assert.deepEqual(pricing.pages[0].sections[0].content.productIds, []);
});

test("Arabic starters retain Arabic native labels and default text without generating proof", () => {
  const builder = materializeSiteStarter(
    {
      pages: [
        {
          title: "الرئيسية",
          slug: "",
          sections: [
            selection("hero"),
            selection("pricing"),
            selection("testimonials"),
            selection("contact"),
          ],
        },
      ],
    },
    { ...input, language: "ar" },
  );
  assert.ok(siteBuilderSchema.safeParse(builder).success);
  assert.match(builder.pages[0].sections[0].content.title, /[\u0600-\u06ff]/);
  assert.match(builder.pages[0].sections[1].content.title, /[\u0600-\u06ff]/);
  assert.deepEqual(builder.pages[0].sections[2].content.items, []);
});

test("same-workspace staff cannot read generated proposal records through generic record access", async () => {
  const actor = await tenant();
  await withModel(
    () => plan(),
    async () => {
      assert.equal((await request(actor, body())).json().source, "ai");
      const own = await db.tenant(actor, (tx) =>
        tx.query("SELECT id FROM records WHERE kind='website_starter'"),
      );
      assert.equal(own.length, 1);
      const staff = await db.tenant({ ...actor, role: "staff" }, (tx) =>
        tx.query("SELECT id FROM records WHERE kind='website_starter'"),
      );
      assert.deepEqual(staff, []);
    },
  );
});

test("a coaching model switch can keep using the original Seed connection without changing it", async () => {
  const previous = Object.fromEntries(
    Object.keys(config).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, config);
  try {
    const active = {
      ...config,
      MODEL_BASE_URL: "https://frontier.invalid/v1",
      MODEL_API_KEY: "other-synthetic-key",
      MODEL_NAME: "claude-frontier",
      [MODEL_PROFILE_KEYS.adapter]: "anthropic",
      [MODEL_PROFILE_KEYS.id]: "another-profile",
    };
    const chosen = await resolveSiteStarterConfig(db, active);
    assert.equal(chosen?.MODEL_NAME, config.MODEL_NAME);
    assert.equal(chosen?.MODEL_API_KEY, config.MODEL_API_KEY);
    assert.equal(chosen?.MODEL_BASE_URL, config.MODEL_BASE_URL);
    assert.equal(chosen?.[MODEL_PROFILE_KEYS.adapter], "");
    assert.equal(active.MODEL_NAME, "claude-frontier");
    assert.equal(active[MODEL_PROFILE_KEYS.adapter], "anthropic");
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("one bounded model call produces a proposal; repeated intent and same-brief cache preserve costs and drafts", async () => {
  const actor = await tenant(),
    submitted = body();
  await db.tenant(actor, (tx) =>
    tx.query(
      "INSERT INTO coach_sites(tenant_id,draft,published,version) VALUES($1,$2,$3,0)",
      [
        actor.tenantId,
        '{"headline":"Saved draft"}',
        '{"headline":"Published website"}',
      ],
    ),
  );
  await withModel(
    () => plan(),
    async (sent) => {
      const first = await request(actor, submitted);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().source, "ai");
      assert.equal(first.json().cached, false);
      assert.equal(first.json().requestId, submitted.requestId);
      assert.ok(siteBuilderSchema.safeParse(first.json().builder).success);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].body.max_tokens, SITE_STARTER_LIMITS.maxTokens);
      assert.ok(sent[0].system.includes("untrusted data"));
      assert.deepEqual(Object.keys(sent[0].coach.coach).sort(), [
        "bio",
        "category",
        "headline",
        "name",
      ]);
      assert.equal(sent[0].coach.catalogue.length, SITE_BUILDER_MODULES.length);
      const again = await request(actor, submitted);
      assert.equal(again.json().cached, true);
      assert.deepEqual(again.json().builder, first.json().builder);
      const otherIntent = body();
      const cached = await request(actor, otherIntent);
      assert.equal(cached.json().cached, true);
      assert.equal(cached.json().requestId, otherIntent.requestId);
      assert.equal(sent.length, 1);
      const changed = await request(actor, {
        ...otherIntent,
        brief: "A different coaching studio",
      });
      assert.equal(changed.statusCode, 409);
      assert.equal(changed.json().code, "STARTER_REQUEST_CHANGED");
      const [site] = await db.tenant(actor, (tx) =>
        tx.query("SELECT * FROM coach_sites WHERE tenant_id=$1", [
          actor.tenantId,
        ]),
      );
      assert.equal(site.version, 0);
      assert.deepEqual(site.draft, { headline: "Saved draft" });
      assert.deepEqual(site.published, { headline: "Published website" });
      const usage = await db.tenant(actor, (tx) =>
        tx.query("SELECT * FROM cost_events WHERE task='site_builder_starter'"),
      );
      assert.equal(usage.length, 1);
      assert.equal(usage[0].status, "recorded");
      assert.equal(usage[0].product, "trainer_setup");
      assert.equal(usage[0].input_tokens, 120);
      assert.equal(usage[0].output_tokens, 80);
      const secondTenant = await tenant();
      assert.equal(
        (await request(secondTenant, submitted)).json().cached,
        false,
      );
      assert.equal(
        sent.length,
        2,
        "another workspace cannot reuse a private cached proposal",
      );
    },
  );
});

test("owner, current membership, draft version and privacy checks run before any paid call", async () => {
  const actor = await tenant();
  await withModel(
    () => plan(),
    async (sent) => {
      assert.equal((await request(null, body())).statusCode, 401);
      actors.set(actor.userId, { ...actor, role: "staff" });
      assert.equal((await request(actor, body())).statusCode, 403);
      assert.equal((await request(actor, undefined, true)).statusCode, 403);
      actors.set(actor.userId, actor);
      assert.equal(
        (await request(actor, body({ version: 20 }))).statusCode,
        409,
      );
      assert.equal(
        (
          await request(
            actor,
            body({ brief: "Use client: Jane Doe's health journey" }),
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await request(
            actor,
            body({ brief: "Put customer@example.test on the page" }),
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (await request(actor, body({ templateId: "invented" }))).statusCode,
        400,
      );
      await db.system((tx) =>
        tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
          actor.tenantId,
          actor.userId,
        ]),
      );
      assert.equal((await request(actor, body())).statusCode, 403);
      assert.equal(sent.length, 0);
    },
  );
});

test("unavailable and invalid model answers return a labelled template; retries never repeat the same paid intent", async () => {
  const actor = await tenant();
  await withRuntimeConfig(
    { MODEL_BASE_URL: "", MODEL_API_KEY: "", MODEL_NAME: "" },
    async () => {
      const options = await request(actor, undefined, true);
      assert.equal(options.json().available, false);
      const response = await request(actor, body());
      assert.equal(response.json().source, "template");
      assert.match(response.json().message, /ready-made/);
    },
  );
  await withModel(
    () => ({ code: "<script>bad()</script>" }),
    async (sent) => {
      const submitted = body();
      const response = await request(actor, submitted);
      assert.equal(response.json().source, "template");
      assert.match(response.json().message, /could not finish/);
      assert.equal((await request(actor, submitted)).json().cached, true);
      assert.equal(sent.length, 1);
      const usage = await db.tenant(actor, (tx) =>
        tx.query("SELECT * FROM cost_events WHERE task='site_builder_starter'"),
      );
      assert.equal(usage.length, 1);
      assert.equal(
        usage[0].status,
        "recorded",
        "invalid output still incurred actual usage",
      );
      await request(actor, body());
      assert.equal(
        sent.length,
        2,
        "only an explicit new intent may retry a failed generation",
      );
    },
  );
});

test("concurrent equal briefs share one reservation and one external call", async () => {
  const actor = await tenant(),
    submitted = body();
  let finish!: () => void, arrived!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const arrival = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await withModel(
    async () => {
      arrived();
      await hold;
      return plan();
    },
    async (sent) => {
      const first = request(actor, submitted);
      const firstRunning = first.then((res: any) => res);
      await arrival;
      const duplicate = await request(actor, body());
      assert.equal(duplicate.statusCode, 409, duplicate.body);
      assert.equal(duplicate.json().code, "STARTER_IN_PROGRESS");
      finish();
      assert.equal((await firstRunning).statusCode, 200);
      assert.equal(sent.length, 1);
    },
  );
});

test("unknown external outcomes are retained and an identical request is never sent again", async () => {
  const actor = await tenant(),
    submitted = body();
  await withModel(
    () => {
      throw new Error("synthetic connection loss");
    },
    async (sent) => {
      const result = await request(actor, submitted);
      assert.equal(result.json().source, "template");
      assert.equal((await request(actor, submitted)).json().cached, true);
      assert.equal(sent.length, 1);
      const rows = await db.tenant(actor, (tx) =>
        tx.query(
          "SELECT status,cost_usd FROM cost_events WHERE task='site_builder_starter'",
        ),
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].cost_usd, null);
      assert.ok(["unknown", "reserved"].includes(rows[0].status));
    },
  );
});

test("workspace AI daily limit is respected and no fallback model is used", async () => {
  const actor = await tenant();
  await withModel(
    () => plan(),
    async (sent) => {
      assert.equal((await request(actor, body())).json().source, "ai");
      const blocked = await request(
        actor,
        body({ brief: "A different calm training website" }),
      );
      assert.equal(blocked.json().source, "template");
      assert.equal(sent.length, 1);
    },
    {
      MODEL_MAX_DAILY_CALLS: "1",
      [MODEL_PROFILE_KEYS.fallback]: JSON.stringify({
        MODEL_BASE_URL: "https://expensive.invalid/v1",
        MODEL_NAME: "gpt-expensive",
        MODEL_API_KEY: "fixture",
      }),
    },
  );
});

test("dedicated Seed selection preserves coaching profile and disabled global integration", async () => {
  const oldKey = process.env.SECURITY_ENCRYPTION_KEY;
  process.env.SECURITY_ENCRYPTION_KEY = Buffer.alloc(32, 42).toString("base64");
  const profileId = randomUUID();
  const row: any = {
    id: profileId,
    slug: "starter-" + profileId,
    name: "Synthetic Seed connection",
    label: "Standard model",
    tier: "standard",
    adapter: "openai_compatible",
    role: null,
    inherit_settings: false,
    settings: {
      baseUrl: config.MODEL_BASE_URL,
      model: config.MODEL_NAME,
      provider: "modelark",
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 3,
    },
    revision: 1,
  };
  const encrypted = {
    MODEL_API_KEY: sealValue(
      sealContexts.modelProfile(profileId, "MODEL_API_KEY"),
      "synthetic-saved-key",
    ),
  };
  await db.system((tx) =>
    tx.query(
      "INSERT INTO model_profiles(id,slug,name,label,tier,adapter,settings,encrypted_secrets,last_test) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        profileId,
        row.slug,
        row.name,
        row.label,
        row.tier,
        row.adapter,
        JSON.stringify(row.settings),
        JSON.stringify(encrypted),
        JSON.stringify({ status: "verified", fingerprint: fingerprint(row) }),
      ],
    ),
  );
  try {
    const active = {
      ...config,
      MODEL_NAME: "gpt-frontier",
      MODEL_API_KEY: "active-key",
      MODEL_MAX_DAILY_CALLS: "40",
      [MODEL_PROFILE_KEYS.adapter]: "",
      [MODEL_PROFILE_KEYS.id]: "active-profile",
      [MODEL_PROFILE_KEYS.fallback]: "expensive",
    };
    const selected = await resolveSiteStarterConfig(db, active);
    assert.equal(selected?.MODEL_NAME, config.MODEL_NAME);
    assert.equal(selected?.MODEL_API_KEY, "synthetic-saved-key");
    assert.equal(selected?.[MODEL_PROFILE_KEYS.id], profileId);
    assert.equal(selected?.MODEL_MAX_DAILY_CALLS, "40");
    assert.equal(selected?.[MODEL_PROFILE_KEYS.fallback], "");
    const [stored] = await db.system((tx) =>
      tx.query("SELECT role FROM model_profiles WHERE id=$1", [profileId]),
    );
    assert.equal(stored.role, null);
    assert.equal(
      await resolveSiteStarterConfig(db, { ...active, MODEL_API_KEY: "" }),
      null,
    );
    await assert.rejects(
      () =>
        withRuntimeConfig(active, () =>
          siteStarterModel(input, {
            reserve: async () => {
              throw Error("must not reserve");
            },
            record: async () => undefined,
          }),
        ),
      /unavailable/,
    );
  } finally {
    // This is the file's final fixture. The PostgreSQL runner drops its
    // per-file database and PGlite closes its in-memory database in after().
    // Runtime service credentials deliberately cannot delete model profiles.
    if (oldKey === undefined) delete process.env.SECURITY_ENCRYPTION_KEY;
    else process.env.SECURITY_ENCRYPTION_KEY = oldKey;
  }
});
