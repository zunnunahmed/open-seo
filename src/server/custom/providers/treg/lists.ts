import { z } from "zod";

const rawRow = z.record(z.string(), z.unknown());
const replySchema = z.object({
  error: z.unknown().optional(),
  result: z.object({
    data: z.array(rawRow),
    summary_info: z.object({total:z.number().optional()}).optional(),
  }),
});
export type TregListKind = "domains" | "backlinks";
export type TregListRow = {
  source: string;
  target: string | null;
  anchor: string | null;
  linkType: string | null;
  firstSeen: string | null;
  authority: number | null;
  linkCount: number | null;
};
export type TregListSnapshot = {
  provider: "serpstat-via-treg";
  kind: TregListKind;
  domain: string;
  rows: TregListRow[];
  total: number | null;
  fetchedAt: string;
  estimatedCostUsd: number;
};
function stringField(v:unknown):string|null { return typeof v==="string"?v:null; }
function numberField(v:unknown):number|null {return typeof v==="number"&&Number.isFinite(v)?v:null;}
export function parseTregList(body:unknown, kind:TregListKind, domain:string, fetchedAt:string):TregListSnapshot {
  const reply=replySchema.parse(body);
  if(reply.error!=null)throw new Error("treg returned an error");
  return {
    provider:"serpstat-via-treg",kind,domain,fetchedAt,
    rows:reply.result.data.map(r=>kind==="domains"?{
      source:stringField(r.domain_from)??"",
      target:null,anchor:null,linkType:null,firstSeen:null,
      authority:numberField(r.domainRank),linkCount:numberField(r.ref_pages),
    }:{
      source:stringField(r.url_from)??"",
      target:stringField(r.url_to),
      anchor:stringField(r.link_text),
      linkType:stringField(r.nofollow),
      firstSeen:stringField(r.first_seen),
      authority:numberField(r.domain_rank),
      linkCount:null,
    }).filter(x=>x.source.length>0),
    total:reply.result.summary_info?.total??null,
    estimatedCostUsd:kind==="backlinks"?0.01:0.01,
  };
}
export async function fetchTregList(kind:TregListKind,domain:string,token:string,fetchImpl:typeof fetch=fetch):Promise<TregListSnapshot>{
  const endpoint=kind==="domains"?"serpstat.web.linking_domains.list":"serpstat.web.backlinks.list";
  const method=kind==="domains"?"SerpstatBacklinksProcedure.getRefDomains":"SerpstatBacklinksProcedure.getNewBacklinks";
  const response=await fetchImpl(`https://treg.to/call/${endpoint}`,{
    method:"POST",headers:{"Content-Type":"application/json","X-Treg-Token":token},
    body:JSON.stringify({method,id:"1",params:{query:domain,searchType:"domain",page:1,size:20}}),
    signal:AbortSignal.timeout(20000),
  });
  if(!response.ok)throw new Error(`treg HTTP ${response.status}`);
  return parseTregList(await response.json() as unknown,kind,domain,new Date().toISOString());
}
