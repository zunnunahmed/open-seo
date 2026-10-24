/**
 * Google phrases that find sites inviting guest posts. Each chosen phrase is
 * one paid search per topic.
 */
export const GUEST_POST_FOOTPRINTS = [
  {
    id: "write_for_us",
    label: 'Title says "write for us"',
    query: 'intitle:"write for us"',
  },
  {
    id: "guidelines",
    label: "Guest post guidelines",
    query: '"guest post guidelines" OR "submit a guest post"',
  },
  {
    id: "contributor",
    label: "Become a contributor",
    query: '"become a contributor" OR inurl:contribute',
  },
  {
    id: "guest_post_title",
    label: 'Title says "guest post"',
    query: 'intitle:"guest post"',
  },
  {
    id: "accepting",
    label: "Accepting guest posts",
    query: '"accepting guest posts" OR "guest posts wanted"',
  },
  {
    id: "submission",
    label: "Contributor or submission guidelines",
    query: '"contributor guidelines" OR "submission guidelines"',
  },
  {
    id: "write_for_us_url",
    label: "Page address has write-for-us",
    query: "inurl:write-for-us",
  },
  {
    id: "sponsored",
    label: "Sponsored posts (usually paid)",
    query: '"sponsored post" OR "advertise with us"',
  },
] as const;

export type FootprintId = (typeof GUEST_POST_FOOTPRINTS)[number]["id"];

export function isFootprintId(value: string): value is FootprintId {
  return GUEST_POST_FOOTPRINTS.some((footprint) => footprint.id === value);
}

export const DEFAULT_FOOTPRINTS: FootprintId[] = [
  "write_for_us",
  "guidelines",
  "contributor",
];

/** Searches per run: keeps cost predictable and inside Workers Free limits. */
export const MAX_PROSPECT_SEARCHES = 20;

/** The Google searches a guest-post run makes, in order, capped. */
export function guestPostQueries(
  topics: string[],
  footprints: FootprintId[],
  customFootprint: string,
): string[] {
  const phrases = [
    ...GUEST_POST_FOOTPRINTS.filter((footprint) =>
      footprints.includes(footprint.id),
    ).map((footprint) => footprint.query),
    ...(customFootprint.trim() ? [customFootprint.trim()] : []),
  ];
  return topics
    .flatMap((topic) => phrases.map((phrase) => `${topic} ${phrase}`))
    .slice(0, MAX_PROSPECT_SEARCHES);
}
