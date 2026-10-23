import { useEffect, useMemo, useRef, useState } from "react";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { saveClusterJobSettings } from "@/serverFunctions/keywordClustering";
import {
  clusterKeywords,
  DEFAULT_CLUSTER_SETTINGS,
  type ClusterableKeyword,
  type ClusterMode,
  type ClusterPrimaryBy,
  type ClusterSettings,
} from "@/shared/keywordClustering";
import { groupTopicHubs } from "@/shared/keywordClusterHubs";
import { exportClustersCsv, exportKeywordsCsv } from "./clusterExports";
import { ClusterTable } from "./ClusterTable";

const MODES: Array<{ value: ClusterMode; label: string }> = [
  { value: "balanced", label: "Balanced (recommended)" },
  { value: "strict", label: "Strict: every keyword matches every other" },
  { value: "soft", label: "Soft: matches the main keyword" },
];
const isMode = (value: string): value is ClusterMode =>
  MODES.some((m) => m.value === value);
const isPrimaryBy = (value: string): value is ClusterPrimaryBy =>
  value === "volume" || value === "cpc";

/** Save settings a second after the last change, so a reopened run matches. */
function useSavedSettings(
  projectId: string,
  jobId: string,
  saved: ClusterSettings | null,
) {
  const [settings, setSettings] = useState<ClusterSettings>(
    saved ?? DEFAULT_CLUSTER_SETTINGS,
  );
  const lastSaved = useRef(JSON.stringify(settings));
  useEffect(() => {
    const json = JSON.stringify(settings);
    if (json === lastSaved.current) return;
    const timer = setTimeout(() => {
      lastSaved.current = json;
      void saveClusterJobSettings({ data: { projectId, jobId, settings } });
    }, 1000);
    return () => clearTimeout(timer);
  }, [projectId, jobId, settings]);
  const update = (patch: Partial<ClusterSettings>) =>
    setSettings((current) => ({ ...current, ...patch }));
  return [settings, update] as const;
}

export function ClusterResults({
  projectId,
  jobId,
  savedSettings,
  name,
  items,
  failed,
  ownDomain,
}: {
  projectId: string;
  jobId: string;
  savedSettings: ClusterSettings | null;
  name: string;
  items: ClusterableKeyword[];
  failed: Array<{ keyword: string; error: string }>;
  ownDomain: string | null;
}) {
  const [settings, update] = useSavedSettings(projectId, jobId, savedSettings);
  const { threshold, mode, primaryBy, ignorePlatforms, weightTop } = settings;

  const clusters = useMemo(
    () =>
      clusterKeywords(items, {
        threshold,
        mode,
        primaryBy,
        ownDomain,
        ignorePlatforms,
        weightTop,
      }),
    [items, threshold, mode, primaryBy, ownDomain, ignorePlatforms, weightTop],
  );
  const grouped = clusters.filter((c) => c.keywords.length > 1);
  const singles = clusters.filter((c) => c.keywords.length === 1);
  const { hubs, hubOf } = useMemo(() => {
    const found = groupTopicHubs(
      clusters.filter((c) => c.keywords.length > 1),
      { ignorePlatforms },
    );
    const byCluster = new Map<number, string>();
    for (const hub of found)
      for (const id of hub.clusterIds) byCluster.set(id, hub.name);
    return { hubs: found, hubOf: byCluster };
  }, [clusters, ignorePlatforms]);
  const competitors = settings.competitors
    .split(/[\s,]+/)
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^www\./, ""),
    )
    .filter(Boolean);
  const cannibalized = grouped.filter((c) => c.ownUrls.length > 1).length;

  return (
    <div className="space-y-4">
      <CardShell title={name}>
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1">
              <span className="font-medium">
                Shared URLs needed: {threshold}
              </span>
              <input
                type="range"
                min={2}
                max={6}
                value={threshold}
                onChange={(e) => update({ threshold: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Mode</span>
              <Select
                items={MODES.map((m) => ({ value: m.value, label: m.label }))}
                value={mode}
                onValueChange={(next) => {
                  if (next !== null && isMode(next)) update({ mode: next });
                }}
              >
                <SelectTrigger className="w-full" aria-label="Cluster mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">Main keyword by</span>
              <Select
                items={[
                  { value: "volume", label: "Search volume (SEO)" },
                  { value: "cpc", label: "CPC (paid search)" },
                ]}
                value={primaryBy}
                onValueChange={(next) => {
                  if (next !== null && isPrimaryBy(next))
                    update({ primaryBy: next });
                }}
              >
                <SelectTrigger className="w-full" aria-label="Rank clusters by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="volume">Search volume (SEO)</SelectItem>
                  <SelectItem value="cpc">CPC (paid search)</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">Compare competitors</span>
              <Input
                value={settings.competitors}
                maxLength={1000}
                onChange={(e) => update({ competitors: e.target.value })}
                placeholder="competitor.com, other.com.au"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={ignorePlatforms}
                onCheckedChange={(checked) =>
                  update({ ignorePlatforms: checked })
                }
              />
              Ignore directories &amp; social sites (Clutch, Yelp, Facebook…)
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={weightTop}
                onCheckedChange={(checked) => update({ weightTop: checked })}
              />
              Weight top results (a shared #1–3 counts more than #7–10)
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Clusters (2+ keywords)", grouped.length],
              [
                "Keywords in clusters",
                grouped.reduce((s, c) => s + c.keywords.length, 0),
              ],
              ["Unclustered keywords", singles.length],
              ownDomain
                ? ["Clusters with 2+ of your pages", cannibalized]
                : ["Keywords without results", failed.length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <div className="text-2xl font-semibold tabular-nums">
                  {Number(value).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => exportClustersCsv(name, grouped, hubOf)}
            >
              Export clusters CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => exportKeywordsCsv(name, clusters, failed, hubOf)}
            >
              Export keywords CSV
            </Button>
          </div>
        </div>
      </CardShell>

      <ClusterTable
        // A new threshold or mode is a new list: start again on page 1.
        key={JSON.stringify([threshold, mode, ignorePlatforms, weightTop])}
        clusters={grouped}
        hubOf={hubOf}
        ownDomain={ownDomain}
        competitors={competitors}
      />
      {hubs.length ? <TopicHubs hubs={hubs} /> : null}
      {singles.length ? (
        <CardShell
          title={`Unclustered keywords (${singles.length.toLocaleString()})`}
        >
          <p className="mb-2 text-sm text-muted-foreground">
            These share fewer than {threshold} top-10 URLs with any cluster.
            Each may need its own page, or a lower threshold.
          </p>
          <p className="text-xs leading-relaxed">
            {singles
              .slice(0, 300)
              .map((c) => c.main.keyword)
              .join(" · ")}
            {singles.length > 300 ? " …" : ""}
          </p>
        </CardShell>
      ) : null}
    </div>
  );
}

/** Clusters whose ranking pages overlap: one pillar topic, several pages. */
function TopicHubs({ hubs }: { hubs: ReturnType<typeof groupTopicHubs> }) {
  return (
    <CardShell title={`Topic hubs (${hubs.length.toLocaleString()})`}>
      <p className="mb-3 text-sm text-muted-foreground">
        Each hub groups clusters that Google answers with many of the same
        sites. Build one pillar page for the hub and link it to a page per
        cluster.
      </p>
      <ul className="grid gap-2 text-sm md:grid-cols-2">
        {hubs.slice(0, 40).map((hub) => (
          <li
            key={hub.id}
            className="flex justify-between gap-3 rounded-md border px-3 py-2"
          >
            <span className="font-medium">{hub.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {hub.clusterIds.length} clusters ·{" "}
              {hub.totalVolume.toLocaleString()} vol
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
