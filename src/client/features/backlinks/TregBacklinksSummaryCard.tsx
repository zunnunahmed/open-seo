import { useMutation } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { runTregBacklinksSummary } from "@/serverFunctions/tregBacklinks";

export function TregBacklinksSummaryCard({
  projectId,
  target,
}: {
  projectId: string;
  target: string;
}) {
  const mutation = useMutation({
    mutationFn: (domain: string) =>
      runTregBacklinksSummary({
        data: { projectId, domain, acknowledgeCost: true },
      }),
  });
  const domain = target.toLowerCase().trim();
  const validDomain =
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain);
  // A new domain must never display the previous target's research.
  const result = mutation.data?.target === domain ? mutation.data : null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="font-semibold">treg · Serpstat Backlinks Summary</h2>
      <p className="text-sm text-muted-foreground">
        An optional one-time summary for this project. Click to request data.
        Estimated provider cost: $0.0025 per uncached request; a result is
        cached for 24 hours. No automatic calls or paid retries.
      </p>
      {!validDomain ? (
        <p className="text-sm text-muted-foreground">
          Search for a bare domain such as example.com to use treg summary.
        </p>
      ) : (
        <Button
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(domain)}
        >
          {mutation.isPending
            ? "Checking…"
            : "Run treg summary (up to $0.0025)"}
        </Button>
      )}
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "treg request failed."}
        </p>
      ) : null}
      {result ? (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p className="text-muted-foreground">
            Source: Serpstat via treg ·{" "}
            {result.cached ? "Cached" : "New API request"} ·{" "}
            {new Date(result.fetchedAt).toLocaleString()}
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["Backlinks", result.backlinks],
              ["Referring domains", result.referringDomains],
              ["Authority (Serpstat)", result.authority],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">
                  {typeof value === "number"
                    ? value.toLocaleString()
                    : "Not reported"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Provider figures can differ from DataForSEO; do not treat them as
            identical metrics.
          </p>
        </div>
      ) : null}
    </section>
  );
}
