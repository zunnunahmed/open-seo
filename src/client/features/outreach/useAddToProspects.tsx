import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addProspectsFromBacklinks,
  getOutreach,
} from "@/serverFunctions/outreach";

import type { AddToProspects, ProspectCandidate } from "./AddProspectButton";

const bare = (domain: string) =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");

/**
 * Send sites from already-fetched Backlinks research to Outreach → Link
 * Prospects. Knows which domains are already listed, so rows show a check.
 */
export function useAddToProspects(
  projectId: string,
  target: string,
): AddToProspects {
  const queryClient = useQueryClient();
  const outreach = useQuery({
    queryKey: ["outreach", projectId],
    queryFn: () => getOutreach({ data: { projectId } }),
  });
  const [pending, setPending] = useState<Set<string>>(new Set());
  const listed = new Set(
    (outreach.data?.prospects ?? []).map((prospect) => prospect.domain),
  );

  async function add(candidates: ProspectCandidate[]) {
    const items = candidates.filter(
      (candidate) => candidate.domain && !listed.has(bare(candidate.domain)),
    );
    if (items.length === 0) {
      toast.info("Already in Link Prospects.");
      return;
    }
    const domains = items.map((item) => bare(item.domain));
    setPending((current) => new Set([...current, ...domains]));
    try {
      const result = await addProspectsFromBacklinks({
        data: {
          projectId,
          target,
          items: items.slice(0, 500).map((item) => ({
            domain: item.domain,
            sourceUrl: item.sourceUrl ?? null,
            authority:
              item.authority == null ? null : Math.round(item.authority),
          })),
        },
      });
      await queryClient.invalidateQueries({
        queryKey: ["outreach", projectId],
      });
      toast.success(
        `${result.found} added to Link Prospects. Find their emails under Outreach → Link Prospects.`,
      );
    } catch {
      toast.error("Could not add to Link Prospects.");
    } finally {
      setPending((current) => {
        const next = new Set(current);
        for (const domain of domains) next.delete(domain);
        return next;
      });
    }
  }

  return {
    add,
    isListed: (domain: string) => listed.has(bare(domain)),
    isPending: (domain: string) => pending.has(bare(domain)),
  };
}
