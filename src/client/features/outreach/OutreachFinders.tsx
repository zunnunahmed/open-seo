import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Textarea } from "@/client/components/ui/textarea";
import { DataSourceLabel } from "@/client/features/integrations/DataSourceLabel";
import {
  findGuestPostProspects,
  findLinkGapProspects,
  findPrProspects,
  importOutreachProspects,
} from "@/serverFunctions/outreach";

type Finder = "link_gap" | "guest_post" | "pr" | "import";

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
    placeholder: "web design\nsmall business marketing",
    help: 'Sites with "write for us", "guest post" or "contribute" pages for up to 5 topics: 3 paid Google searches per topic, in your project market.',
    action: "Find guest-post sites (paid)",
  },
  {
    value: "pr",
    label: "PR",
    placeholder: "small business websites\nAustralian startups",
    help: "Publications that recently covered up to 5 topics. Free news search through treg; contacts are found for their editors and reporters.",
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
  const current = FINDERS.find((entry) => entry.value === finder) ?? FINDERS[0];
  const lines = [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];

  async function run() {
    setRunning(true);
    setError("");
    try {
      const result =
        finder === "link_gap"
          ? await findLinkGapProspects({
              data: { projectId, competitors: lines.slice(0, 3) },
            })
          : finder === "guest_post"
            ? await findGuestPostProspects({
                data: { projectId, topics: lines.slice(0, 5) },
              })
            : finder === "pr"
              ? await findPrProspects({
                  data: { projectId, topics: lines.slice(0, 5) },
                })
              : await importOutreachProspects({
                  data: { projectId, domains: lines.slice(0, 500) },
                });
      toast.success(
        `${result.found.toLocaleString()} prospects found. Domains already in your list were kept as they were.`,
      );
      setText("");
      onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setRunning(false);
    }
  }

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
      <Textarea
        rows={4}
        value={text}
        placeholder={current.placeholder}
        onChange={(event) => setText(event.target.value)}
        aria-label={current.label}
      />
      <Button
        disabled={running || lines.length === 0}
        onClick={() => void run()}
      >
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
