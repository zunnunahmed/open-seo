import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";

const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** OpenRouter key and the project's model, or null when AI is not set up. */
export async function infoTopicAi(
  projectId: string,
): Promise<{ apiKey: string; model: string } | null> {
  const apiKey = await getOptionalEnvValue("OPENROUTER_API_KEY");
  if (!apiKey) return null;
  const sections = await ProjectContextRepository.listSections(projectId);
  const model =
    sections.find((entry) => entry.key === "custom:openrouter-model")
      ?.content || DEFAULT_MODEL;
  return { apiKey, model };
}

const answerSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }).nullish(),
      }),
    )
    .optional(),
});

/**
 * Ask the model which keyword means the same as the topic. Returns its index
 * in `keywords`, or null for none (or when the model gives no usable answer,
 * so a flaky reply is a miss rather than a wrong pick).
 */
export async function aiPickKeyword(
  ai: { apiKey: string; model: string },
  topic: string,
  keywords: string[],
): Promise<number | null> {
  if (keywords.length === 0) return null;
  const list = keywords.map((keyword, index) => `${index + 1}. ${keyword}`);
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0,
        max_tokens: 10,
        messages: [
          {
            role: "system",
            content:
              "You match an SEO topic to the search keyword that has the same meaning and search intent. Reply with only the number of the best keyword, or 0 if none means the same thing. A broader or different subject is not a match.",
          },
          {
            role: "user",
            content: `Topic: ${topic}\nKeywords:\n${list.join("\n")}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) return null;
  const parsed = answerSchema.safeParse(await response.json());
  const text = parsed.success
    ? (parsed.data.choices?.[0]?.message?.content ?? "")
    : "";
  const number = Number(/\d+/.exec(text)?.[0] ?? "0");
  return number >= 1 && number <= keywords.length ? number - 1 : null;
}
