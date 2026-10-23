import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { refreshBacklinksTarget } from "@/serverFunctions/backlinks";
import type { BacklinksSearchState } from "./backlinksPageTypes";

const BACKLINKS_QUERIES = new Set([
  "backlinksOverview",
  "backlinksRows",
  "backlinksReferringDomains",
  "backlinksTopPages",
  "backlinksDomainLinks",
]);

/**
 * Research is kept 28 days; this fetches fresh (paid) data for the target and
 * saves it as the new copy.
 */
export function BacklinksRefreshButton({
  projectId,
  target,
  scope,
}: {
  projectId: string;
  target: string;
  scope: BacklinksSearchState["scope"];
}) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={refreshing}
      title="Fetch fresh backlinks data (paid) and keep it for 28 days"
      onClick={async () => {
        setRefreshing(true);
        try {
          await refreshBacklinksTarget({ data: { projectId, target, scope } });
          await queryClient.invalidateQueries({
            predicate: (query) =>
              BACKLINKS_QUERIES.has(String(query.queryKey[0])),
          });
        } finally {
          setRefreshing(false);
        }
      }}
    >
      <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
      Refresh
    </Button>
  );
}
