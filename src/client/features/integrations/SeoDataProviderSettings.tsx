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
  "direct_dataforseo",
  "treg_serpstat",
  "treg_dataforseo",
  "both",
] as const;
type Choice = (typeof OPTIONS)[number];

function parseChoice(value: string): Choice {
  if (value === "treg") return "treg_serpstat";
  if (value === "dataforseo") return "direct_dataforseo";
  return OPTIONS.includes(value as Choice)
    ? (value as Choice)
    : "direct_dataforseo";
}

/**
 * Per-project preference only. Existing API calls still use DataForSEO until
 * provider-aware billing/routing is reviewed and explicitly enabled.
 * Persists using existing project-context storage to avoid a live D1 migration.
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
                {[
                  [
                    "direct_dataforseo",
                    "Direct DataForSEO",
                    "Use the connected DataForSEO account directly.",
                  ],
                  [
                    "treg_serpstat",
                    "treg → Serpstat",
                    "Use treg's Serpstat route where supported.",
                  ],
                  [
                    "treg_dataforseo",
                    "treg → DataForSEO",
                    "Use treg's DataForSEO route where supported.",
                  ],
                  [
                    "both",
                    "Both available",
                    "Keep both routes available; each workflow chooses explicitly.",
                  ],
                ].map(([value, title, description]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
                  >
                    <input
                      type="radio"
                      name={`seo-provider-${projectId}`}
                      value={value}
                      checked={choice === value}
                      onChange={() => setChoice(parseChoice(value))}
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
