import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import Papa from "papaparse";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { KeywordAreaField } from "@/client/features/keywords/page/KeywordAreaField";
import { ProjectMarketFields } from "@/client/features/projects/ProjectMarketFields";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import { createClusterJob } from "@/serverFunctions/keywordClustering";
import {
  cleanKeywordList,
  MAX_CLUSTER_KEYWORDS,
  parseKeywordCsvRows,
  parseKeywordLines,
  type ClusterInputKeyword,
} from "@/shared/keywordClustering";

export function ClusterRunForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (jobId: string) => void;
}) {
  const projectsQuery = useQuery(projectsQueryOptions());
  const project = projectsQuery.data?.find((p) => p.id === projectId);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [uploaded, setUploaded] = useState<ClusterInputKeyword[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [market, setMarket] = useState<{
    locationCode: number;
    languageCode: string;
  } | null>(null);
  const [locationName, setLocationName] = useState<string | undefined>();
  const [fetchVolume, setFetchVolume] = useState(true);
  const activeMarket =
    market ??
    (project
      ? {
          locationCode: project.locationCode,
          languageCode: project.languageCode,
        }
      : null);

  const parsed = useMemo(
    () => cleanKeywordList(uploaded ?? parseKeywordLines(text)),
    [uploaded, text],
  );
  const missingVolume = parsed.keywords.filter((k) => k.volume == null).length;

  const create = useMutation({
    mutationFn: async () => {
      if (!activeMarket) throw new Error("Choose a country and language.");
      const result = await createClusterJob({
        data: {
          projectId,
          name: name.trim(),
          keywords: parsed.keywords,
          fetchVolume: fetchVolume && missingVolume > 0,
          ...activeMarket,
          locationName: locationName ?? null,
        },
      });
      if (!result.ok) throw new Error(result.error);
      return result.job;
    },
    onSuccess: (job) => onCreated(job.id),
  });

  function onFile(file: File | undefined) {
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setUploaded(parseKeywordCsvRows(result.data));
        setFileName(file.name);
      },
    });
  }

  const tooMany = parsed.keywords.length > MAX_CLUSTER_KEYWORDS;
  const count = parsed.keywords.length;
  return (
    <CardShell title="New clustering run">
      <div className="grid gap-6 text-sm lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              Keywords{" "}
              <span
                className={
                  tooMany
                    ? "font-normal text-destructive"
                    : "font-normal text-muted-foreground"
                }
              >
                · {count.toLocaleString()} of{" "}
                {MAX_CLUSTER_KEYWORDS.toLocaleString()}
              </span>
            </span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                // Allow choosing the same file again after removing it.
                e.target.value = "";
              }}
            />
            <div className="flex gap-2">
              {!uploaded && text ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setText("")}
                >
                  Clear
                </Button>
              ) : null}
              {!uploaded ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload className="size-4" />
                  Upload CSV
                </Button>
              ) : null}
            </div>
          </div>
          {uploaded ? (
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
              <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {uploaded.length.toLocaleString()} rows read
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setUploaded(null);
                  setFileName(null);
                }}
              >
                <X className="size-4" />
                Remove
              </Button>
            </div>
          ) : (
            <Textarea
              className="min-h-72 flex-1 font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Keywords, one per line"
              placeholder={
                "One keyword per line, for example:\nemergency plumber sydney\nblocked drain sydney, 880\nhot water repairs, 1300, 12.50"
              }
            />
          )}
          <p className="text-xs text-muted-foreground">
            {uploaded
              ? "Clustering uses the keyword column from this file. Remove it to paste keywords instead."
              : "Paste from a spreadsheet: keyword, then optional volume and CPC. CSV files need a keyword or query column."}
          </p>
          {parsed.duplicates || parsed.invalid || tooMany ? (
            <p
              className={
                tooMany
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {parsed.duplicates
                ? `${parsed.duplicates.toLocaleString()} duplicates removed. `
                : ""}
              {parsed.invalid
                ? `${parsed.invalid.toLocaleString()} too long, skipped. `
                : ""}
              {tooMany
                ? `The limit is ${MAX_CLUSTER_KEYWORDS.toLocaleString()} per run.`
                : ""}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
          <label className="block space-y-1">
            <span className="font-medium">Run name (optional)</span>
            <Input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Plumbing services AU"
            />
          </label>
          {activeMarket ? (
            <>
              <ProjectMarketFields
                value={activeMarket}
                onChange={(next) => {
                  // A city belongs to one country.
                  if (next.locationCode !== activeMarket.locationCode)
                    setLocationName(undefined);
                  setMarket(next);
                }}
              />
              <div className="space-y-1">
                <span className="font-medium">City (optional)</span>
                <KeywordAreaField
                  className="w-full"
                  locationCode={activeMarket.locationCode}
                  value={locationName}
                  onChange={setLocationName}
                />
                <p className="text-xs text-muted-foreground">
                  Use one city’s Google results for local services. Leave empty
                  for the whole country.
                </p>
              </div>
            </>
          ) : null}
          <Label className="items-start font-normal">
            <Checkbox
              className="mt-0.5"
              checked={fetchVolume}
              onCheckedChange={(checked) => setFetchVolume(checked)}
            />
            <span>
              Look up search volume and CPC for keywords without them
              {missingVolume
                ? ` (${missingVolume.toLocaleString()} keywords)`
                : ""}
            </span>
          </Label>
          <Button
            className="w-full"
            disabled={count < 2 || tooMany || !activeMarket || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending
              ? "Preparing…"
              : count < 2
                ? "Add at least 2 keywords"
                : `Review cost for ${count.toLocaleString()} keywords`}
          </Button>
          <p className="-mt-2 text-center text-xs text-muted-foreground">
            You see the price before anything is charged.
          </p>
          {create.isError ? (
            <p role="alert" className="text-destructive">
              {getStandardErrorMessage(create.error)}
            </p>
          ) : null}
          <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">How it works</p>
            <ol className="list-decimal space-y-0.5 pl-4">
              <li>We fetch Google’s top 10 results for every keyword.</li>
              <li>
                Keywords that share enough of the same pages go in one cluster:
                one page should target them all.
              </li>
              <li>
                You tune the grouping afterwards for free: no new searches
                needed.
              </li>
            </ol>
          </div>
        </div>
      </div>
    </CardShell>
  );
}
