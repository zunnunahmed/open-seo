import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  configureSitemapMonitor,
  getSitemapMonitor,
  scanSitemapNow,
} from "@/serverFunctions/sitemapMonitor";
import { IndexCoverageSummary } from "./IndexCoverageSummary";
export function SitemapSettings({
  projectId,
  domain,
}: {
  projectId: string;
  domain: string | null;
}) {
  const client = useQueryClient();
  const queryKey = ["sitemapMonitor", projectId];
  const query = useQuery({
    queryKey,
    queryFn: () => getSitemapMonitor({ data: { projectId } }),
  });
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [indexCoverage, setIndexCoverage] = useState(true);
  useEffect(() => {
    if (query.data?.config) {
      setUrl(query.data.config.sitemapUrl);
      setEnabled(query.data.config.enabled);
      setIndexCoverage(query.data.config.indexCoverage);
    } else if (domain) {
      setUrl(`https://${domain}/sitemap.xml`);
    }
  }, [query.data, domain]);
  const save = useMutation({
    mutationFn: async () => {
      const result = await configureSitemapMonitor({
        data: { projectId, sitemapUrl: url.trim(), enabled, indexCoverage },
      });
      if (!result.ok) throw new Error(result.error);
      return result.config;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey }),
  });
  const scan = useMutation({
    mutationFn: async () => {
      const result = await scanSitemapNow({ data: { projectId } });
      if (!result.ok) throw new Error(result.error);
      return result.snapshot;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey });
      void client.invalidateQueries({ queryKey: ["indexCoverage", projectId] });
    },
  });
  const latest = query.data?.history[0];
  return (
    <>
      <section className="space-y-4 border-t border-border pt-8">
        <SectionHeader
          title="Sitemap monitoring"
          hint="Counts unique URLs in this website's XML sitemap and any nested sitemaps, on the first day of each month. This is a sitemap inventory, not an HTML crawl or Google's indexed-page count."
        />
        <div className="space-y-1.5">
          <Label htmlFor={`sitemap-url-${projectId}`}>Sitemap URL</Label>
          <Input
            id={`sitemap-url-${projectId}`}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/sitemap.xml"
          />
          {!domain ? (
            <p className="text-xs text-muted-foreground">
              No project domain is set, so the sitemap URL&rsquo;s domain is
              monitored.
            </p>
          ) : null}
        </div>
        <div className="space-y-2.5">
          <Label className="font-normal">
            <Checkbox
              checked={enabled}
              onCheckedChange={(checked) => setEnabled(checked)}
            />
            Check the sitemap automatically each month
          </Label>
          <Label className="font-normal">
            <Checkbox
              checked={indexCoverage}
              onCheckedChange={(checked) => setIndexCoverage(checked)}
            />
            Check Google indexing daily (up to 500 URLs a day via Search
            Console)
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={(!domain && !url.trim()) || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save sitemap settings"}
          </Button>
          <Button
            variant="outline"
            disabled={!query.data?.config || scan.isPending}
            onClick={() => scan.mutate()}
          >
            <RefreshCw
              className={`size-4 ${scan.isPending ? "animate-spin" : ""}`}
            />
            {scan.isPending ? "Checking…" : "Check sitemap now"}
          </Button>
          {save.isSuccess && !save.isPending ? (
            <span role="status" className="text-sm text-muted-foreground">
              Saved.
            </span>
          ) : null}
        </div>
        {save.isError || scan.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {(save.error ?? scan.error)?.message}
          </p>
        ) : null}
        {latest ? (
          latest.complete ? (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              <span>
                <span className="font-medium tabular-nums">
                  {latest.urlCount.toLocaleString()} URLs
                </span>{" "}
                <span className="text-muted-foreground">
                  in {latest.sitemapCount.toLocaleString()}{" "}
                  {latest.sitemapCount === 1 ? "sitemap" : "sitemaps"} · checked{" "}
                  {new Date(latest.scannedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </span>
            </p>
          ) : (
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="font-medium">
                  The last check was incomplete:{" "}
                  {latest.urlCount.toLocaleString()} URLs found, not a confirmed
                  count.
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">
                  {latest.errors.map((message, index) => (
                    <li key={`${index}-${message}`} className="break-words">
                      {message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        ) : null}
      </section>
      <section className="space-y-4 border-t border-border pt-8">
        <SectionHeader
          title="Google index coverage"
          hint="Sitemap URLs checked with Search Console URL Inspection."
        />
        <IndexCoverageSummary projectId={projectId} variant="full" />
      </section>
    </>
  );
}
