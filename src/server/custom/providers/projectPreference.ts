import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";

export type SeoProviderPreference = "dataforseo" | "treg" | "both";
export const SEO_PROVIDER_SECTION_KEY = "custom:seo-data-providers";

export function parseSeoProviderPreference(value: string | null | undefined): SeoProviderPreference {
  return value === "treg" || value === "both" ? value : "dataforseo";
}

export function isProviderAllowed(preference: SeoProviderPreference, provider: "dataforseo" | "treg"): boolean {
  return preference === "both" || preference === provider;
}

/** Server-only. Call only AFTER requireProjectContext has validated project membership. */
export async function getSeoProviderPreference(projectId: string): Promise<SeoProviderPreference> {
  const sections = await ProjectContextRepository.listSections(projectId);
  const section = sections.find((row) => row.key === SEO_PROVIDER_SECTION_KEY);
  return parseSeoProviderPreference(section?.content);
}
