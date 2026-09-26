import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor,type Database,type Tx } from "@trainer/db";
import { currentPaidSubscription } from "./finance-billing.ts";
const fail=(statusCode:number,code:string,message:string)=>Object.assign(new Error(message),{statusCode,code});
export const notificationPreferencesSchema=z.object({
 email:z.boolean().default(true),bookings:z.boolean().default(true),workouts:z.boolean().default(true),marketing:z.boolean().default(false),
 quietStart:z.number().int().min(0).max(1439).default(1320),quietEnd:z.number().int().min(0).max(1439).default(480),
 timezone:z.string().max(80).default("Asia/Dubai").refine(v=>{try{new Intl.DateTimeFormat("en",{timeZone:v}).format();return true;}catch{return false;}},"Use a valid time zone"),
}).strict();
type Preferences=z.infer<typeof notificationPreferencesSchema>;
type Category="safety"|"account"|"booking"|"workout"|"coaching"|"marketing";
export type NotificationInput={userId:string;category:Category;dedupeKey:string;title:string;body:string;href?:string;templateKey?:string;source?:Record<string,unknown>};
const critical=(category:string)=>["safety","account"].includes(category);
function enabled(p:Preferences,category:string){return critical(category)||(p.email&&(category!=="marketing"||p.marketing)&&(category!=="booking"||p.bookings)&&(category!=="workout"||p.workouts));}
export function nextNotificationTime(p:Preferences,now=new Date()):Date {
 if(p.quietStart===p.quietEnd)return now;
 const fmt=new Intl.DateTimeFormat("en-GB",{timeZone:p.timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
 const quiet=(time:Date)=>{const parts=Object.fromEntries(fmt.formatToParts(time).map(v=>[v.type,v.value]));const minute=Number(parts.hour)*60+Number(parts.minute);return p.quietStart<p.quietEnd?minute>=p.quietStart&&minute<p.quietEnd:minute>=p.quietStart||minute<p.quietEnd;};
 if(!quiet(now))return now;
 for(let minute=1;minute<=1560;minute++){const time=new Date(now.getTime()+minute*60000);if(!quiet(time))return time;}
 return new Date(now.getTime()+26*3600000);
}
export async function notifyUser(tx:Tx,a:Actor,input:NotificationInput){
 if(a.role==="subscriber"&&input.userId!==a.userId&&!["safety","coaching"].includes(input.category))throw fail(403,"NOTIFICATION_SCOPE","This notification is not permitted");
 const[priorRole]=await tx.query("SELECT current_setting('app.role',true) role");
 await tx.query("SELECT set_config('app.role','owner',true)");
 try{
  const [target]=await tx.query("SELECT u.email,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2",[a.tenantId,input.userId]);
  if(!target)return null;
  if(a.role==="subscriber"&&input.userId!==a.userId&&!["owner","staff"].includes(target.role))throw fail(403,"NOTIFICATION_SCOPE","A safety alert must go to your trainer");
  const[pref]=await tx.query("SELECT data FROM notification_preferences WHERE user_id=$1",[input.userId]),p=notificationPreferencesSchema.parse(pref?.data??{});
  const body=input.body.slice(0,4000),href=/^\/(app|trainer)(\/|$)/.test(input.href??"")?(input.href??""):"";
  let title=input.title.slice(0,160),rendered=body,template:any=null;
  if(input.templateKey){template=(await tx.query("SELECT published_notification_template($1) value",[input.templateKey]))[0]?.value; if(template){const values:Record<string,string>={name:target.name,coach:"Your coach",link:href,date:new Date().toISOString().slice(0,10),message:body};const render=(s:string)=>s.replace(/\{\{(name|coach|link|date|message)\}\}/g,(_match,key)=>values[key]);title=render(template.title).slice(0,160);const expanded=render(template.body);rendered=critical(input.category)?(body.length>=3998?body:expanded.slice(0,3998-body.length)+"\n\n"+body):expanded.slice(0,4000);}}
  const canEmail=enabled(p,input.category),notificationId=randomUUID();
  const[row]=await tx.query("INSERT INTO notifications(id,tenant_id,user_id,category,dedupe_key,title,body,href,email_status,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id",[notificationId,a.tenantId,input.userId,input.category,input.dedupeKey,title,rendered,href,canEmail?"pending":"suppressed",JSON.stringify({source:input.source??null,template:template?{key:template.key,version:template.version}:null})]);
  if(!row)return null;
  if(canEmail){const due=critical(input.category)?new Date():nextNotificationTime(p);await tx.query("INSERT INTO jobs(id,tenant_id,kind,intent_key,data,available_at) VALUES($1,$2,'email',$3,$4,$5) ON CONFLICT DO NOTHING",[randomUUID(),a.tenantId,`notification:${notificationId}`,JSON.stringify({notificationId,userId:input.userId,category:input.category,to:target.email,subject:title,text:rendered+(href?`\n\n${process.env.PUBLIC_APP_URL??"http://localhost:3000"}${href}`:"")}),due.toISOString()]);}
  return row;
 }finally{await tx.query("SELECT set_config('app.role',$1,true)",[priorRole?.role??a.role]);}
}
export async function notifyCoachingTeam(tx:Tx,a:Actor,input:Omit<NotificationInput,"userId">){
 const[priorRole]=await tx.query("SELECT current_setting('app.role',true) role");
 let trainers:any[]=[];
 await tx.query("SELECT set_config('app.role','owner',true)");
 try { trainers=await tx.query("SELECT user_id FROM memberships WHERE tenant_id=$1 AND role IN ('owner','staff')",[a.tenantId]); }
 finally { await tx.query("SELECT set_config('app.role',$1,true)",[priorRole?.role??a.role]); }
 for(const trainer of trainers)await notifyUser(tx,a,{...input,userId:trainer.user_id});
}
export async function notificationDeliveryDecision(db:Database,tenantId:string,job:any,now=new Date()):Promise<{allowed:boolean;due?:Date}>{
 if(!job.data.notificationId)return {allowed:true};
 return db.tenant({tenantId,userId:job.data.userId,role:"owner"},async tx=>{
  const[n]=await tx.query("SELECT * FROM notifications WHERE id=$1 AND user_id=$2",[job.data.notificationId,job.data.userId]);if(!n||n.email_status==="sent")return {allowed:false};
  const[m]=await tx.query("SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2",[tenantId,job.data.userId]);if(!m)return {allowed:false};
  const[pref]=await tx.query("SELECT data FROM notification_preferences WHERE user_id=$1",[job.data.userId]),p=notificationPreferencesSchema.parse(pref?.data??{});if(!enabled(p,n.category))return {allowed:false};
  const source=n.data.source;
  if(source?.type==="booking"){const[b]=await tx.query("SELECT b.status,s.starts_at,s.status slot_status FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id WHERE b.id=$1 AND b.user_id=$2",[source.id,n.user_id]);if(!b||b.status!=="confirmed"||b.slot_status!=="open"||new Date(b.starts_at).getTime()!==Date.parse(source.startsAt)||new Date(b.starts_at)<=now)return {allowed:false};}
  if(source?.type==="workout"){const[r]=await tx.query("SELECT status,data FROM records WHERE id=$1 AND kind='planned_session' AND owner_user_id=$2",[source.id,n.user_id]);if(!r||r.status!=="planned"||r.data.date!==source.date||!(await currentPaidSubscription(tx,n.user_id)))return {allowed:false};const today=new Intl.DateTimeFormat("en-CA",{timeZone:r.data.timezone??"Asia/Dubai",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);if(source.date<today)return {allowed:false};}
  return {allowed:true,due:critical(n.category)?now:nextNotificationTime(p,now)};
 });
}
export async function scheduleNotifications(db:Database,tenantId:string){
 const a={tenantId,userId:"00000000-0000-0000-0000-000000000000",role:"owner"};
 await db.tenant(a,async tx=>{
  const bookings=await tx.query("SELECT b.id,b.user_id,s.title,s.starts_at FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id WHERE b.status='confirmed' AND s.status='open' AND s.starts_at>now() AND s.starts_at<=now()+interval '24 hours'");
  for(const b of bookings)await notifyUser(tx,a,{userId:b.user_id,category:"booking",dedupeKey:`booking-reminder:${b.id}:${new Date(b.starts_at).toISOString()}`,title:"Your coaching session is coming up",body:`${b.title} starts at ${new Date(b.starts_at).toISOString()}. Open your bookings for the time in your time zone.`,href:"/app/bookings",templateKey:"booking-reminder",source:{type:"booking",id:b.id,startsAt:new Date(b.starts_at).toISOString()}});
  const planned=await tx.query("SELECT id,owner_user_id,data FROM records WHERE kind='planned_session' AND status='planned'");
  for(const p of planned){if(!(await currentPaidSubscription(tx,p.owner_user_id)))continue;const timezone=p.data.timezone??"Asia/Dubai",fmt=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"});const today=fmt.format(new Date()),tomorrow=fmt.format(new Date(Date.now()+24*3600000));if(![today,tomorrow].includes(p.data.date))continue;await notifyUser(tx,a,{userId:p.owner_user_id,category:"workout",dedupeKey:`workout-reminder:${p.id}:${p.data.date}:${today}`,title:p.data.date===today?"Your training is planned for today":"Your next training day",body:`${p.data.label??"Your session"} is planned for ${p.data.date}. Your coach's current prescription is ready in your program.`,href:"/app/program",templateKey:"workout-reminder",source:{type:"workout",id:p.id,date:p.data.date}});}
 });
}
export function registerNotifications(app:FastifyInstance,db:Database,identity:(r:FastifyRequest)=>Actor){
 app.get("/api/v1/notifications/preferences",async req=>{const a=identity(req);return db.tenant(a,async tx=>{const[r]=await tx.query("SELECT data,version FROM notification_preferences WHERE user_id=$1",[a.userId]);return {data:notificationPreferencesSchema.parse(r?.data??{}),version:r?.version??0};});});
 app.put("/api/v1/notifications/preferences",async req=>{const a=identity(req),b=z.object({version:z.number().int().min(0),data:notificationPreferencesSchema}).strict().parse(req.body);return db.tenant(a,async tx=>{await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[a.tenantId+":notifications:"+a.userId]);const[r]=await tx.query("SELECT version FROM notification_preferences WHERE user_id=$1",[a.userId]);if((r?.version??0)!==b.version)throw fail(409,"PREFERENCES_CHANGED","Your preferences changed. Reload before saving");return(await tx.query("INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET data=excluded.data,version=notification_preferences.version+1,updated_at=now() RETURNING data,version",[a.tenantId,a.userId,JSON.stringify(b.data)]))[0];});});
 app.get("/api/v1/notifications",async req=>{const a=identity(req),q=z.object({offset:z.coerce.number().int().min(0).default(0)}).parse(req.query);return db.tenant(a,tx=>tx.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET $2",[a.userId,q.offset]));});
 app.post("/api/v1/notifications/:id/read",async req=>{const a=identity(req);return db.tenant(a,async tx=>{await tx.query("UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2",[z.string().uuid().parse((req.params as any).id),a.userId]);return {ok:true};});});
}
