// A large synthetic workspace for the bounded-bootstrap tests. Every person,
// message and amount here is invented; no provider is contacted. Rows are
// generated in SQL so the fixture stays fast on the embedded engine and on
// PostgreSQL under the restricted runtime role: accounts, workspaces and
// sessions use the service connection, tenant rows the owner's transaction.
import { randomUUID } from "node:crypto";
import type { Actor, Database } from "@trainer/db";
import { newToken, tokenHash } from "../apps/api/src/auth.ts";

export type Sized = {
  followers: number;
  messages: number;
  workouts: number;
  programs: number;
  plannedSessions: number;
  exceptions: number;
  sets: number;
  events: number;
  costs: number;
  journals: number;
  notifications: number;
};
export const LARGE: Sized = {
  followers: 500,
  messages: 2000,
  workouts: 1500,
  programs: 500,
  plannedSessions: 1350,
  exceptions: 400,
  sets: 5000,
  events: 2000,
  costs: 600,
  journals: 300,
  notifications: 400,
};

export type Person = Actor & { cookie: string; name: string };

export async function session(db: Database, userId: string, tenantId: string) {
  const token = newToken();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '7 days',now())",
      [tokenHash(token), userId, tenantId],
    ),
  );
  return "session=" + token;
}

export async function person(
  db: Database,
  tenantId: string,
  role: string,
  name: string,
  platformRole = "none",
): Promise<Person> {
  const userId = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified,platform_role) VALUES($1,$2,$3,'synthetic',true,$4)",
      [userId, name, `bb-${userId}@example.test`, platformRole],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
  });
  return {
    tenantId,
    userId,
    role,
    name,
    cookie: await session(db, userId, tenantId),
  };
}

/** Records inserted `count` times, spread one minute apart into the past. */
export function bulkRecords(
  tx: { query: (sql: string, values?: any[]) => Promise<any[]> },
  tenantId: string,
  kind: string,
  count: number,
  owners: string[],
  status: string | string[],
  data: string,
  offsetMinutes = 0,
) {
  const statuses = Array.isArray(status) ? status : [status];
  return tx.query(
    `INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data,created_at,updated_at)
     SELECT gen_random_uuid(),$1,$2,($3::uuid[])[1+(i % cardinality($3::uuid[]))],($4::text[])[1+(i % cardinality($4::text[]))],
       ${data},now()-((i+$6)*interval '1 minute'),now()-((i+$6)*interval '1 minute')
     FROM generate_series(1,$5) AS i`,
    [tenantId, kind, owners, statuses, count, offsetMinutes],
  );
}

export async function largeWorkspace(
  db: Database,
  size: Sized = LARGE,
  label = "Large",
) {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,true)",
      [tenantId, "bb-" + tenantId.slice(0, 12), label + " coaching workspace"],
    ),
  );
  const owner = await person(db, tenantId, "owner", label + " Owner");
  const staff = await person(db, tenantId, "staff", label + " Coach");
  const finance = await person(db, tenantId, "finance", label + " Finance");
  // Followers are named in sequence so page boundaries are easy to reason
  // about; emails carry the workspace so fixtures never collide.
  const followerRows = await db.system(async (tx) => {
    const rows = await tx.query(
      `INSERT INTO users(id,name,email,password_hash,email_verified)
       SELECT gen_random_uuid(),'Follower '||lpad(i::text,4,'0'),'bb-'||$1||'-'||i||'@example.test','synthetic',true
       FROM generate_series(1,$2) AS i RETURNING id,name`,
      [tenantId, size.followers],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) SELECT $1,u,'subscriber' FROM unnest($2::uuid[]) AS u",
      [tenantId, rows.map((r: any) => r.id)],
    );
    return rows;
  });
  followerRows.sort((a: any, b: any) => a.name.localeCompare(b.name));
  const followers: string[] = followerRows.map((r: any) => r.id);
  const scope: Actor = { tenantId, userId: owner.userId, role: "owner" };
  const program = `jsonb_build_object('title','Synthetic block '||i,'exercises',(SELECT jsonb_agg(jsonb_build_object('name','Exercise '||e,'sets',3,'reps',10,'restSeconds',90,'loadKg',20+e,'rir',2,'cue','Controlled tempo and full range for set quality '||e,'alternatives','[]'::jsonb)) FROM generate_series(1,6) AS e))`;
  await db.tenant(scope, async (tx) => {
    await bulkRecords(
      tx,
      tenantId,
      "message",
      size.messages,
      followers,
      "sent",
      `jsonb_build_object('text','Synthetic coaching message '||i||': how did the last session feel, and did anything limit your range of motion today?','author',CASE WHEN i % 2=0 THEN 'subscriber' ELSE 'trainer' END,'authorUserId',($3::uuid[])[1+(i % cardinality($3::uuid[]))],'subscriberId',($3::uuid[])[1+(i % cardinality($3::uuid[]))])`,
    );
    await bulkRecords(
      tx,
      tenantId,
      "workout",
      size.workouts,
      followers,
      ["completed", "completed", "completed", "abandoned"],
      `jsonb_build_object('program',${program},'programId',gen_random_uuid())`,
      5,
    );
    await bulkRecords(
      tx,
      tenantId,
      "program",
      size.programs,
      followers,
      "assigned",
      program,
      7,
    );
    await bulkRecords(
      tx,
      tenantId,
      "intake",
      size.followers,
      followers,
      "complete",
      `jsonb_build_object('goals','Build strength safely over twelve weeks','experience','intermediate','daysPerWeek',3,'equipment','Commercial gym','allowedUses',jsonb_build_array('render','model_prompt'),'origin','platform')`,
      9,
    );
    await bulkRecords(
      tx,
      tenantId,
      "decision",
      size.exceptions,
      followers,
      "pending_review",
      `jsonb_build_object('message','Synthetic digital coaching draft '||i||' suggesting a lighter load after reported fatigue, pending trainer review.','subscriberId',($3::uuid[])[1+(i % cardinality($3::uuid[]))])`,
      11,
    );
    await bulkRecords(
      tx,
      tenantId,
      "exception",
      size.exceptions,
      followers,
      ["open", "resolved"],
      `jsonb_build_object('category','human_review','description','Synthetic review request '||i,'subscriberId',($3::uuid[])[1+(i % cardinality($3::uuid[]))])`,
      13,
    );
    await bulkRecords(
      tx,
      tenantId,
      "planned_session",
      size.plannedSessions,
      followers,
      "planned",
      `jsonb_build_object('date',to_char(now()+(i*interval '1 day'),'YYYY-MM-DD'),'label','Session '||i)`,
      15,
    );
    await bulkRecords(
      tx,
      tenantId,
      "rule",
      60,
      [owner.userId],
      ["confirmed", "draft"],
      `jsonb_build_object('title','Rule '||i,'category','progression','condition','When the client reports fatigue','directive','Hold load and reduce volume by one set','reason','Synthetic rule')`,
      17,
    );
    await bulkRecords(
      tx,
      tenantId,
      "scenario",
      30,
      [owner.userId],
      "draft",
      `jsonb_build_object('title','Scenario '||i,'prompt','A synthetic client scenario for evaluation '||i)`,
      19,
    );
    await bulkRecords(
      tx,
      tenantId,
      "support",
      60,
      followers,
      ["open", "closed"],
      `jsonb_build_object('subject','Synthetic support '||i,'category','account','messages','[]'::jsonb)`,
      21,
    );
    await bulkRecords(
      tx,
      tenantId,
      "product",
      4,
      [owner.userId],
      "published",
      `jsonb_build_object('name','Plan '||i,'priceMinor',30000+i,'tier',CASE WHEN i % 2=0 THEN 'workout' ELSE 'workout_nutrition' END)`,
      23,
    );
    // Teaching sources are the heaviest rows: full text plus overlapping chunks.
    await bulkRecords(
      tx,
      tenantId,
      "source",
      20,
      [owner.userId],
      "ready",
      `jsonb_build_object('title','Source '||i,'text',repeat('Progressive overload guidance for synthetic coaching material. ',300),'chunks',(SELECT jsonb_agg(jsonb_build_object('id','c'||c,'start',c*1800,'end',c*1800+2000,'text',repeat('Chunk text for synthetic material. ',55))) FROM generate_series(0,10) AS c),'allowedUses',jsonb_build_array('render','model_prompt','trainer_specific_learning'))`,
      25,
    );
    const workoutIds = (
      await tx.query(
        "SELECT id,owner_user_id FROM records WHERE kind='workout' ORDER BY created_at DESC,id LIMIT 500",
      )
    ).map((r: any) => [r.id, r.owner_user_id]);
    await tx.query(
      `INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data,created_at)
       SELECT gen_random_uuid(),$1,($2::uuid[])[1+(i % cardinality($2::uuid[]))],($3::uuid[])[1+(i % cardinality($3::uuid[]))],'bb-'||i,
         jsonb_build_object('exercise','Exercise '||(1+i % 6),'set',1+i % 3,'reps',8+i % 5,'loadKg',20+i % 40,'rir',2),now()-(i*interval '30 seconds')
       FROM generate_series(1,$4) AS i`,
      [
        tenantId,
        workoutIds.map((w) => w[1]),
        workoutIds.map((w) => w[0]),
        size.sets,
      ],
    );
    await tx.query(
      `INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor)
       SELECT gen_random_uuid(),$1,u,'sub_bb_'||replace(u::text,'-',''),CASE WHEN n % 10=0 THEN 'canceled' ELSE 'active' END,now()+(n*interval '1 hour'),30000
       FROM unnest($2::uuid[]) WITH ORDINALITY AS x(u,n)`,
      [tenantId, followers],
    );
    await tx.query(
      `INSERT INTO complimentary_access(id,tenant_id,user_id,tier,reason,granted_by)
       SELECT gen_random_uuid(),$1,u,'workout','Synthetic complimentary grant',$3 FROM unnest($2::uuid[]) AS u`,
      [tenantId, followers.slice(0, 60), owner.userId],
    );
    await tx.query(
      `INSERT INTO events(id,tenant_id,actor_id,name,subject_id,data,created_at)
       SELECT gen_random_uuid(),$1,$2,'synthetic.activity',i::text,jsonb_build_object('n',i),now()-(i*interval '1 minute') FROM generate_series(1,$3) AS i`,
      [tenantId, owner.userId, size.events],
    );
    await tx.query(
      `INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,input_tokens,output_tokens,cost_usd,price_version,created_at)
       SELECT gen_random_uuid(),$1,$2,'coaching','synthetic','synthetic-model',400,120,0.0012,'v1',now()-(i*interval '1 minute') FROM generate_series(1,$3) AS i`,
      [tenantId, owner.userId, size.costs],
    );
    await tx.query(
      `WITH j AS (INSERT INTO journals(id,tenant_id,source_key,description,created_at)
         SELECT gen_random_uuid(),$1,'bb:'||i,'Synthetic subscription receipt '||i,now()-(i*interval '1 hour') FROM generate_series(1,$2) AS i RETURNING id)
       INSERT INTO journal_lines(id,tenant_id,journal_id,account,amount_minor)
       SELECT gen_random_uuid(),$1,j.id,a.account,a.amount FROM j CROSS JOIN (VALUES('cash',30000),('trainer_payable',-30000)) AS a(account,amount)`,
      [tenantId, size.journals],
    );
    await tx.query(
      `INSERT INTO notifications(id,tenant_id,user_id,category,dedupe_key,title,body,created_at)
       SELECT gen_random_uuid(),$1,$2,'coaching','bb:'||i,'Synthetic notice '||i,'Open your coaching conversation.',now()-(i*interval '1 minute') FROM generate_series(1,$3) AS i`,
      [tenantId, owner.userId, size.notifications],
    );
  });
  const follower = {
    tenantId,
    userId: followers[0],
    role: "subscriber",
    name: followerRows[0].name,
    cookie: await session(db, followers[0], tenantId),
  };
  const otherFollower = {
    tenantId,
    userId: followers[1],
    role: "subscriber",
    name: followerRows[1].name,
    cookie: await session(db, followers[1], tenantId),
  };
  return {
    tenantId,
    owner,
    staff,
    finance,
    follower,
    otherFollower,
    followers,
    scope,
  };
}
