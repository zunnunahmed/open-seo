import { sort } from "remeda";
import { urlDomain, type KeywordCluster } from "./keywordClustering";
import { isPlatformDomain } from "./serpPlatforms";

type TopicHub = {
  id: number;
  /** Main keyword of the hub's highest-volume cluster. */
  name: string;
  clusterIds: number[];
  totalVolume: number;
};

/** URLs most of a cluster ranks with, platforms optionally left out. */
function coreUrls(cluster: KeywordCluster, ignorePlatforms: boolean) {
  const counts = new Map<string, number>();
  for (const keyword of cluster.keywords)
    for (const url of keyword.urls) {
      if (ignorePlatforms && isPlatformDomain(urlDomain(url))) continue;
      counts.set(url, (counts.get(url) ?? 0) + 1);
    }
  return new Set(
    sort([...counts], (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([url]) => url),
  );
}

/** Hubs need clusters whose core pages share at least this many URLs. */
const HUB_SHARED_URLS = 3;

/**
 * Group clusters into topic hubs: clusters whose core ranking pages overlap
 * cover one broader topic (a pillar page with supporting pages). Clusters
 * with no close neighbour are left out.
 */
export function groupTopicHubs(
  clusters: KeywordCluster[],
  options: { ignorePlatforms: boolean },
): TopicHub[] {
  const cores = clusters.map((cluster) =>
    coreUrls(cluster, options.ignorePlatforms),
  );
  const parent = clusters.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  for (let a = 0; a < clusters.length; a++)
    for (let b = a + 1; b < clusters.length; b++) {
      let shared = 0;
      for (const url of cores[a]) if (cores[b].has(url)) shared++;
      if (shared >= HUB_SHARED_URLS) parent[find(b)] = find(a);
    }
  const members = new Map<number, KeywordCluster[]>();
  clusters.forEach((cluster, index) => {
    const root = find(index);
    members.set(root, [...(members.get(root) ?? []), cluster]);
  });
  const hubs = [...members.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      const byVolume = sort(list, (a, b) => b.totalVolume - a.totalVolume);
      return {
        name: byVolume[0].main.keyword,
        clusterIds: byVolume.map((cluster) => cluster.id),
        totalVolume: list.reduce(
          (sum, cluster) => sum + cluster.totalVolume,
          0,
        ),
      };
    });
  return sort(hubs, (a, b) => b.totalVolume - a.totalVolume).map((hub, id) => ({
    id,
    ...hub,
  }));
}
