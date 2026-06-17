// L2 lifecycle / forgetting (§8, D11). Deterministic — no LLM.
// Removes episodes that are low-importance AND old AND never re-accessed. Reflections are the
// compressed memory of what gets forgotten, so they are always retained.

import CONFIG from '../config.mjs';

const MS_PER_DAY = 86_400_000;

export function prune(repo, config = CONFIG, opts = {}) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - config.prune.ageDays * MS_PER_DAY).toISOString();

  const pruned = repo.pruneColdEpisodes(config.prune.importanceFloor, cutoff);
  repo.audit('prune', `${pruned} episodes (importance < ${config.prune.importanceFloor}, cold before ${cutoff})`);

  return { pruned, cutoff };
}
