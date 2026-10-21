import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
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
  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="text-lg font-semibold">Sitemap monitoring</h2>
      <p className="text-sm text-muted-foreground">
        Count unique URLs listed in this website's XML sitemap and any nested
        sitemaps. Enabled projects are checked on the first day of each month.
        This is a sitemap inventory, not an HTML crawl or Google indexed-pages
        count.
      </p>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Sitemap URL</span>
        <input
          type="url"
          className="w-full rounded-md border bg-background px-3 py-2"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/sitemap.xml"
        />
      </label>
      {!domain ? (
        <p className="text-xs text-muted-foreground">
          No project domain is set, so the sitemap URL's domain is monitored.
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Automatically check each month
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={indexCoverage}
          onChange={(e) => setIndexCoverage(e.target.checked)}
        />
        Check Google indexing daily (up to 500 URLs a day via Search Console)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={(!domain && !url.trim()) || save.isPending}
          onClick={() => save.mutate()}
        >
          Save sitemap settings
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.config || scan.isPending}
          onClick={() => scan.mutate()}
        >
          {scan.isPending ? "Checking…" : "Check sitemap now"}
        </Button>
      </div>
      {save.isError || scan.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {(save.error ?? scan.error)?.message}
        </p>
      ) : null}
      {save.isSuccess ? (
        <p role="status" className="text-sm">
          Sitemap settings saved.
        </p>
      ) : null}
      {query.data?.history[0] ? (
        <p className="text-sm text-muted-foreground">
          Latest check:{" "}
          {new Date(query.data.history[0].scannedAt).toLocaleString()} ·{" "}
          {query.data.history[0].complete
            ? `${query.data.history[0].urlCount.toLocaleString()} URLs`
            : `${query.data.history[0].urlCount.toLocaleString()} URLs detected (unverified)`}{" "}
          ·{" "}
          {query.data.history[0].complete
            ? "Complete"
            : "Partial / check errors"}
        </p>
      ) : null}
      {query.data?.history[0] && !query.data.history[0].complete ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm"
        >
          <p className="font-medium">
            Sitemap scan was incomplete; 0 is not a confirmed page count.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {query.data.history[0].errors.map((message, index) => (
              <li key={`${index}-${message}`} className="break-words">
                {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-2 pt-2">
        <h3 className="font-medium">Google index coverage</h3>
        <IndexCoverageSummary projectId={projectId} showActions />
      </div>
    </section>
  );
}
