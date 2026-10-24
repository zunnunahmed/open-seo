import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { extractInfoTopicsBatch } from "@/serverFunctions/infoTopics";
import {
  INFO_TOPIC_BATCH,
  MAX_INFO_TOPICS,
  type InfoTopicRow,
} from "@/shared/infoTopics";
import { getLanguageCode, LOCATION_OPTIONS } from "@/shared/keyword-locations";
import { InfoTopicsResults } from "./InfoTopicsResults";
import { useSaveSuggestionRun } from "./SavedSuggestionRuns";

// DataForSEO prices: a top-10 SERP, and a page's 20 top keywords.
const SERP_USD = 0.002;
const PAGE_KEYWORDS_USD = 0.012 + 20 * 0.00012;
const UNGROUPED = "Other (not grouped by the model)";

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
 * represents it, from what Google's top pages rank for.
 */
export function InfoTopicExtraction({
  projectId,
  modeButtons,
}: {
  projectId: string;
  modeButtons: ReactNode;
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
  const [rows, setRows] = useState<InfoTopicRow[]>([]);
  const [progress, setProgress] = useState<null | {
    done: number;
    total: number;
  }>(null);
  const [error, setError] = useState("");
  const stop = useRef(false);
  const save = useSaveSuggestionRun(projectId);

  const topics = [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length >= 2),
    ),
  ].slice(0, MAX_INFO_TOPICS);
  const typicalUsd = topics.length * (SERP_USD + PAGE_KEYWORDS_USD);
  const maxUsd = topics.length * (SERP_USD + 3 * PAGE_KEYWORDS_USD);

  async function run() {
    if (!country) return;
    stop.current = false;
    setError("");
    setRows([]);
    setProgress({ done: 0, total: topics.length });
    let aiWarned = false;
    try {
      for (let i = 0; i < topics.length; i += INFO_TOPIC_BATCH) {
        if (stop.current) break;
        const result = await extractInfoTopicsBatch({
          data: {
            projectId,
            topics: topics.slice(i, i + INFO_TOPIC_BATCH),
            locationCode: country,
            languageCode: getLanguageCode(country),
            acceptExisting,
            useAi,
          },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.aiMissing && !aiWarned) {
          aiWarned = true;
          toast.info(
            "AI check skipped: add an OpenRouter key under Project Integrations to use it.",
          );
        }
        setRows((current) => [...current, ...result.rows]);
        setProgress({
          done: Math.min(topics.length, i + INFO_TOPIC_BATCH),
          total: topics.length,
        });
      }
    } catch (cause) {
      setError(getStandardErrorMessage(cause, "Extraction failed."));
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <Card className="overflow-visible">
        <CardContent className="flex flex-col gap-4">
          {modeButtons}
          <p className="text-sm text-muted-foreground">
            For each topic, find the real search keyword that represents it:
            Google’s top 3 results are checked one by one, and the first page
            ranking for a matching keyword wins. Topics that are already
            searched keywords are taken as they are.
          </p>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="info-topics">
                Topics (one per line, up to {MAX_INFO_TOPICS})
              </Label>
              <TopicalMapImport
                projectId={projectId}
                onTopics={(imported) =>
                  setText((current) =>
                    [current.trim(), ...imported].filter(Boolean).join("\n"),
                  )
                }
              />
            </div>
            <Textarea
              id="info-topics"
              rows={6}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"carpal tunnel exercises\nwrist pain at night"}
            />
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
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={topics.length === 0 || !country || progress !== null}
              onClick={() => void run()}
            >
              {progress
                ? `Extracting… ${progress.done}/${progress.total}`
                : `Extract info topics (${topics.length})`}
            </Button>
            {progress ? (
              <Button
                variant="ghost"
                onClick={() => {
                  stop.current = true;
                }}
              >
                Stop
              </Button>
            ) : null}
            {topics.length ? (
              <span className="text-xs text-muted-foreground">
                About US${typicalUsd.toFixed(2)}, at most US$
                {maxUsd.toFixed(2)}. Less when topics are already keywords or
                pages repeat (their keywords are reused for 28 days).
              </span>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
      {rows.length ? (
        <InfoTopicsResults
          rows={rows}
          countryName={countryName}
          actions={
            <Button
              variant="outline"
              size="sm"
              disabled={save.isPending || progress !== null}
              onClick={() =>
                save.mutate(`${rows.length} info topics · ${countryName}`, {
                  mode: "info",
                  countryName,
                  rows,
                })
              }
            >
              Save results
            </Button>
          }
        />
      ) : null}
    </>
  );
}
