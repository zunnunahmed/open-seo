import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Textarea } from "@/client/components/ui/textarea";
import { DataSourceLabel } from "@/client/features/integrations/DataSourceLabel";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { guestPostQueries } from "@/shared/outreachFootprints";
import { importOutreachProspects } from "@/serverFunctions/outreach";
import {
  findGuestPostProspects,
  findLinkGapProspects,
  findPrProspects,
  findSearchProspects,
} from "@/serverFunctions/outreachFinders";
import { SearchOptions, useSearchOptions } from "./OutreachSearchOptions";

type Finder = "link_gap" | "guest_post" | "search" | "pr" | "import";

const FINDERS: Array<{
  value: Finder;
  label: string;
  placeholder: string;
  help: string;
  action: string;
}> = [
  {
    value: "link_gap",
    label: "Competitor link gap",
    placeholder: "competitor1.com.au\ncompetitor2.com.au",
    help: "Sites linking to up to 3 competitors but not to your site. Uses your Backlinks data source (paid per competitor).",
    action: "Find link-gap sites (paid)",
  },
  {
    value: "guest_post",
    label: "Guest posts",
    placeholder: "marketing automation\nAI for small business",
    help: "Sites inviting guest posts on up to 5 topics: one paid Google search per topic and phrase (up to 20), plus about US$0.03 to rate every site’s authority. Articles about guest posting and sites above your maximum authority are left out.",
    action: "Find guest-post sites (paid)",
  },
  {
    value: "search",
    label: "Google search",
    placeholder: "small business\nmarketing agency sydney",
    help: "Every website ranking in Google for up to 5 searches, as leads: up to 100 results per search (one paid search each), rated for authority. Platforms, government and giant sites are left out.",
    action: "Add websites from Google (paid)",
  },
  {
    value: "pr",
    label: "PR",
    placeholder: "small business websites\nAustralian startups",
    help: "News sites in the country you pick that covered up to 5 topics in the last year, including articles quoting experts (the likeliest to quote you). Free news search through treg, plus about US$0.03 to rate each site’s authority; press-release wires are skipped.",
    action: "Find publications (free)",
  },
  {
    value: "import",
    label: "Import",
    placeholder: "site1.com\nhttps://www.site2.com.au/",
    help: "Paste up to 500 domains or URLs, one per line.",
    action: "Add prospects",
  },
];

/** " site:.au" or " (site:.au OR site:.nz)", as the server adds it. */
function siteRestriction(endings: string[]): string {
  const sites = endings.map((ending) => `site:.${ending}`);
  if (sites.length === 0) return "";
  return sites.length === 1 ? ` ${sites[0]}` : ` (${sites.join(" OR ")})`;
}

/** Step 1: add prospects to the project's outreach list. */
export function OutreachFinders({
  projectId,
  onAdded,
}: {
  projectId: string;
  onAdded: () => void;
}) {
  const [finder, setFinder] = useState<Finder>("link_gap");
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const projectsQuery = useQuery(projectsQueryOptions());
  const project = projectsQuery.data?.find((p) => p.id === projectId);
  const options = useSearchOptions(project?.locationCode ?? null);
  const current = FINDERS.find((entry) => entry.value === finder) ?? FINDERS[0];
  const lines = [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  const topics = lines.slice(0, 5);
  const restrict = siteRestriction(options.request().endings);
  const guestQueries =
    finder === "guest_post"
      ? guestPostQueries(
          topics,
          options.footprints,
          options.customFootprint,
        ).map((query) => `${query}${restrict}`)
      : [];

  async function find() {
    if (finder === "link_gap")
      return findLinkGapProspects({
        data: { projectId, competitors: lines.slice(0, 3) },
      });
    if (finder === "guest_post")
      return findGuestPostProspects({
        data: {
          projectId,
          topics,
          ...options.request(),
          footprints: options.footprints,
          customFootprint: options.customFootprint,
        },
      });
    if (finder === "search")
      return findSearchProspects({
        data: {
          projectId,
          topics,
          ...options.request(),
          depth: options.depth,
        },
      });
    if (finder === "pr")
      return findPrProspects({
        data: { projectId, topics, ...options.request() },
      });
    return importOutreachProspects({
      data: { projectId, domains: lines.slice(0, 500) },
    });
  }

  async function run() {
    setRunning(true);
    setError("");
    try {
      const result = await find();
      if ("error" in result && typeof result.error === "string") {
        setError(result.error);
        return;
      }
      toast.success(
        `${result.found.toLocaleString()} prospects found. Domains already in your list were kept as they were.`,
      );
      setText("");
      onAdded();
    } catch (cause) {
      setError(getStandardErrorMessage(cause, "Search failed. Try again."));
    } finally {
      setRunning(false);
    }
  }

  const blocked =
    lines.length === 0 ||
    (finder === "guest_post" && guestQueries.length === 0);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">1. Find prospects</h2>
        <DataSourceLabel projectId={projectId} />
      </div>
      <div className="flex flex-wrap gap-2">
        {FINDERS.map((entry) => (
          <Button
            key={entry.value}
            size="sm"
            variant={entry.value === finder ? "default" : "outline"}
            onClick={() => {
              setFinder(entry.value);
              setError("");
            }}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{current.help}</p>
      {finder === "guest_post" || finder === "search" || finder === "pr" ? (
        <SearchOptions options={options} kind={finder} queries={guestQueries} />
      ) : null}
      <Textarea
        rows={4}
        value={text}
        placeholder={current.placeholder}
        onChange={(event) => setText(event.target.value)}
        aria-label={current.label}
      />
      <Button disabled={running || blocked} onClick={() => void run()}>
        {running ? "Searching…" : current.action}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
