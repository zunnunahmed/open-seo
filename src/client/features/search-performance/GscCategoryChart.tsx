import { useMemo } from "react";
import { Button } from "@/client/components/ui/button";
import { classifyGscUrl } from "@/client/features/search-performance/urlCategories";
import type { SearchPerformanceTableRow } from "@/client/features/search-performance/SearchPerformanceColumns";
import { exportRows } from "@/client/lib/exportRows";

const ORDER = ["Performance", "Good", "Fair", "Weak", "Dead"] as const;

export function aggregatePageCategories(rows: Pick<SearchPerformanceTableRow,"clicks">[]) {
  const counts: Record<(typeof ORDER)[number],number>={Performance:0,Good:0,Fair:0,Weak:0,Dead:0};
  for(const row of rows) counts[classifyGscUrl(row.clicks).category]++;
  return ORDER.map(category=>({category,count:counts[category]}));
}

export function GscCategoryChart({rows,rangeLabel}:{
  rows:SearchPerformanceTableRow[];
  rangeLabel:string;
}) {
  const summary=useMemo(()=>aggregatePageCategories(rows),[rows]);
  const largest=Math.max(1,...summary.map(x=>x.count));
  const total=summary.reduce((sum,x)=>sum+x.count,0);
  const downloadCsv=()=>exportRows({
    format:"csv",feature:"search_performance",
    filename:`gsc-url-categories-${rangeLabel}`,
    headers:["Category","URLs","Percentage","Date range"],
    rows:summary.map(x=>[x.category,x.count,total?Number((x.count/total*100).toFixed(2)):0,rangeLabel]),
  });
  const downloadSvg=()=>{
    const bars=summary.map((r,i)=>{
      const y=90+i*52;
      const w=Math.round(500*r.count/largest);
      return `<text x="16" y="${y+15}" font-size="15" fill="#111827">${r.category}</text><rect x="150" y="${y}" width="500" height="22" rx="4" fill="#e5e7eb"/><rect x="150" y="${y}" width="${w}" height="22" rx="4" fill="#4263a6"/><text x="660" y="${y+16}" font-size="14" fill="#111827">${r.count}</text>`;
    }).join("");
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="750" height="410" viewBox="0 0 750 410"><rect width="750" height="410" fill="white"/><text x="16" y="34" fill="#111827" font-size="22" font-weight="600">GSC URL categories</text><text x="16" y="56" fill="#4b5563" font-size="13">Date range: ${rangeLabel} · ${total} returned URLs</text>${bars}<text x="16" y="381" font-size="12" fill="#4b5563">Based on GSC returned URLs; missing sitemap URLs are not included.</text></svg>`;
    const url=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"}));
    const link=document.createElement("a");
    link.href=url;link.download=`gsc-url-categories-${rangeLabel}.svg`;link.click();
    URL.revokeObjectURL(url);
  };
  return <section className="space-y-3 border-b border-border px-4 py-4" aria-label="URL category distribution">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-base font-semibold">URL category distribution</h2>
      <p className="text-xs text-muted-foreground">Based on {total.toLocaleString()} GSC-returned page URLs for the selected filters and date range{total >= 1000 ? " (first 1,000 GSC export rows; not the full site)":""}. No sitemap-only URLs included.</p></div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={()=>void downloadCsv()}>Download CSV</Button>
        <Button size="sm" variant="outline" onClick={downloadSvg}>Download chart SVG</Button>
      </div>
    </div>
    <div className="space-y-3" role="img" aria-label={summary.map(x=>`${x.category}: ${x.count} URLs`).join(", ")}>
      {summary.map(x=><div key={x.category} className="grid grid-cols-[92px_minmax(0,1fr)_60px] items-center gap-3 text-xs sm:grid-cols-[110px_minmax(0,1fr)_75px]">
        <span>{x.category}</span><div className="h-5 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary" style={{width:`${100*x.count/largest}%`}}/></div>
        <span className="text-right tabular-nums">{x.count.toLocaleString()}</span>
      </div>)}
    </div>
  </section>;
}
