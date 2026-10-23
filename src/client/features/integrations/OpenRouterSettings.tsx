import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrainCircuit } from "lucide-react";
import { CardShell } from "@/client/components/CardShell";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getOpenRouterIntegration, saveOpenRouterModel, testOpenRouterConnection } from "@/serverFunctions/openrouterIntegration";

export function OpenRouterSettings({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const key = ["openrouter-integration", projectId];
  const status = useQuery({
    queryKey: key,
    queryFn: () => getOpenRouterIntegration({ data: { projectId } }),
  });
  const [model, setModel] = useState("");
  const [testMessage, setTestMessage] = useState("");
  useEffect(() => { if (status.data) setModel(status.data.model); }, [status.data]);

  const save = useMutation({
    mutationFn: () => saveOpenRouterModel({ data: { projectId, model: model.trim() } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      toast.success("OpenRouter default model saved.");
    },
    onError: () => toast.error("Could not save the model. Check its model ID."),
  });
  const test = useMutation({
    mutationFn: () => testOpenRouterConnection({ data: { projectId } }),
    onSuccess: (result) => setTestMessage(result.message),
    onError: () => setTestMessage("Could not verify the OpenRouter connection."),
  });

  return (
    <section id="ai-provider" className="scroll-mt-6">
      <CardShell title="AI Provider — OpenRouter" icon={<BrainCircuit className="size-4" />}>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">Manage the AI model separately from your SEO data providers. The API key stays on the server; only the model preference is stored per project.</p>
          {status.isPending ? <p role="status">Checking configuration…</p> :
            status.isError ? <p role="alert" className="text-destructive">Could not load AI provider settings.</p> : (
              <>
                <p className="font-medium">{status.data.configured ? "API key configured" : "API key not configured"}</p>
                <p className="text-muted-foreground">Set the Cloudflare Worker secret <code>OPENROUTER_API_KEY</code> for this deployment. Never paste the API key into this form or save it as project context.</p>
                <div className="space-y-1.5">
                  <label htmlFor="openrouter-model" className="font-medium">Default AI model ID</label>
                  <Input id="openrouter-model" value={model} onChange={(event) => setModel(event.target.value)}
                    placeholder="openai/gpt-4o-mini" spellCheck={false} />
                  <p className="text-xs text-muted-foreground">For example, openai/gpt-4o-mini. Model availability and billing depend on your OpenRouter account.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!model.trim() || save.isPending || model === status.data.model}
                    onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save model"}</Button>
                  <Button variant="outline" disabled={!status.data.configured || test.isPending}
                    onClick={() => { setTestMessage(""); test.mutate(); }}>{test.isPending ? "Testing…" : "Test connection"}</Button>
                </div>
                {testMessage && <p role="status" className="text-muted-foreground">{testMessage}</p>}
                <p className="text-xs text-muted-foreground">Connection test checks API authentication only; it does not run or charge for model inference. Competitor Topical Map uses this model for AI topic clustering.</p>
              </>
            )}
        </div>
      </CardShell>
    </section>
  );
}
