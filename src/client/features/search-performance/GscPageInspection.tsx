import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  XCircle,
} from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import type { getGscPageDetail } from "@/serverFunctions/gscPageDetail";
import { safeHttpUrl } from "@/shared/safe-url";
import { formatCount } from "./SearchPerformanceColumns";

type Detail = Extract<
  Awaited<ReturnType<typeof getGscPageDetail>>,
  { connected: true }
>;
type Inspection = NonNullable<Detail["inspection"]>;
type Tone = "good" | "warn" | "bad";

/** GSC's enum values, readable: "INDEXING_ALLOWED" → "Indexing allowed". */
const readable = (value: string | undefined) =>
  value
    ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ")
    : "-";

const path = (url: string | undefined) => {
  if (!url) return "-";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

const TONE = {
  good: {
    icon: CheckCircle2,
    box: "border-success/30 bg-success/5",
    text: "text-success",
  },
  warn: {
    icon: AlertTriangle,
    box: "border-warning/40 bg-warning/10",
    text: "text-warning-foreground dark:text-warning",
  },
  bad: {
    icon: XCircle,
    box: "border-destructive/30 bg-destructive/5",
    text: "text-destructive",
  },
} as const;

function StatusTile({
  tone,
  label,
  value,
  hint,
}: {
  tone: Tone;
  label: string;
  value: string;
  hint?: string;
}) {
  const style = TONE[tone];
  const Icon = style.icon;
  return (
    <div className={`rounded-lg border p-3 ${style.box}`} title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 flex items-center gap-1.5 font-semibold ${style.text}`}
      >
        <Icon className="size-4 shrink-0" />
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** Four checks that answer "is this page healthy in Google?" at a glance. */
export function InspectionStatus({ inspection }: { inspection: Inspection }) {
  if (!inspection.result)
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        URL Inspection failed: {inspection.error ?? "no result"}. Google allows
        2,000 inspections a day per property; the query data below is
        unaffected.
      </div>
    );
  const index = inspection.result.indexStatusResult ?? {};
  const indexed = index.verdict === "PASS";
  const canonicalDiffers =
    Boolean(index.googleCanonical && index.userCanonical) &&
    index.googleCanonical !== index.userCanonical;
  const inSitemap = (index.sitemap?.length ?? 0) > 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatusTile
        tone={indexed ? "good" : index.verdict === "FAIL" ? "bad" : "warn"}
        label="Google index"
        value={indexed ? "Indexed" : "Not indexed"}
        hint={index.coverageState}
      />
      <StatusTile
        tone={
          !index.lastCrawlTime
            ? "bad"
            : Date.now() - Date.parse(index.lastCrawlTime) > 60 * 86_400_000
              ? "warn"
              : "good"
        }
        label="Last crawled"
        value={index.lastCrawlTime ? ago(index.lastCrawlTime) : "Never"}
        hint={
          index.lastCrawlTime
            ? `${new Date(index.lastCrawlTime).toLocaleDateString()} · ${readable(index.crawledAs)}`
            : undefined
        }
      />
      <StatusTile
        tone={canonicalDiffers ? "bad" : "good"}
        label="Canonical"
        value={canonicalDiffers ? "Google picked another" : "Matches"}
        hint={
          canonicalDiffers
            ? `Google uses ${path(index.googleCanonical)}`
            : path(index.googleCanonical ?? index.userCanonical)
        }
      />
      <StatusTile
        tone={inSitemap ? "good" : "warn"}
        label="Sitemap"
        value={inSitemap ? "Listed" : "Not in any sitemap"}
        hint={
          inSitemap
            ? (index.sitemap ?? []).map(path).join(", ")
            : "Add it to help Google recrawl it"
        }
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-3 border-b py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The full inspection, folded away: for when a check above needs a look. */
export function InspectionDetails({ inspection }: { inspection: Inspection }) {
  if (!inspection.result) return null;
  const index = inspection.result.indexStatusResult ?? {};
  const mobile = inspection.result.mobileUsabilityResult?.verdict;
  const rich = inspection.result.richResultsResult?.verdict;
  const link = safeHttpUrl(inspection.result.inspectionResultLink ?? "");
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Technical inspection details
      </summary>
      <dl className="px-4 pb-3 text-sm">
        <Row label="Coverage">{index.coverageState ?? "-"}</Row>
        <Row label="Indexing">{readable(index.indexingState)}</Row>
        <Row label="Robots.txt">{readable(index.robotsTxtState)}</Row>
        <Row label="Page fetch">{readable(index.pageFetchState)}</Row>
        <Row label="Last crawl">
          {index.lastCrawlTime
            ? new Date(index.lastCrawlTime).toLocaleString()
            : "Never"}{" "}
          {index.crawledAs ? `(${readable(index.crawledAs)})` : ""}
        </Row>
        <Row label="Google-selected canonical">
          {index.googleCanonical ?? "-"}
        </Row>
        <Row label="Your canonical">{index.userCanonical ?? "-"}</Row>
        <Row label="Rich results">
          {rich && rich !== "VERDICT_UNSPECIFIED" ? (
            <Badge variant={rich === "PASS" ? "success" : "warning"}>
              {readable(rich)}
            </Badge>
          ) : (
            "None detected"
          )}
        </Row>
        <Row label="Mobile usability">
          {mobile && mobile !== "VERDICT_UNSPECIFIED"
            ? readable(mobile)
            : "Not reported (Google retired this report in 2023)"}
        </Row>
        <Row label="Referring pages Google knows">
          {formatCount(index.referringUrls?.length ?? 0)}
        </Row>
      </dl>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="mx-4 mb-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open in Search Console <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </details>
  );
}
