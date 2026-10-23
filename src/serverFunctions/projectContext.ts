import { getSeoProviderPreference, getBacklinksProviderPreference } from "@/server/custom/providers/projectPreference";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  getProjectContextSchema,
  updateProjectContextSchema,
} from "@/types/schemas/projectContext";

export const getProjectContext = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getProjectContextSchema)
  .handler(async ({ context }) =>
    ProjectContextService.getProjectContext(context.projectId),
  );

export const updateProjectContext = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateProjectContextSchema)
  .handler(async ({ data, context }) =>
    // Everything reaching this entry point is a person editing their own
    // project's memory; SAM and MCP writes go through the same service with
    // their own author.
    ProjectContextService.applyContextUpdates(
      context.projectId,
      data.updates,
      "user",
    ),
  );

export const getProjectSeoProviderPreference = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(getProjectContextSchema)
  .handler(async ({ context }) => getSeoProviderPreference(context.projectId));

export const getProjectBacklinksProviderPreference = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getProjectContextSchema)
  .handler(async ({ context }) => getBacklinksProviderPreference(context.projectId));

export const setProjectBacklinksProviderPreference = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(z.object({
    projectId: z.string().min(1),
    provider: z.enum(["direct_dataforseo", "treg_dataforseo", "treg_serpstat"]),
  }))
  .handler(async ({ data, context }) => {
    await ProjectContextService.applyContextUpdates(
      context.projectId,
      [{ customSection: "backlinks-provider", title: "Backlinks provider", content: data.provider }],
      "user",
    );
    return getBacklinksProviderPreference(context.projectId);
  });
