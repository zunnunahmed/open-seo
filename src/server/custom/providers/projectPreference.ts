import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import type { SeoProviderRoute } from "@/server/custom/providers/treg/dataforseoTransport";

const SEO_PROVIDER_SECTION_KEY = "custom:seo-data-providers";

export function parseSeoProviderPreference(
  value: string | null | undefined,
): SeoProviderRoute {
  if (
    value === "direct_dataforseo" ||
    value === "treg_serpstat" ||
    value === "treg_dataforseo"
  )
    return value;
  // Existing projects stored the shorter values. Keep them valid forever.
  if (value === "treg") return "treg_serpstat";
  // "dataforseo", the retired "both" option, and anything unknown stay on the
  // direct provider so no project starts paying a new provider unasked.
  return "direct_dataforseo";
}

/** Server-only. Call only AFTER requireProjectContext has validated project membership. */
export async function getSeoProviderPreference(
  projectId: string,
): Promise<SeoProviderRoute> {
  const sections = await ProjectContextRepository.listSections(projectId);
  const section = sections.find((row) => row.key === SEO_PROVIDER_SECTION_KEY);
  return parseSeoProviderPreference(section?.content);
}

/** Backlinks-only preference; never alters the project's SEO research provider. */
const BACKLINKS_PROVIDER_KEY = "custom:backlinks-provider";

export async function getBacklinksProviderPreference(
  projectId: string,
): Promise<SeoProviderRoute> {
  const sections = await ProjectContextRepository.listSections(projectId);
  const section = sections.find((row) => row.key === BACKLINKS_PROVIDER_KEY);
  // Existing projects default to direct DataForSEO for Backlinks independently
  // of the global research preference.
  return parseSeoProviderPreference(section?.content);
}
