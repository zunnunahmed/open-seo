import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getSitemapMonitor } from "@/serverFunctions/sitemapMonitor";
export function DashboardSitemapMonitor({projectId}:{projectId:string}) {
 const {data,isPending,isError}=useQuery({
   queryKey:["sitemapMonitor",projectId],
   queryFn:()=>getSitemapMonitor({data:{projectId}}),
 });
 if(isPending)return <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Loading sitemap monitoring…</section>;
 if(isError)return <section className="rounded-xl border bg-card p-4 text-sm text-destructive">Could not load sitemap report.</section>;
 const history=data?.history??[];
 const current=history[0];
 const previous=history[1];
 const change=current&&previous?current.urlCount-previous.urlCount:null;
 const max=Math.max(1,...history.map(s=>s.urlCount));
 return <section className="space-y-3 rounded-xl border border-border bg-card p-4">
  <div className="flex flex-wrap items-start justify-between gap-2">
   <div><h2 className="font-semibold">Monthly sitemap page count</h2>
    <p className="text-xs text-muted-foreground">Unique sitemap-listed URLs, not indexed pages or a full HTML crawl</p></div>
   <Link to="/p/$projectId/settings" params={{projectId}} className="text-xs underline">Configure</Link>
  </div>
  {!data?.config?<p className="text-sm text-muted-foreground">Set your sitemap URL in Project Settings to start tracking.</p>:!current?
   <p className="text-sm text-muted-foreground">No snapshots yet. Run the first check in Project Settings.</p>:<>
    <div className="flex flex-wrap items-baseline gap-3">
     <strong className="text-3xl tabular-nums">{current.urlCount.toLocaleString()}</strong>
     <span className="text-sm text-muted-foreground">URLs</span>
     {change!==null?<span className="text-sm font-medium">{change>=0?"+":""}{change.toLocaleString()} since prior check</span>:null}
    </div>
    <p className="text-xs text-muted-foreground">Last checked {new Date(current.scannedAt).toLocaleDateString()} · {current.sitemapCount} sitemaps · {current.complete?"Complete":"Partial scan"}</p>
    <div className="space-y-2" role="img" aria-label={history.slice(0,12).map(s=>`${new Date(s.scannedAt).toLocaleDateString()}: ${s.urlCount} URLs`).join("; ")}>
     {history.slice(0,12).reverse().map(s=><div key={s.scannedAt} className="grid grid-cols-[75px_1fr_55px] items-center gap-2 text-xs">
      <span>{new Date(s.scannedAt).toLocaleDateString(undefined,{month:"short",year:"2-digit"})}</span>
      <div className="h-3 rounded bg-muted"><div className="h-3 rounded bg-primary" style={{width:`${100*s.urlCount/max}%`}}/></div>
      <span className="text-right tabular-nums">{s.urlCount.toLocaleString()}</span>
     </div>)}
    </div>
    {!current.complete?<p role="status" className="text-xs text-destructive">Latest result is partial or had errors. Do not interpret a decrease as confirmed page removal.</p>:null}
   </>}
 </section>;
}
