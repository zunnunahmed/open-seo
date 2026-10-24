import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { Skeleton } from "@/client/components/ui/skeleton";
import { QueryError } from "@/client/components/QueryState";
import { getGscPageDetail } from "@/serverFunctions/gscPageDetail";
import { safeHttpUrl } from "@/shared/safe-url";
import type { FilterInput } from "./searchPerformanceQueries";
import { formatCount } from "./SearchPerformanceColumns";
import { GscPageQueries } from "./GscPageQueries";
import { GscPageQueryChart } from "./GscPageQueryChart";

type Detail = Extract<
  Awaited<ReturnType<typeof getGscPageDetail>>,
  { connected: true }
>;
type Inspection = NonNullable<Detail["inspection"]>;

const VERDICT_VARIANT: Record<string, "success" | "destructive" | "warning"> = {
  PASS: "success",
  FAIL: "destructive",
  NEUTRAL: "warning",
  PARTIAL: "warning",
};

/** GSC's enum values, readable: "INDEXING_ALLOWED" → "Indexing allowed". */
const readable = (value: string | undefined) =>
  value
    ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ")
    : "-";

function Verdict({ value }: { value: string | undefined }) {
  if (!value) return <span>-</span>;
  return (
    <Badge variant={VERDICT_VARIANT[value] ?? "secondary"}>
      {readable(value)}
    </Badge>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

function InspectionSection({ inspection }: { inspection: Inspection }) {
  if (!inspection.result)
    return (
      <p className="text-sm text-destructive">
        URL Inspection failed: {inspection.error ?? "no result"}. Google allows
        2,000 inspections a day per property.
      </p>
    );
  const index = inspection.result.indexStatusResult ?? {};
  const canonicalDiffers =
    index.googleCanonical &&
    index.userCanonical &&
    index.googleCanonical !== index.userCanonical;
  const link = safeHttpUrl(inspection.result.inspectionResultLink ?? "");
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="Index verdict">
          <Verdict value={index.verdict} />
        </Field>
        <Field label="Coverage">{index.coverageState ?? "-"}</Field>
        <Field label="Indexing">{readable(index.indexingState)}</Field>
        <Field label="Robots.txt">{readable(index.robotsTxtState)}</Field>
        <Field label="Page fetch">{readable(index.pageFetchState)}</Field>
        <Field label="Last crawl">
          {index.lastCrawlTime
            ? new Date(index.lastCrawlTime).toLocaleString()
            : "Never"}
          {index.crawledAs ? ` · ${readable(index.crawledAs)}` : ""}
        </Field>
        <Field label="Google-selected canonical">
          {index.googleCanonical ?? "-"}
        </Field>
        <Field label="Your canonical">
          {index.userCanonical ?? "-"}
          {canonicalDiffers ? (
            <span className="block text-xs text-destructive">
              Google chose a different canonical.
            </span>
          ) : null}
        </Field>
        <Field label="Mobile usability">
          <Verdict value={inspection.result.mobileUsabilityResult?.verdict} />
        </Field>
        <Field label="Rich results">
          <Verdict value={inspection.result.richResultsResult?.verdict} />
        </Field>
        <Field label="In sitemaps">
          {index.sitemap?.length ? index.sitemap.join(", ") : "None found"}
        </Field>
        <Field label="Referring pages Google knows">
          {formatCount(index.referringUrls?.length ?? 0)}
        </Field>
      </dl>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open in Search Console <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function DetailBody({ detail, page }: { detail: Detail; page: string }) {
  const clicks = detail.queries.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = detail.queries.reduce(
    (sum, row) => sum + row.impressions,
    0,
  );
  return (
    <div className="space-y-6">
      <Section title="URL Inspection">
        {detail.inspection ? (
          <InspectionSection inspection={detail.inspection} />
        ) : (
          <p className="text-sm text-muted-foreground">No inspection result.</p>
        )}
      </Section>
      <Section title="Queries">
        <div className="grid grid-cols-3 gap-3">
          {[
            [
              "Queries Google showed it for",
              `${formatCount(detail.queryCount)}${detail.queriesCapped ? "+" : ""}`,
            ],
            ["Clicks from them", formatCount(clicks)],
            ["Impressions", formatCount(impressions)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border p-3">
              <div className="text-2xl font-semibold tabular-nums">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {detail.range.startDate} to {detail.range.endDate}, with the report’s
          device and country filters.
        </p>
      </Section>
      <Section title="Query count, last 12 months">
        <GscPageQueryChart months={detail.months} />
      </Section>
      <Section title="All queries">
        <GscPageQueries page={page} queries={detail.queries} />
      </Section>
    </div>
  );
}

/** A page's Search Console details, opened from the Pages table. */
export function GscPageDetailSheet({
  projectId,
  page,
  filterInput,
  onClose,
}: {
  projectId: string;
  page: string | null;
  filterInput: FilterInput;
  onClose: () => void;
}) {
  const { dateRange, device, country } = filterInput;
  const query = useQuery({
    queryKey: ["gscPageDetail", projectId, page, dateRange, device, country],
    enabled: page !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      getGscPageDetail({
        data: { projectId, page: page ?? "", dateRange, device, country },
      }),
  });
  return (
    <Sheet open={page !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Page details</SheetTitle>
          <SheetDescription className="break-all">
            {page ? (
              <a
                href={safeHttpUrl(page) ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {page}
              </a>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {query.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : query.isError ? (
            <QueryError
              error={query.error}
              fallback="Failed to load this page's Search Console data"
              onRetry={() => void query.refetch()}
              isRetrying={query.isFetching}
            />
          ) : !query.data.connected ? (
            <p className="text-sm text-muted-foreground">
              Search Console is not connected for this project.
            </p>
          ) : page ? (
            <DetailBody detail={query.data} page={page} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
