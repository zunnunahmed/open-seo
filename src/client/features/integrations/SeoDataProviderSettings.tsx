import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import { updateProjectContext } from "@/serverFunctions/projectContext";
import {
  SEO_PROVIDER_TITLES,
  seoProviderPreferenceQuery,
} from "@/client/features/integrations/DataSourceLabel";

const SECTION = "seo-data-providers";
const OPTIONS = [
  {
    value: "direct_dataforseo",
    title: SEO_PROVIDER_TITLES.direct_dataforseo,
    description: "Use the connected DataForSEO account directly.",
  },
  {
    value: "treg_serpstat",
    title: SEO_PROVIDER_TITLES.treg_serpstat,
    description:
      "Serpstat data through treg, billed to the treg balance. Country-level data only.",
  },
  {
    value: "treg_dataforseo",
    title: SEO_PROVIDER_TITLES.treg_dataforseo,
    description:
      "The same DataForSEO data through treg, billed to the treg balance. Queued SERP jobs run live (higher cost).",
  },
] as const;
type Choice = (typeof OPTIONS)[number]["value"];

/**
 * Per-project SEO data route. Research server functions read it through the
 * requireProjectSeoRoute middleware. Persists using existing project-context
 * storage to avoid a live D1 migration.
 */
export function SeoDataProviderSettings({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { queryKey } = seoProviderPreferenceQuery(projectId);
  const query = useQuery(seoProviderPreferenceQuery(projectId));
  const saved = query.data ?? "direct_dataforseo";
  const [choice, setChoice] = useState<Choice>("direct_dataforseo");

  useEffect(() => {
    if (query.data) setChoice(saved);
  }, [query.data, saved]);

  const mutation = useMutation({
    mutationFn: (value: Choice) =>
      updateProjectContext({
        data: {
          projectId,
          updates: [
            {
              customSection: SECTION,
              title: "SEO data provider preference",
              content: value,
            },
          ],
        },
      }),
    onSuccess: () => {
      // Results fetched on the old route must not show under the new route's
      // data source label, so drop them from the browser cache.
      queryClient.removeQueries({ type: "inactive" });
      void queryClient.invalidateQueries({ queryKey });
      toast.success("Project provider preference saved");
    },
    onError: () => toast.error("Could not save the project preference"),
  });

  return (
    <section id="seo-data-providers" className="scroll-mt-6">
      <CardShell title="SEO data providers">
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Choose which SEO data sources this project should use. This
            preference is stored separately for each project.
          </p>
          {query.isError ? (
            <p role="alert" className="text-destructive">
              Could not load project settings.
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            </p>
          ) : query.isPending ? (
            <p role="status">Loading provider preference…</p>
          ) : (
            <>
              <fieldset className="space-y-3">
                <legend className="font-medium">Preferred providers</legend>
                {OPTIONS.map(({ value, title, description }) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
                  >
                    <input
                      type="radio"
                      name={`seo-provider-${projectId}`}
                      value={value}
                      checked={choice === value}
                      onChange={() => setChoice(value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium">{title}</span>
                      <span className="block text-muted-foreground">
                        {description}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-muted-foreground">
                The selected route is never silently replaced by another
                provider. Unsupported workflow/provider combinations show a
                clear error instead.
              </p>
              <div className="flex justify-end">
                <Button
                  disabled={mutation.isPending || choice === saved}
                  onClick={() => mutation.mutate(choice)}
                >
                  Save preference
                </Button>
              </div>
            </>
          )}
        </div>
      </CardShell>
    </section>
  );
}
