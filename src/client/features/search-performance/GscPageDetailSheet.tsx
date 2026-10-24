import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { sort } from "remeda";
import { Button } from "@/client/components/ui/button";
import { useKeywordSerpAnalysis } from "@/client/features/keywords/hooks/useKeywordSerpAnalysis";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
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
import { GscPageSerp } from "./GscPageSerp";
import { buildPageReport } from "./gscPageReport";

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

/** Copy the page report for ChatGPT, optionally opening ChatGPT too. */
async function copyReport(report: string, openChatGpt: boolean) {
  // Open first: browsers only allow a new tab straight from the click.
  const tab = openChatGpt
    ? window.open("https://chatgpt.com/", "_blank")
    : null;
  try {
    await navigator.clipboard.writeText(report);
    toast.success(
      openChatGpt
        ? "Report copied. Paste it into ChatGPT (Ctrl+V) and send."
        : "Report copied. Paste it into ChatGPT or any AI assistant.",
    );
  } catch {
    tab?.close();
    toast.error("Could not copy the report. Allow clipboard access and retry.");
  }
}

function DetailBody({
  projectId,
  detail,
  page,
}: {
  projectId: string;
  detail: Detail;
  page: string;
}) {
  const market = useProjectMarket(projectId);
  const serp = useKeywordSerpAnalysis(
    projectId,
    market?.locationCode,
    undefined,
  );
  const ranked = sort(
    detail.queries,
    (a, b) => b.clicks - a.clicks || b.impressions - a.impressions,
  ).map((row) => row.query);
  const [selected, setSelected] = useState(ranked[0] ?? "");
  const serpSection = useRef<HTMLDivElement>(null);
  const checkSerp = (query: string) => {
    setSelected(query);
    serp.setSerpKeyword(query);
    serpSection.current?.scrollIntoView({ behavior: "smooth" });
  };
  const report = () =>
    buildPageReport(
      page,
      detail,
      serp.activeSerpKeyword && serp.serpResults.length
        ? { keyword: serp.activeSerpKeyword, items: serp.serpResults }
        : null,
    );
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
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
        <span className="mr-auto text-sm">
          Get an AI analysis: everything on this panel, ready for ChatGPT
          {serp.serpResults.length ? ", including the live SERP" : ""}.
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyReport(report(), false)}
        >
          <Copy className="size-4" />
          Copy for ChatGPT
        </Button>
        <Button size="sm" onClick={() => void copyReport(report(), true)}>
          <MessageSquare className="size-4" />
          Open in ChatGPT
        </Button>
      </div>
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
      <div ref={serpSection} className="scroll-mt-4">
        <Section
          title="Live Google SERP"
          note="Today’s Google results for one of this page’s queries: where the page ranks and who is above it."
        >
          <GscPageSerp
            page={page}
            queries={ranked}
            selected={selected}
            onSelect={setSelected}
            serp={serp}
          />
        </Section>
      </div>
      <Section
        title={`All ${formatCount(detail.queryCount)} queries`}
        note="Every search this page appeared for in the selected range. Click a query to check its live SERP."
      >
        <GscPageQueries
          page={page}
          queries={detail.queries}
          onCheckSerp={checkSerp}
        />
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
            <DetailBody projectId={projectId} detail={query.data} page={page} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
