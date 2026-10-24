import { OutreachRepository } from "./OutreachRepository";
import { bareDomain, isUnpitchableDomain } from "./prospectFinders";

/** The project's own domain, never added as its own prospect. */
export function ownDomain(project: { domain?: string | null }): string | null {
  return project.domain ? bareDomain(project.domain) : null;
}

/** Drop do-not-contact sites, government sites and giants nobody pitches. */
export async function keepUnsuppressed<T extends { domain: string }>(
  projectId: string,
  prospects: T[],
): Promise<T[]> {
  const suppressed = await OutreachRepository.listSuppressions(projectId);
  return prospects.filter(
    (prospect) =>
      !suppressed.has(prospect.domain) && !isUnpitchableDomain(prospect.domain),
  );
}
