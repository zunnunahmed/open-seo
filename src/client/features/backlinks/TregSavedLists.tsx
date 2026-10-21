import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { getTregSavedList } from "@/serverFunctions/tregLists";
import type {
  TregListKind,
  TregListSnapshot,
} from "@/server/custom/providers/treg/lists";

function csvEscape(v: unknown): string {
  const string = v == null ? "" : typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return '"' + string.replaceAll('"', '""') + '"';
}
function exportCsv(data: TregListSnapshot) {
  const header = [
    "Source",
    "Target",
    "Anchor",
    "Follow status",
    "First seen",
    "Authority",
    "Link count",
  ];
  const rows = data.rows.map((r) => [
    r.source,
    r.target,
    r.anchor,
    r.linkType,
    r.firstSeen,
    r.authority,
    r.linkCount,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `treg-${data.kind}-${data.domain}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
export function TregSavedLists({
  projectId,
  target,
}: {
  projectId: string;
  target: string;
}) {
  const [kind, setKind] = useState<TregListKind>("domains");
  const [snapshot, setSnapshot] = useState<TregListSnapshot | null>(null);
  const domain = target.toLowerCase().trim();
  const valid =
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain);
  const mutation = useMutation({
    mutationFn: (fetchFresh: boolean) =>
      getTregSavedList({
        data: {
          projectId,
          domain,
          kind,
          fetchFresh,
          acknowledgeCost: fetchFresh,
        },
      }),
    onSuccess: (result) => setSnapshot(result),
  });
  useEffect(() => {
    setSnapshot(null);
    mutation.reset();
    if (valid) mutation.mutate(false);
    // Deliberately tied to the query domain and tab; no paid fetch on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, kind, projectId]);
  const canShow = snapshot?.domain === domain && snapshot.kind === kind;
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="font-semibold">treg · Saved Backlink Research</h2>
      <p className="text-sm text-muted-foreground">
        Browse referring domains and source backlinks, save the first 20 results
        per list to this project, and export CSV. Saved snapshots remain
        available without another paid call.
      </p>
      <div className="flex flex-wrap gap-2">
        {(["domains", "backlinks"] as const).map((k) => (
          <Button
            key={k}
            variant={kind === k ? "default" : "outline"}
            size="sm"
            onClick={() => setKind(k)}
          >
            {k === "domains" ? "Referring domains" : "Individual backlinks"}
          </Button>
        ))}
      </div>
      {!valid ? (
        <p className="text-sm text-muted-foreground">
          Search a bare domain first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(true)}
          >
            {mutation.isPending
              ? "Loading…"
              : "Fetch & save first 20 (paid API)"}
          </Button>
          {canShow ? (
            <Button variant="outline" onClick={() => exportCsv(snapshot)}>
              Export CSV
            </Button>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Estimated provider charge up to about $0.01 per request; actual billing
        may vary by rows. Requesting the same list again refreshes the saved
        snapshot and may incur another charge.
      </p>
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not load list"}
        </p>
      ) : null}
      {canShow ? (
        <>
          <p className="text-sm text-muted-foreground">
            Saved snapshot · {new Date(snapshot.fetchedAt).toLocaleString()} ·
            {snapshot.rows.length} shown
            {snapshot.total == null ? "" : ` of ${snapshot.total} reported`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-2">Source</th>
                  {kind === "backlinks" ? (
                    <>
                      <th className="p-2">Target</th>
                      <th className="p-2">Anchor</th>
                      <th className="p-2">Follow</th>
                    </>
                  ) : (
                    <th className="p-2">Linking pages</th>
                  )}
                  <th className="p-2">Authority</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.map((row, i) => (
                  <tr key={row.source + "-" + i} className="border-b align-top">
                    <td className="p-2 break-all">
                      {row.source.startsWith("https://") ? (
                        <a
                          className="underline"
                          href={row.source}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.source}
                        </a>
                      ) : (
                        row.source
                      )}
                    </td>
                    {kind === "backlinks" ? (
                      <>
                        <td className="p-2 break-all">{row.target ?? "—"}</td>
                        <td className="p-2">{row.anchor ?? "—"}</td>
                        <td className="p-2">{row.linkType ?? "—"}</td>
                      </>
                    ) : (
                      <td className="p-2">{row.linkCount ?? "—"}</td>
                    )}
                    <td className="p-2">{row.authority ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : !mutation.isPending && valid ? (
        <p className="text-sm text-muted-foreground">
          No saved snapshot yet. Click Fetch & save.
        </p>
      ) : null}
    </section>
  );
}
