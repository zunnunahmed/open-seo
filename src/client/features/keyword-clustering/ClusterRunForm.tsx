import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Papa from "papaparse";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
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
          the same intent, so they belong on one page. Paste one keyword per
          line (optionally followed by a tab or comma and the search volume,
          then CPC), or upload a CSV with a keyword column.
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
        {uploaded ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
            <span>
              {fileName}: {uploaded.length.toLocaleString()} rows
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setUploaded(null);
                setFileName(null);
              }}
            >
              Remove file
            </Button>
          </div>
        ) : (
          <label className="block space-y-1">
            <span className="font-medium">Keywords</span>
            <Textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "emergency plumber sydney\t1900\nblocked drain sydney\t880"
              }
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="font-medium">Or upload CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {activeMarket ? (
          <ProjectMarketFields value={activeMarket} onChange={setMarket} />
        ) : null}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fetchVolume}
            onChange={(e) => setFetchVolume(e.target.checked)}
          />
          Look up search volume and CPC for keywords without them (
          {missingVolume.toLocaleString()})
        </label>
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
