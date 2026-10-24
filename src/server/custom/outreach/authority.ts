import { z } from "zod";
import { postToTreg } from "@/server/custom/providers/treg/dataforseoTransport";

const ranksSchema = z.object({
  tasks: z.array(
    z.object({
      result: z
        .array(
          z.object({
            items: z
              .array(
                z.object({ target: z.string(), rank: z.number().nullish() }),
              )
              .nullish(),
          }),
        )
        .nullish(),
    }),
  ),
});

/**
 * Authority (0-100, comparable to Moz DA) for up to 1,000 domains in one
 * DataForSEO bulk-ranks call through treg (about US$0.024). An empty map when
 * the lookup fails: prospects are still useful without a score.
 */
export async function domainAuthority(
  domains: string[],
): Promise<Map<string, number>> {
  const ranks = new Map<string, number>();
  if (domains.length === 0) return ranks;
  try {
    const response = await postToTreg("dataforseo.web.url.metrics", [
      { targets: domains.slice(0, 1000), rank_scale: "one_hundred" },
    ]);
    const parsed = ranksSchema.safeParse(await response.json());
    if (!parsed.success) return ranks;
    const items = parsed.data.tasks.flatMap((task) =>
      (task.result ?? []).flatMap((result) => result.items ?? []),
    );
    for (const item of items)
      if (item.rank != null) ranks.set(item.target, item.rank);
  } catch (error) {
    console.warn("outreach.authority failed", error);
  }
  return ranks;
}
