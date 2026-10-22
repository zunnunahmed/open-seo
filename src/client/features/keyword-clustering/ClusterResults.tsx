import { useMemo, useState } from "react";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  clusterKeywords,
  type ClusterableKeyword,
  type ClusterMode,
  type ClusterPrimaryBy,
} from "@/shared/keywordClustering";
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

export function ClusterResults({
  name,
  items,
  failed,
  ownDomain,
}: {
  name: string;
  items: ClusterableKeyword[];
  failed: Array<{ keyword: string; error: string }>;
  ownDomain: string | null;
}) {
  const [threshold, setThreshold] = useState(4);
  const [mode, setMode] = useState<ClusterMode>("balanced");
  const [primaryBy, setPrimaryBy] = useState<ClusterPrimaryBy>("volume");
  const [competitorText, setCompetitorText] = useState("");

  const clusters = useMemo(
    () => clusterKeywords(items, { threshold, mode, primaryBy, ownDomain }),
    [items, threshold, mode, primaryBy, ownDomain],
  );
  const grouped = clusters.filter((c) => c.keywords.length > 1);
  const singles = clusters.filter((c) => c.keywords.length === 1);
  const competitors = competitorText
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
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Mode</span>
              <Select
                items={MODES.map((m) => ({ value: m.value, label: m.label }))}
                value={mode}
                onValueChange={(next) => {
                  if (next !== null && isMode(next)) setMode(next);
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
                  if (next !== null && isPrimaryBy(next)) setPrimaryBy(next);
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label="Rank clusters by"
                >
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
                value={competitorText}
                onChange={(e) => setCompetitorText(e.target.value)}
                placeholder="competitor.com, other.com.au"
              />
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
              onClick={() => exportClustersCsv(name, grouped)}
            >
              Export clusters CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => exportKeywordsCsv(name, clusters, failed)}
            >
              Export keywords CSV
            </Button>
          </div>
        </div>
      </CardShell>

      <ClusterTable
        // A new threshold or mode is a new list: start again on page 1.
        key={`${threshold}-${mode}`}
        clusters={grouped}
        ownDomain={ownDomain}
        competitors={competitors}
      />
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
