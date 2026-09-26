import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase,putRecord,type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { registerNotifications,notifyUser,nextNotificationTime,notificationPreferencesSchema,notificationDeliveryDecision,scheduleNotifications } from "../apps/api/src/notifications.ts";
import { executeEmailDelivery } from "../apps/worker/src/email-delivery.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
let db:Database,app:Awaited<ReturnType<typeof buildApp>>,a:any,b:any,client:any;
const request=(path:string,method:any="GET",body?:any,cookie?:string)=>app.inject({url:"/api/v1"+path,method,headers:{origin:"http://localhost:3000",...(cookie?{cookie}:{}),...(body?{"content-type":"application/json"}:{})},payload:body});
async function register(slug:string){const r=await request("/auth/register","POST",{name:"Coach "+slug,email:slug+"@example.test",password:"TestingOnly2026!",slug,accepted:true});assert.equal(r.statusCode,201,r.body);const cookie=String(r.headers["set-cookie"]).split(";")[0];return {...(await request("/bootstrap","GET",undefined,cookie)).json().user,cookie};}
before(async()=>{db=await createDatabase({memory:true});app=await buildApp({db,testing:true});if(!app.hasRoute({method:"GET",url:"/api/v1/notifications"}))registerNotifications(app,db,r=>r.identity!);a=await register("notify-one");b=await register("notify-two");const invitation=await request("/invitations","POST",{email:"notify-client@example.test",role:"subscriber"},a.cookie);const token=invitation.json().url.split("/").pop();const joined=await request("/invitations/accept","POST",{token,name:"Client",email:"notify-client@example.test",password:"TestingClient2026!"});assert.equal(joined.statusCode,200,joined.body);const cookie=String(joined.headers["set-cookie"]).split(";")[0];client={...(await request("/bootstrap","GET",undefined,cookie)).json().user,cookie};});
after(async()=>{await app.close();await db.close();});
test("preferences survive reload and stale writes or another member cannot change them",async()=>{
 const p=(await request("/notifications/preferences","GET",undefined,client.cookie)).json();const body={version:p.version,data:{...p.data,email:false,marketing:true,quietStart:60,quietEnd:120}};
 assert.equal((await request("/notifications/preferences","PUT",body,client.cookie)).statusCode,200);
 const got=(await request("/notifications/preferences","GET",undefined,client.cookie)).json();assert.equal(got.data.email,false);assert.equal(got.data.marketing,true);
 assert.equal((await request("/notifications/preferences","PUT",body,client.cookie)).statusCode,409);
 assert.equal((await request("/notifications/preferences","GET",undefined,b.cookie)).json().data.email,true);
});
test("quiet windows cross midnight and daylight transitions without suppressing forever",()=>{
 const p=notificationPreferencesSchema.parse({timezone:"Asia/Dubai",quietStart:1320,quietEnd:480});
 assert.equal(nextNotificationTime(p,new Date("2026-09-26T20:00:00Z")).toISOString(),"2026-09-27T04:00:00.000Z");
 const q={...p,timezone:"America/New_York",quietStart:0,quietEnd:180};
 assert.equal(nextNotificationTime(q,new Date("2026-11-01T04:30:00Z")).toISOString(),"2026-11-01T08:00:00.000Z");
});
test("safety alerts are deduped, preserve critical text after long templates, and restore caller scope",async()=>{
 await db.system(tx=>tx.query("INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at) VALUES($1,'notification','safety-template',1,'Safety for {{name}}',$2,'published',now()-interval '1 second',$3,$3,now())",[randomUUID(),"Long reviewed context ".repeat(400),a.userId]));
 const key="safety-"+randomUUID(),body="Stop this session and open the trainer review. This instruction must remain intact.";
 const result=await db.tenant(client,async tx=>{const first=await notifyUser(tx,client,{userId:a.userId,category:"safety",dedupeKey:key,title:"Review required",body,templateKey:"safety-template",href:"/trainer/exceptions"});assert.equal(await notifyUser(tx,client,{userId:a.userId,category:"safety",dedupeKey:key,title:"Again",body}),null);assert.equal((await tx.query("SELECT current_setting('app.role') role"))[0].role,"subscriber");return first;});
 const [notice]=await db.tenant(a,tx=>tx.query("SELECT * FROM notifications WHERE id=$1",[result!.id]));assert.ok(notice.body.endsWith(body));assert.ok(notice.body.length<=4000);assert.equal(notice.email_status,"pending");
 assert.equal((await request("/notifications","GET",undefined,b.cookie)).json().some((r:any)=>r.id===result!.id),false);
});
test("reminders obey current choices and an uncertain email is never dispatched again automatically",async()=>{
 let id:string;await db.tenant(a,async tx=>{await notifyUser(tx,a,{userId:client.userId,category:"workout",dedupeKey:"disabled-reminder",title:"Train",body:"A session is ready"});const[n]=await tx.query("SELECT * FROM notifications WHERE dedupe_key='disabled-reminder'");assert.equal(n.email_status,"suppressed");const n2=await notifyUser(tx,a,{userId:client.userId,category:"account",dedupeKey:"account-test",title:"Account alert",body:"Review this account change"});id=n2!.id;});
 const job=await db.tenant(a,async tx=>(await tx.query("UPDATE jobs SET attempts=1,leased_until=now()+interval '2 minutes' WHERE data->>'notificationId'=$1 RETURNING *",[id!]))[0]);
 let calls=0;const send=async()=>{calls++;const[j]=await db.tenant(a,tx=>tx.query("SELECT status,data FROM jobs WHERE id=$1",[job.id]));assert.equal(j.status,"blocked");assert.equal(j.data.deliveryState,"unknown");throw new Error("Connection ended after dispatch");};
 await withRuntimeConfig({EMAIL_API_URL:"https://email.example.test/send",EMAIL_API_KEY:"fixture",EMAIL_FROM:"coach@example.test"},async()=>{await executeEmailDelivery(db,a.tenantId,job,send);await executeEmailDelivery(db,a.tenantId,job,send);});assert.equal(calls,1);
 const[j]=await db.tenant(a,tx=>tx.query("SELECT status,last_error FROM jobs WHERE id=$1",[job.id]));assert.equal(j.status,"blocked");assert.match(j.last_error,/unknown/);
});
test("scheduled workouts dedupe and canceled or rescheduled source events suppress stale reminders",async()=>{
 await db.tenant(a,async tx=>{await tx.query("INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '20 days',10000) ON CONFLICT(tenant_id,user_id) DO UPDATE SET status='active',period_end=excluded.period_end",[randomUUID(),a.tenantId,client.userId]);await tx.query("UPDATE notification_preferences SET data=data||'{\"email\":true,\"workouts\":true,\"quietStart\":0,\"quietEnd\":0}'::jsonb WHERE user_id=$1",[client.userId]);});
 const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dubai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());const plan=await db.tenant(a,tx=>putRecord(tx,a,"planned_session",{date,timezone:"Asia/Dubai",label:"Session A"},{ownerId:client.userId,status:"planned"}));
 await scheduleNotifications(db,a.tenantId);await scheduleNotifications(db,a.tenantId);
 const jobs=await db.tenant(a,tx=>tx.query("SELECT j.* FROM jobs j JOIN notifications n ON n.id=(j.data->>'notificationId')::uuid WHERE n.data->'source'->>'id'=$1",[plan.id]));assert.equal(jobs.length,1);assert.equal((await notificationDeliveryDecision(db,a.tenantId,jobs[0])).allowed,true);
 await db.tenant(a,tx=>tx.query("UPDATE records SET status='canceled' WHERE id=$1",[plan.id]));assert.equal((await notificationDeliveryDecision(db,a.tenantId,jobs[0])).allowed,false);
});
