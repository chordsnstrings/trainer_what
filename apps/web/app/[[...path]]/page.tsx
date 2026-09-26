import Workspace from "../../components/workspace";
import { CoachWebsite } from "../../components/coach-site";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { verifiedProxyHeaders } from "../../host-proxy";
const website=cache(async(slug:string)=>{
  if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug))return null;
  const incoming=await headers(),origin=incoming.get("x-trainer-site-origin")??process.env.PUBLIC_APP_URL??"http://localhost:3000";
  const target=`/api/v1/public/sites/${slug}`;
  const response=await fetch(new URL(target,process.env.API_INTERNAL_URL??"http://127.0.0.1:4000"),{headers:verifiedProxyHeaders(new Headers(),new URL(origin).host,"GET",target,process.env.INTERNAL_PROXY_SECRET),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
  if(response.status===404||response.status===421)return null;
  if(!response.ok)throw new Error("This coaching website is temporarily unavailable.");
  return response.json();
});
export async function generateMetadata({params}:{params:Promise<{path?:string[]}>}):Promise<Metadata>{
  const {path=[]}=await params;if(path[0]!=="coach"||!path[1])return {};
  const data=await website(path[1]);if(!data)return {title:"Coaching website unavailable",robots:{index:false,follow:false}};
  const page=data.site.pages.find((p:any)=>p.visible&&p.slug===path[2]);
  return {title:page?`${page.title} — ${data.tenant.name}`:data.site.seoTitle||data.tenant.name,description:data.site.seoDescription||data.site.introduction,manifest:`/api/v1/public/sites/${data.tenant.slug}/manifest.webmanifest`,icons:{icon:`/api/v1/public/sites/${data.tenant.slug}/icon/192`,apple:`/api/v1/public/sites/${data.tenant.slug}/icon/192`}};
}
export default async function Page({params}:{params:Promise<{path?:string[]}>}) {
  const {path=[]}=await params;
  if(path[0]==="coach"&&path[1]){
    const data=await website(path[1]);if(!data)notFound();
    const section=path[2];
    if(path.length>3||(section&&!["about","memberships","galleries","contact"].includes(section)&&!data.site.pages.some((p:any)=>p.visible&&p.slug===section)))notFound();
    return <CoachWebsite initialData={data} path={path.slice(2).join("/")}/>;
  }
  return <Workspace/>;
}
