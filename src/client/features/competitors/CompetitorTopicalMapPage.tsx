import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import { toast } from "sonner";
import { Network, Download, ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Card } from "@/client/components/ui/card";
import { getDomainPagesPage } from "@/serverFunctions/domain";
import { saveCompetitorTopicalMap, listCompetitorTopicalMaps, getCompetitorTopicalMap, deleteCompetitorTopicalMap } from "@/serverFunctions/competitorTopicalMap";
import { domainField } from "@/types/schemas/domain";
import type { PageRow } from "@/client/features/domain/types";

const LIMITS = [25, 50, 100, 200, 500, 1000] as const;
const MARKETS = [
  { label: "Australia", value: 2036 },
  { label: "United States", value: 2840 },
  { label: "United Kingdom", value: 2826 },
  { label: "Canada", value: 2124 },
] as const;

function clusterName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const slug = segments.length > 1 ? segments[0] : segments[0] ?? "Home";
  if (slug === "Home") return "Home";
  const isGeneric = ["blog", "articles", "resources", "guides", "news"].includes(slug);
  const topic = isGeneric ? (segments[1] ?? slug) : slug;
  return topic.replace(/[-_]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function toCsv(rows: PageRow[]): string {
  const quote = (value: string | number | null) =>
    '"' + String(value ?? "").replaceAll('"', '""') + '"';
  return [
    ["Topic (URL-based)", "URL", "Estimated traffic", "Ranking keywords"].map(quote).join(","),
    ...rows.map((row) =>
      [clusterName(row.relativePath ?? new URL(row.page).pathname), row.page, row.organicTraffic, row.keywords]
        .map(quote).join(","),
    ),
  ].join("\r\n");
}

export function CompetitorTopicalMapPage({ projectId }: { projectId: string }) {
  const [domain, setDomain] = useState("");
  const [market, setMarket] = useState(2036);
  const [limit, setLimit] = useState(100);
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [analysedDomain, setAnalysedDomain] = useState("");
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const [selectedTab, setSelectedTab] = useState<"map" | "pages" | "compare">("map");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [saved, setSaved] = useState<Array<{ id: string; domain: string; market: number; requestedLimit: number; pageCount: number; complete: boolean; savedAt: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const { data: projects } = useQuery(projectsQueryOptions());
  const mySite = projects?.find((project) => project.id === projectId)?.domain ?? "";
  const [comparison, setComparison] = useState<PageRow[]>([]);
  const [comparing, setComparing] = useState(false);
  const [comparisonDomain, setComparisonDomain] = useState("");
  const [comparisonError, setComparisonError] = useState("");


  async function refreshSaved() {
    try {
      setSaved(await listCompetitorTopicalMaps({ data: { projectId } }));
    } catch {
      toast.error("Could not load saved research.");
    }
  }

  useEffect(() => {
    void refreshSaved();
  }, [projectId]);

  async function openSaved(id: string) {
    try {
      const record = await getCompetitorTopicalMap({ data: { projectId, id } });
      if (!record) { toast.error("Saved analysis not found."); return; }
      setDomain(record.domain);
      setMarket(record.market);
      setLimit(record.requestedLimit);
      setPages(record.pages);
      setCompleted(record.pages.length);
      setAnalysedDomain(record.domain);
      setSavedId(record.id);
      setComparison([]);
      setComparisonDomain("");
      setError("");
      setExpanded(null);
      toast.success("Saved research loaded. No SEO API request made.");
    } catch {
      toast.error("Could not open saved research.");
    }
  }

  async function removeSaved(id: string) {
    try {
      await deleteCompetitorTopicalMap({ data: { projectId, id } });
      if (savedId === id) setSavedId(null);
      await refreshSaved();
      toast.success("Saved research deleted.");
    } catch {
      toast.error("Could not delete saved research.");
    }
  }

  async function storeSnapshot(host: string, records: PageRow[], complete: boolean) {
    setSaving(true);
    try {
      const result = await saveCompetitorTopicalMap({
        data: { projectId, domain: host, market, requestedLimit: limit, pages: records, complete },
      });
      setSavedId(result.id);
      await refreshSaved();
      toast.success(complete ? "Analysis saved to your project." : "Partial results saved to your project.");
    } catch {
      toast.error("Analysis finished, but saving failed. Export your results before leaving.");
    } finally {
      setSaving(false);
    }
  }


  const groups = useMemo(() => {
    const grouped = new Map<string, PageRow[]>();
    for (const row of pages) {
      const name = clusterName(row.relativePath ?? new URL(row.page).pathname);
      grouped.set(name, [...(grouped.get(name) ?? []), row]);
    }
    return [...grouped].map(([name, rows]) => ({
      name,
      rows,
      estimatedTraffic: rows.reduce((sum, row) => sum + (row.organicTraffic ?? 0), 0),
    })).sort((a, b) => b.estimatedTraffic - a.estimatedTraffic);
  }, [pages]);


  const comparisonGroups = useMemo(() => {
    const own = new Map<string, PageRow[]>();
    for (const row of comparison) {
      const key = clusterName(row.relativePath ?? new URL(row.page).pathname).toLowerCase();
      own.set(key, [...(own.get(key) ?? []), row]);
    }
    return groups.map((group) => ({
      ...group,
      ownPages: own.get(group.name.toLowerCase()) ?? [],
    }));
  }, [comparison, groups]);

  async function compareWithMine() {
    if (!mySite || !pages.length || comparing || !acknowledged) return;
    let host: string;
    try {
      host = domainField.parse(mySite);
    } catch {
      setComparisonError("Your project needs a valid website domain in Project Settings.");
      return;
    }
    setComparison([]);
    setComparisonDomain("");
    setComparisonError("");
    setComparing(true);
    const results: PageRow[] = [];
    const pageSize = limit <= 50 ? 50 : limit <= 100 ? 100 : 200;
    try {
      for (let offset = 0; offset < limit; offset += pageSize) {
        const response = await getDomainPagesPage({
          data: {
            projectId, domain: host, scope: "domain", locationCode: market,
            page: Math.floor(offset / pageSize) + 1, pageSize,
            sortMode: "traffic", sortOrder: "desc", filters: {},
          },
        });
        results.push(...response.pages.slice(0, limit - offset));
        if (!response.hasMore || !response.pages.length) break;
      }
      setComparison(results);
      setComparisonDomain(host);
    } catch (cause) {
      setComparisonError(cause instanceof Error ? cause.message : "Could not retrieve your site's ranking pages.");
    } finally {
      setComparing(false);
    }
  }

  async function analyse() {
    let host: string;
    try {
      host = domainField.parse(domain);
    } catch {
      setError("Enter a valid competitor domain.");
      return;
    }
    if (!acknowledged) {
      setError("Confirm that you understand provider API calls may incur charges.");
      return;
    }
    setRunning(true);
    setError("");
    setPages([]);
    setCompleted(0);
    setAnalysedDomain(host);
    setSavedId(null);
    setComparison([]);
    setComparisonDomain("");
    let complete = false;
    const collected: PageRow[] = [];
    const batchSize = limit <= 50 ? 50 : limit <= 100 ? 100 : 200;
    try {
      // Each batch is a separate Worker request. Never process 1,000 pages
      // in one Worker invocation or exceed the upstream page size limit.
      for (let offset = 0; offset < limit; offset += batchSize) {
        const response = await getDomainPagesPage({
          data: {
            projectId,
            domain: host,
            scope: "domain",
            locationCode: market,
            page: Math.floor(offset / batchSize) + 1,
            pageSize: batchSize,
            sortMode: "traffic",
            sortOrder: "desc",
            filters: {},
          },
        });
        collected.push(...response.pages.slice(0, limit - offset));
        setPages([...collected]);
        setCompleted(Math.min(limit, collected.length));
        if (!response.hasMore || response.pages.length === 0) break;
      }
      complete = true;
      if (collected.length === 0) toast.info("No ranking pages returned for this market.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Research request failed.");
    } finally {
      if (collected.length > 0) await storeSnapshot(host, collected, complete);
      setRunning(false);
    }
  }

  function exportCsv() {
    if (!pages.length) return;
    const blob = new Blob(["\uFEFF" + toCsv(pages)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = analysedDomain + "-topical-inventory.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-6 pb-24 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Competitor Topical Map"
          description="Discover competitor ranking pages and explore a preliminary topic map."
        />
        <Card className="space-y-4 p-5">
          <div className="space-y-1.5">
            <label htmlFor="competitor-domain" className="text-sm font-medium">Competitor website</label>
            <Input id="competitor-domain" value={domain} onChange={(event) => setDomain(event.target.value)}
              placeholder="competitor.com.au" disabled={running} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="competitor-market" className="text-sm font-medium">Country</label>
              <select id="competitor-market" value={market} disabled={running}
                onChange={(event) => setMarket(Number(event.target.value))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                {MARKETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="competitor-limit" className="text-sm font-medium">Pages to analyse</label>
              <select id="competitor-limit" value={limit} disabled={running}
                onChange={(event) => setLimit(Number(event.target.value))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                {LIMITS.map((value) => <option key={value} value={value}>{value} pages</option>)}
              </select>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            Uses your project's SEO data provider. Requests are made in batches of up to 200 pages.
            Provider costs vary and cannot be estimated accurately here. This version retrieves
            ranking-page records, not full page content or a verified semantic topical map.
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={acknowledged} disabled={running}
              onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
            I approve potentially chargeable SEO data requests for this analysis.
          </label>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button onClick={() => void analyse()} disabled={running || !domain.trim() || !acknowledged}>
            <Network className="size-4" />
            {running ? "Analysing…" : "Analyse Competitor"}
          </Button>
          {running && <p className="text-sm text-muted-foreground" role="status">Retrieved {completed} of up to {limit} pages. Each batch is requested separately.</p>}
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Saved research</h2>
          <p className="text-xs text-muted-foreground">Stored in your project's Cloudflare R2 storage. Opening saved research does not call the SEO provider.</p>
          {saved.length === 0 ? <p className="text-sm text-muted-foreground">No saved analyses yet.</p> : (
            <div className="space-y-2">
              {saved.map((record) => (
                <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm font-medium">{record.domain}</p>
                    <p className="text-xs text-muted-foreground">{record.pageCount} pages · {new Date(record.savedAt).toLocaleString()}{record.complete ? "" : " · Partial"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={running} onClick={() => void openSaved(record.id)}>Open</Button>
                    <Button size="sm" variant="ghost" disabled={running} onClick={() => void removeSaved(record.id)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        {analysedDomain && (pages.length > 0 || !running) && (
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{analysedDomain}</h2>
                <p className="text-sm text-muted-foreground">{pages.length} ranking pages · {groups.length} URL-based groups{saving ? " · Saving…" : savedId ? " · Saved" : ""}</p>
              </div>
              <Button variant="outline" disabled={!pages.length} onClick={exportCsv}><Download className="size-4" /> Export CSV</Button>
            </div>
            <p className="text-xs text-muted-foreground">Preliminary grouping based on URL paths. These groups are not validated topic clusters or inferred pillar pages. Full semantic extraction, saved resumable jobs and gap analysis are planned separately.</p>
            <div className="flex gap-2 border-b pb-2">
              <Button variant={selectedTab === "map" ? "secondary" : "ghost"} size="sm" onClick={() => setSelectedTab("map")}>Topical Map</Button>
              <Button variant={selectedTab === "pages" ? "secondary" : "ghost"} size="sm" onClick={() => setSelectedTab("pages")}>Pages</Button>
              <Button variant={selectedTab === "compare" ? "secondary" : "ghost"} size="sm" onClick={() => setSelectedTab("compare")}>Compare with My Site</Button>
            </div>
            {selectedTab === "compare" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Your project website: {mySite || "Not configured"}. Compare ranked pages for the same country and page limit. This is a URL-path grouping comparison, not yet a semantic content gap audit.</p>
                <Button disabled={!mySite || !pages.length || !acknowledged || comparing || running}
                  onClick={() => void compareWithMine()}>
                  {comparing ? "Comparing…" : "Compare with My Site"}
                </Button>
                {!acknowledged && <p className="text-xs text-muted-foreground">Approve potentially chargeable requests above before comparing.</p>}
                {comparisonError && <p role="alert" className="text-sm text-destructive">{comparisonError}</p>}
                {comparisonDomain && (
                  <>
                    <p className="text-sm">{comparisonDomain}: {comparison.length} ranked pages compared with {pages.length} competitor pages.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead><tr className="border-b"><th className="p-2">Competitor URL group</th><th className="p-2 text-right">Competitor pages</th><th className="p-2 text-right">My pages</th><th className="p-2">Preliminary status</th></tr></thead>
                        <tbody>{comparisonGroups.map((group) => (
                          <tr key={group.name} className="border-b">
                            <td className="p-2">{group.name}</td>
                            <td className="p-2 text-right">{group.rows.length}</td>
                            <td className="p-2 text-right">{group.ownPages.length}</td>
                            <td className="p-2">{group.ownPages.length ? "URL group overlap" : "Possible gap — verify manually"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground">Absence from the ranked-page sample does not prove a missing topic. Review your indexed pages and content before creating new URLs.</p>
                  </>
                )}
              </div>
            ) : selectedTab === "map" ? (
              <div className="space-y-2">
                {groups.map((group) => (
                  <div key={group.name} className="rounded-lg border">
                    <button type="button" onClick={() => setExpanded(expanded === group.name ? null : group.name)}
                      className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        {expanded === group.name ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        {group.name}
                      </span>
                      <span className="text-muted-foreground">{group.rows.length} pages</span>
                    </button>
                    {expanded === group.name && (
                      <div className="space-y-2 border-t p-3 pl-9">
                        {group.rows.map((row) => (
                          <a key={row.page} href={row.page} target="_blank" rel="noopener noreferrer"
                            className="block break-all text-sm text-primary hover:underline">{row.relativePath ?? row.page}</a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b"><th className="p-2">Page</th><th className="p-2">Group</th><th className="p-2 text-right">Traffic</th><th className="p-2 text-right">Keywords</th></tr></thead>
                  <tbody>{pages.map((row) => <tr className="border-b" key={row.page}>
                    <td className="p-2"><a className="break-all text-primary hover:underline" href={row.page} target="_blank" rel="noopener noreferrer">{row.relativePath ?? row.page}</a></td>
                    <td className="p-2">{clusterName(row.relativePath ?? new URL(row.page).pathname)}</td>
                    <td className="p-2 text-right">{row.organicTraffic?.toLocaleString() ?? "—"}</td>
                    <td className="p-2 text-right">{row.keywords?.toLocaleString() ?? "—"}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
