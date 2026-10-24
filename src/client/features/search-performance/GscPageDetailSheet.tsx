import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
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
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "./SearchPerformanceColumns";
import { GscPageQueries } from "./GscPageQueries";
import { GscPageQueryChart } from "./GscPageQueryChart";
import { InspectionDetails, InspectionStatus } from "./GscPageInspection";

type Detail = Extract<
  Awaited<ReturnType<typeof getGscPageDetail>>,
  { connected: true }
>;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function DetailBody({ detail, page }: { detail: Detail; page: string }) {
  const clicks = detail.queries.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = detail.queries.reduce(
    (sum, row) => sum + row.impressions,
    0,
  );
  // Impression-weighted, as Search Console averages position.
  const position =
    impressions > 0
      ? detail.queries.reduce(
          (sum, row) => sum + row.position * row.impressions,
          0,
        ) / impressions
      : 0;
  return (
    <div className="space-y-8">
      <Section title="Health in Google" note="From Google’s URL Inspection.">
        {detail.inspection ? (
          <InspectionStatus inspection={detail.inspection} />
        ) : (
          <p className="text-sm text-muted-foreground">No inspection result.</p>
        )}
      </Section>
      <Section
        title="Search performance"
        note={`${detail.range.startDate} to ${detail.range.endDate}, with the report’s device and country filters.`}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Metric
            label="Queries"
            value={`${formatCount(detail.queryCount)}${detail.queriesCapped ? "+" : ""}`}
          />
          <Metric label="Clicks" value={formatCount(clicks)} />
          <Metric label="Impressions" value={formatCount(impressions)} />
          <Metric
            label="CTR"
            value={formatCtr(impressions ? clicks / impressions : 0)}
          />
          <Metric label="Avg. position" value={formatPosition(position)} />
        </div>
      </Section>
      <Section
        title="Queries per month"
        note="How many different searches Google showed this page for, over the last 12 months."
      >
        <GscPageQueryChart months={detail.months} />
      </Section>
      <Section
        title={`All ${formatCount(detail.queryCount)} queries`}
        note="Every search this page appeared for in the selected range."
      >
        <GscPageQueries page={page} queries={detail.queries} />
      </Section>
      {detail.inspection ? (
        <InspectionDetails inspection={detail.inspection} />
      ) : null}
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
  const href = page ? safeHttpUrl(page) : null;
  return (
    <Sheet open={page !== null} onOpenChange={(open) => !open && onClose()}>
      {/* The base Sheet caps side panels at sm:max-w-sm; this one needs room. */}
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-5xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Page details</SheetTitle>
          <SheetDescription className="break-all">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {page}
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            ) : (
              page
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="px-6 pb-8">
          {query.isPending ? (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-72 w-full" />
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
