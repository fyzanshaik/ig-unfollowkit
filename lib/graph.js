// Graph data model helpers.
//
// Data shapes:
//   nodes: [{ pk, username, full_name, profile_pic_url, is_private, is_verified }]
//   edges: [{ from, to }]  // directed: "from follows to"
//   progress: { [nodePk]: [followerPk, ...] }  // per-mutual raw results during scan

// Build the final nodes+edges pair from accumulated per-node results.
//
// perNodeResults is a dict keyed by the target mutual's pk, where each value is
// the list of PKs returned by mutual_followers(target) — already filtered to
// my_following. We restrict edges to pairs where both endpoints are in the
// mutual set, since the graph is over mutuals only.
export function buildGraph(mutuals, perNodeResults) {
  const mutualSet = new Set(mutuals.map((m) => m.pk));
  const nodes = mutuals.map((m) => ({
    pk: m.pk,
    username: m.username,
    full_name: m.full_name || '',
    profile_pic_url: m.profile_pic_url || '',
    is_private: !!m.is_private,
    is_verified: !!m.is_verified,
  }));

  const seen = new Set();
  const edges = [];
  for (const [toPk, fromPks] of Object.entries(perNodeResults)) {
    if (!mutualSet.has(toPk)) continue;
    for (const fromPk of fromPks) {
      if (fromPk === toPk) continue;
      if (!mutualSet.has(fromPk)) continue;
      const key = `${fromPk}>${toPk}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: fromPk, to: toPk });
    }
  }

  return { nodes, edges, timestamp: new Date().toISOString() };
}

// Count in-network edges accumulated so far across all finished nodes.
export function countEdges(perNodeResults, mutualSet) {
  let n = 0;
  for (const [toPk, fromPks] of Object.entries(perNodeResults)) {
    if (!mutualSet.has(toPk)) continue;
    for (const fromPk of fromPks) {
      if (fromPk === toPk) continue;
      if (mutualSet.has(fromPk)) n++;
    }
  }
  return n;
}
