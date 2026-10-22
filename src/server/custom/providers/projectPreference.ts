import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";

export type SeoProviderRoute =
  | "direct_dataforseo"
  | "treg_serpstat"
  | "treg_dataforseo"
  | "both";
const SEO_PROVIDER_SECTION_KEY = "custom:seo-data-providers";

export function parseSeoProviderPreference(
  value: string | null | undefined,
): SeoProviderRoute {
  // Existing projects stored the shorter values. Keep them valid forever.
  if (value === "treg") return "treg_serpstat";
  if (value === "dataforseo") return "direct_dataforseo";
  if (
    value === "direct_dataforseo" ||
    value === "treg_serpstat" ||
    value === "treg_dataforseo"
  )
    return value;
  // The old "both" setting had no deterministic routing semantics. Existing
  // projects remain safe by starting on the direct provider.
  if (value === "both") return "both";
  return "direct_dataforseo";
}

export function isProviderAllowed(
  preference: SeoProviderRoute,
  provider: "dataforseo" | "treg",
): boolean {
  if (preference === "both") return true;
  if (provider === "dataforseo") return preference === "direct_dataforseo";
  return preference === "treg_serpstat" || preference === "treg_dataforseo";
}

/** Whether the selected route names a particular provider behind treg. */
export function isTregRoute(
  preference: SeoProviderRoute,
  route: "serpstat" | "dataforseo",
): boolean {
  return preference === "both" || preference === `treg_${route}`;
}

/** Server-only. Call only AFTER requireProjectContext has validated project membership. */
export async function getSeoProviderPreference(
  projectId: string,
): Promise<SeoProviderRoute> {
  const sections = await ProjectContextRepository.listSections(projectId);
  const section = sections.find((row) => row.key === SEO_PROVIDER_SECTION_KEY);
  return parseSeoProviderPreference(section?.content);
}
