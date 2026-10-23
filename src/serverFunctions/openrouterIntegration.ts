import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";

const KEY = "custom:openrouter-model";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const projectSchema = z.object({ projectId: z.string().uuid() });
const modelSchema = projectSchema.extend({
  model: z.string().trim().min(3).max(150).regex(/^[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:+-]+$/),
});

async function getSavedModel(projectId: string): Promise<string> {
  const sections = await ProjectContextRepository.listSections(projectId);
  return sections.find((entry) => entry.key === KEY)?.content ?? DEFAULT_MODEL;
}

export const getOpenRouterIntegration = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async ({ context }) => ({
    configured: Boolean(await getOptionalEnvValue("OPENROUTER_API_KEY")),
    model: await getSavedModel(context.projectId),
    keyLocation: "Cloudflare Worker secret",
  }));

export const saveOpenRouterModel = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(modelSchema)
  .handler(async ({ data, context }) => {
    await ProjectContextService.applyContextUpdates(context.projectId, [
      { customSection: "openrouter-model", title: "OpenRouter default AI model", content: data.model },
    ], "user");
    return { model: await getSavedModel(context.projectId) };
  });

export const testOpenRouterConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async () => {
    const apiKey = await getOptionalEnvValue("OPENROUTER_API_KEY");
    if (!apiKey) return { ok: false, message: "OPENROUTER_API_KEY is not configured on this deployment." };
    try {
      // Models endpoint validates the bearer credential without buying model inference.
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        return { ok: false, message: response.status === 401 || response.status === 403 ? "OpenRouter rejected the configured API key." : `OpenRouter returned HTTP ${response.status}.` };
      }
      return { ok: true, message: "OpenRouter API key verified." };
    } catch {
      return { ok: false, message: "Could not reach OpenRouter. Check network access and try again." };
    }
  });
