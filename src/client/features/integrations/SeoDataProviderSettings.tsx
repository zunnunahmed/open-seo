import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import {
  getProjectSeoProviderPreference,
  updateProjectContext,
} from "@/serverFunctions/projectContext";

const SECTION = "seo-data-providers";
const OPTIONS = [
  {
    value: "direct_dataforseo",
    title: "Direct DataForSEO",
    description: "Use the connected DataForSEO account directly.",
  },
  {
    value: "treg_serpstat",
    title: "treg → Serpstat",
    description:
      "Serpstat data through treg, billed to the treg balance. Country-level data only.",
  },
  {
    value: "treg_dataforseo",
    title: "treg → DataForSEO",
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
  const queryKey = ["seo-provider-preferences", projectId];
  const query = useQuery({
    queryKey,
    queryFn: () => getProjectSeoProviderPreference({ data: { projectId } }),
  });
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
