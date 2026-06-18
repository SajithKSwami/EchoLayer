// Deterministic fake rater — used when no Anthropic key is set, and in tests. 0 cost.
// Failures rate high (Reflexion: you must learn from them).

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
};
