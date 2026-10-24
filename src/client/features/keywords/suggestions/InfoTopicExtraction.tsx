import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Papa from "papaparse";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { CountryCombobox } from "@/client/components/CountryCombobox";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getTopicalAiAnalysis,
  listCompetitorTopicalMaps,
} from "@/serverFunctions/competitorTopicalMap";
import { MAX_INFO_TOPICS } from "@/shared/infoTopics";
import { getLanguageCode, LOCATION_OPTIONS } from "@/shared/keyword-locations";
import { InfoTopicsResults } from "./InfoTopicsResults";
import { useInfoTopicRun } from "./useInfoTopicRun";

// DataForSEO prices: a top-10 SERP, and a page's 20 top keywords.
const SERP_USD = 0.002;
const PAGE_KEYWORDS_USD = 0.012 + 20 * 0.00012;
const UNGROUPED = "Other (not grouped by the model)";
/** Runs estimated above this ask for confirmation first. */
const CONFIRM_ABOVE_USD = 10;
const HEADER_CELL = /^(topics?|keywords?|quer(y|ies)|search terms?)$/i;

/** Topics from a CSV or TXT file: the first filled cell of each row. */
function TopicFileUpload({
  onTopics,
}: {
  onTopics: (topics: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Allow choosing the same file again.
          event.target.value = "";
          if (!file) return;
          Papa.parse<string[]>(file, {
            skipEmptyLines: true,
            complete: (result) => {
              const lines = result.data
                .map((row) => (row.find((cell) => cell.trim()) ?? "").trim())
                .filter(Boolean);
              if (HEADER_CELL.test(lines[0] ?? "")) lines.shift();
              onTopics(lines);
              toast.success(
                `${lines.length.toLocaleString("en-US")} topics read from ${file.name}.`,
              );
            },
          });
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => input.current?.click()}
      >
        <Upload className="size-4" />
        Upload CSV or TXT
      </Button>
    </>
  );
}

/** Load the AI topics of a saved Topical Map research into the list. */
function TopicalMapImport({
  projectId,
  onTopics,
}: {
  projectId: string;
  onTopics: (topics: string[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const maps = useQuery({
    queryKey: ["competitor-topical-maps", projectId],
    queryFn: () => listCompetitorTopicalMaps({ data: { projectId } }),
  });
  if (!maps.data?.length) return null;
  return (
    <select
      className="h-8 rounded-md border bg-background px-2 text-sm"
      value=""
      disabled={loading}
      aria-label="Import topics from Topical Map"
      onChange={async (event) => {
        const id = event.target.value;
        if (!id) return;
        setLoading(true);
        try {
          const analysis = await getTopicalAiAnalysis({
            data: { projectId, id },
          });
          const topics = (analysis?.clusters ?? [])
            .map((cluster) => cluster.name)
            .filter((name) => name !== UNGROUPED);
          if (topics.length === 0)
            toast.info(
              "This research has no AI topics yet. Run AI topic clustering in Topical Map first.",
            );
          else onTopics(topics);
        } finally {
          setLoading(false);
        }
      }}
    >
      <option value="">
        {loading ? "Loading topics…" : "Import AI topics from Topical Map…"}
      </option>
      {maps.data.map((map) => (
        <option key={map.id} value={map.id}>
          {map.domain} · {new Date(map.savedAt).toLocaleDateString()}
        </option>
      ))}
    </select>
  );
}

/**
 * Suggestions → Info topics: for each topic, the searched keyword that best
 * represents it, from what Google's top pages rank for. Runs save themselves
 * as they go and can resume from Saved results.
 */
export function InfoTopicExtraction({
  projectId,
  modeButtons,
  hideResults = false,
}: {
  projectId: string;
  modeButtons: ReactNode;
  /** A saved run is open below; its table replaces this one. */
  hideResults?: boolean;
}) {
  const projectsQuery = useQuery(projectsQueryOptions());
  const project = projectsQuery.data?.find((p) => p.id === projectId);
  const [pickedCountry, setPickedCountry] = useState<number | null>(null);
  const country = pickedCountry ?? project?.locationCode ?? null;
  const countryName =
    LOCATION_OPTIONS.find((option) => option.code === country)?.label ?? "";
  const [text, setText] = useState("");
  const [acceptExisting, setAcceptExisting] = useState(true);
  const [useAi, setUseAi] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [startError, setStartError] = useState("");
  const run = useInfoTopicRun(projectId);

  const allTopics = [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length >= 2 && line.length <= 120),
    ),
  ];
  const topics = allTopics.slice(0, MAX_INFO_TOPICS);
  const typicalUsd = topics.length * (SERP_USD + PAGE_KEYWORDS_USD);
  const maxUsd = topics.length * (SERP_USD + 3 * PAGE_KEYWORDS_USD);
  const addTopics = (added: string[]) =>
    setText((current) => [current.trim(), ...added].filter(Boolean).join("\n"));

  async function start() {
    if (!country) return;
    setConfirming(false);
    setStartError("");
    try {
      await run.start({
        topics,
        countryName,
        settings: {
          locationCode: country,
          languageCode: getLanguageCode(country),
          acceptExisting,
          useAi,
        },
      });
    } catch (cause) {
      setStartError(getStandardErrorMessage(cause, "Could not start the run."));
    }
  }

  const error = startError || run.error;
  return (
    <>
      <Card className="overflow-visible">
        <CardContent className="flex flex-col gap-4">
          {modeButtons}
          <p className="text-sm text-muted-foreground">
            For each topic, find the real search keyword that represents it:
            Google’s top 3 results are checked one by one, and the first page
            ranking for a matching keyword wins. Topics that are already
            searched keywords are taken as they are. Runs save themselves every
            100 topics; an interrupted run resumes from Saved results.
          </p>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="info-topics">
                Topics (one per line, up to{" "}
                {MAX_INFO_TOPICS.toLocaleString("en-US")})
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <TopicalMapImport projectId={projectId} onTopics={addTopics} />
                <TopicFileUpload onTopics={addTopics} />
                {text ? (
                  <Button size="sm" variant="ghost" onClick={() => setText("")}>
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
            <Textarea
              id="info-topics"
              rows={6}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"carpal tunnel exercises\nwrist pain at night"}
            />
            <p className="text-xs text-muted-foreground">
              {topics.length.toLocaleString("en-US")} unique{" "}
              {topics.length === 1 ? "topic" : "topics"}
              {allTopics.length > MAX_INFO_TOPICS ? (
                <span className="text-destructive">
                  {" "}
                  · only the first {MAX_INFO_TOPICS.toLocaleString(
                    "en-US",
                  )} of {allTopics.length.toLocaleString("en-US")} are used
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            {country ? (
              <div className="flex items-center gap-2">
                <span className="font-medium">Country</span>
                <div className="w-56">
                  <CountryCombobox
                    value={country}
                    onChange={setPickedCountry}
                  />
                </div>
              </div>
            ) : null}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={acceptExisting}
                onCheckedChange={(checked) => setAcceptExisting(checked)}
              />
              Accept topics that already have search volume
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={useAi}
                onCheckedChange={(checked) => setUseAi(checked)}
              />
              AI check when no words match
            </label>
          </div>
          {topics.length ? (
            <p className="text-sm">
              Estimated DataForSEO cost:{" "}
              <strong>about US${typicalUsd.toFixed(2)}</strong>, at most US$
              {maxUsd.toFixed(2)}.{" "}
              <span className="text-muted-foreground">
                Less when topics are already keywords or pages repeat (their
                keywords are reused for 28 days).
              </span>
            </p>
          ) : null}
          {confirming ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <span>
                This run of {topics.length.toLocaleString("en-US")} topics may
                cost about US${typicalUsd.toFixed(2)} (up to US$
                {maxUsd.toFixed(2)}). Start it?
              </span>
              <Button size="sm" onClick={() => void start()}>
                Start run
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  topics.length === 0 || !country || run.progress !== null
                }
                onClick={() => {
                  if (typicalUsd > CONFIRM_ABOVE_USD) setConfirming(true);
                  else void start();
                }}
              >
                {run.progress
                  ? `Extracting… ${run.progress.done.toLocaleString("en-US")}/${run.progress.total.toLocaleString("en-US")}`
                  : `Extract info topics (${topics.length.toLocaleString("en-US")})`}
              </Button>
              {run.progress ? (
                <Button variant="ghost" onClick={run.stop}>
                  Stop
                </Button>
              ) : null}
              {run.progress ? (
                <span className="text-xs text-muted-foreground">
                  Saved every 100 topics under Saved results. Keep this tab
                  open; if it closes, open the run there and resume.
                </span>
              ) : null}
            </div>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
      {run.rows.length && !hideResults ? (
        <InfoTopicsResults rows={run.rows} countryName={countryName} />
      ) : null}
    </>
  );
}
