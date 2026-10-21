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
  return (
    <CardShell title="New clustering run">
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Keywords that share enough of the same top-10 Google results target
          the same intent, so they belong on one page. Paste up to 5,000
          keywords or upload a CSV.
        </p>
        <label className="block space-y-1">
          <span className="font-medium">Run name (optional)</span>
          <Input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Plumbing services AU"
          />
        </label>
        <div className="space-y-1">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <span className="font-medium">Keywords</span>
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
              rows={10}
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
              : "Optional: add search volume and CPC after a comma or tab (pasting from a spreadsheet works). CSV files need a keyword or query column; volume and CPC columns are optional."}
          </p>
        </div>
        {activeMarket ? (
          <ProjectMarketFields value={activeMarket} onChange={setMarket} />
        ) : null}
        <Label className="font-normal">
          <Checkbox
            checked={fetchVolume}
            onCheckedChange={(checked) => setFetchVolume(checked)}
          />
          Look up search volume and CPC for keywords without them
          {missingVolume ? ` (${missingVolume.toLocaleString()} keywords)` : ""}
        </Label>
        <p className={tooMany ? "text-destructive" : "text-muted-foreground"}>
          {parsed.keywords.length.toLocaleString()} unique keywords
          {parsed.duplicates
            ? ` · ${parsed.duplicates.toLocaleString()} duplicates removed`
            : ""}
          {parsed.invalid
            ? ` · ${parsed.invalid.toLocaleString()} too long, skipped`
            : ""}
          {tooMany
            ? ` · the limit is ${MAX_CLUSTER_KEYWORDS.toLocaleString()} per run`
            : ""}
        </p>
        <div className="flex justify-end">
          <Button
            disabled={
              parsed.keywords.length < 2 ||
              tooMany ||
              !activeMarket ||
              create.isPending
            }
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Preparing…" : "Review cost"}
          </Button>
        </div>
        {create.isError ? (
          <p role="alert" className="text-destructive">
            {getStandardErrorMessage(create.error)}
          </p>
        ) : null}
      </div>
    </CardShell>
  );
}
