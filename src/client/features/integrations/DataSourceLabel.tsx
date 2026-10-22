import { useQuery } from "@tanstack/react-query";
import { Database } from "lucide-react";
import type { SeoProviderRoute } from "@/server/custom/providers/treg/dataforseoTransport";
import { getProjectSeoProviderPreference } from "@/serverFunctions/projectContext";

export const SEO_PROVIDER_TITLES: Record<SeoProviderRoute, string> = {
  direct_dataforseo: "Direct DataForSEO",
  treg_serpstat: "treg → Serpstat",
  treg_dataforseo: "treg → DataForSEO",
};

export function seoProviderPreferenceQuery(projectId: string) {
  return {
    queryKey: ["seo-provider-preferences", projectId],
    queryFn: () => getProjectSeoProviderPreference({ data: { projectId } }),
  };
}

/**
 * Where this page's data comes from. Server caches are kept per route and the
 * browser cache is cleared when the route changes, so results on screen
 * always came through the route shown.
 */
export function DataSourceLabel({
  projectId,
  route,
  prefix = "Data source",
}: {
  projectId: string;
  /** A fixed route, e.g. the one a clustering job was created with. */
  route?: SeoProviderRoute;
  prefix?: string;
}) {
  const query = useQuery({
    ...seoProviderPreferenceQuery(projectId),
    enabled: route == null,
  });
  const shown = route ?? query.data;
  if (!shown) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground"
      title="Change it in Integrations → SEO data providers"
    >
      <Database className="size-3.5" aria-hidden />
      {prefix}:{" "}
      <span className="font-medium text-foreground">
        {SEO_PROVIDER_TITLES[shown]}
      </span>
    </span>
  );
}
