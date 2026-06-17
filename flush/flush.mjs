// L1 → L2 flush (§4). Cold path. Takes a page of raw events, rates them in ONE batched model
// call (importance + NL description + outcome), embeds the descriptions, and writes episodes.
// Also advances the reflection accumulator (Σ importance) and reports when it crosses θ.
//
// Dependencies are injected (D13/D14) so this orchestration is testable with fakes:
//   llm.rateBatch(events)      -> Promise<[{ nl_description, importance, outcome }]>
//   embedder.embedBatch(texts) -> Promise<number[][]>

import CONFIG from '../config.mjs';

const ACCUM_KEY = 'reflect_accum';

export async function flushPage(repo, { llm, embedder }, config = CONFIG) {
  const batch = repo.takeFlushBatch(config.pageSize);
  if (batch.length === 0) return { flushed: 0, accum: readAccum(repo), reflectionDue: false };

  const ratings = await llm.rateBatch(batch);
  const descriptions = batch.map((_, i) => ratings[i]?.nl_description ?? '');
  const vectors = await embedder.embedBatch(descriptions);

  let addedImportance = 0;
  repo.db.exec('BEGIN');
  try {
    batch.forEach((evt, i) => {
      const r = ratings[i] ?? {};
      const importance = clampImportance(r.importance);
      addedImportance += importance;
      repo.insertEpisode({
        session_id: evt.session_id,
        created_at: evt.ts,
        act_type: evt.act_type,
        thought_kind: evt.thought_kind,
        text: r.nl_description ?? evt.input_digest ?? '',
        importance,
        outcome: r.outcome ?? 'neutral',
        embedding: vectors[i] ?? [],
        source_event_ids: [evt.transcript_uuid ?? evt.id],
      });
    });
    repo.db.exec('COMMIT');
  } catch (err) {
    repo.db.exec('ROLLBACK');
    throw err;
  }

  const accum = readAccum(repo) + addedImportance;
  repo.metaSet(ACCUM_KEY, accum);
  repo.audit('flush', `${batch.length} events, +${addedImportance.toFixed(1)} importance`);

  return {
    flushed: batch.length,
    accum,
    reflectionDue: accum >= config.reflection.thematicThreshold,
  };
}

function readAccum(repo) {
  return Number.parseFloat(repo.metaGet(ACCUM_KEY) ?? '0') || 0;
}

function clampImportance(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}
