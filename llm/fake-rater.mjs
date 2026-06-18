// Deterministic fake llm — used when no key is set, and in tests. 0 cost. Implements the full
// interface: rateBatch + reflectThematic + reflectCorrective. Failures rate high (Reflexion).

export const fakeRater = {
  model: 'fake',
  live: false,
  async rateBatch(events) {
    return events.map((e) => ({
      nl_description: `did ${e.tool_name ?? e.act_type}`,
      importance: e.status === 'error' ? 9 : 4,
      outcome: e.status === 'error' ? 'fail' : 'success',
    }));
  },
  async reflectThematic(episodes) {
    if (episodes.length === 0) return [];
    return [{ text: `pattern across ${episodes.length} episodes`, importance: 5, evidence_ids: episodes.map((e) => e.id) }];
  },
  async reflectCorrective(slice) {
    return { text: `avoid repeating ${slice.length} failing steps`, importance: 9, evidence_ids: slice.map((r) => r.id) };
  },
};
