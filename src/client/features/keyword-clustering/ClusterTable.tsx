import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  isDomainOrSubdomain,
  urlDomain,
  type KeywordCluster,
} from "@/shared/keywordClustering";
import { featureLabel } from "./clusterExports";

function ClusterDetails({
  cluster,
  ownDomain,
}: {
  cluster: KeywordCluster;
  ownDomain: string | null;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-medium">Keywords</p>
        <ul className="space-y-0.5 text-xs">
          {cluster.keywords.map((k) => (
            <li key={k.keyword} className="flex justify-between gap-3">
              <span>{k.keyword}</span>
              <span className="tabular-nums text-muted-foreground">
                {k.volume?.toLocaleString() ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium">
          URLs ranking for most of these keywords
        </p>
        <ul className="space-y-0.5 break-all text-xs">
          {cluster.sharedUrls.slice(0, 10).map((url) => (
            <li key={url}>
              <a
                href={`https://${url}`}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
                onClick={(e) => e.stopPropagation()}
              >
                {url}
              </a>
              {ownDomain && isDomainOrSubdomain(urlDomain(url), ownDomain) ? (
                <span className="ml-1 text-primary">(yours)</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ClusterTable({
  clusters,
  ownDomain,
  competitors,
}: {
  clusters: KeywordCluster[];
  ownDomain: string | null;
  competitors: string[];
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-3">Main keyword</th>
            <th className="p-3 text-right">Keywords</th>
            <th className="p-3 text-right">Volume</th>
            <th className="p-3">Page type</th>
            <th className="p-3">Top domains</th>
            <th className="p-3">{ownDomain ? "Your page" : "Plan"}</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((cluster) => {
            const hits = competitors.filter((domain) =>
              cluster.topDomains.some((d) =>
                isDomainOrSubdomain(d.domain, domain),
              ),
            );
            const expanded = open.has(cluster.id);
            return (
              <Fragment key={cluster.id}>
                <tr
                  className="cursor-pointer border-b hover:bg-muted/50"
                  onClick={() => toggle(cluster.id)}
                >
                  <td className="p-3 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <ChevronRight
                        className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                          expanded ? "rotate-90" : ""
                        }`}
                      />
                      {cluster.main.keyword}
                    </span>
                    {cluster.features.length ? (
                      <div className="text-xs font-normal text-muted-foreground">
                        {cluster.features.map(featureLabel).join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {cluster.keywords.length}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {cluster.totalVolume.toLocaleString()}
                  </td>
                  <td className="p-3">{cluster.pageType}</td>
                  <td className="p-3 text-xs">
                    {cluster.topDomains
                      .slice(0, 3)
                      .map((d) => d.domain)
                      .join(", ")}
                    {hits.length ? (
                      <div className="font-medium text-primary">
                        Competitors: {hits.join(", ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3 text-xs">
                    {cluster.ownUrls.length > 1 ? (
                      <span className="text-destructive">
                        Cannibalization: {cluster.ownUrls.length} pages
                      </span>
                    ) : cluster.ownUrls.length === 1 ? (
                      cluster.ownUrls[0]
                    ) : (
                      "New page"
                    )}
                  </td>
                </tr>
                {expanded ? (
                  <tr className="border-b bg-muted/30">
                    <td colSpan={6} className="p-3">
                      <ClusterDetails cluster={cluster} ownDomain={ownDomain} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {clusters.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-6 text-center text-muted-foreground">
                No clusters at this threshold. Lower the number of shared URLs
                or switch to soft mode.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
