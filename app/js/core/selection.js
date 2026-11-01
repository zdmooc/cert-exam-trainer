// Stratégies de sélection des questions. Aucune règle propre à une
// certification : tout vient de la définition d'examen du pack.

import { shuffle, weightedSample } from './random.js';
import { statOf, difficulty, isDue, needsReview } from './progress.js';

export const STRATEGIES = ['sequential', 'random', 'adaptive', 'review'];

// Filtre la banque selon l'examen, les domaines, les séries et l'ensemble demandés.
export function filterPool(questions, { exam, domains = null, series = null, set = 'bank' } = {}) {
  return questions.filter(
    (q) => (!exam || q.exam === exam)
      && (!set || q.set === set)
      && (!domains?.length || domains.includes(q.domain))
      && (!series?.length || series.includes(q.series)),
  );
}

// Séries présentes dans la banque d'un examen (dans l'ordre déclaré par le pack).
export function listSeries(questions, examId, declared = []) {
  const present = new Set(questions.filter((q) => q.exam === examId && q.set === 'bank').map((q) => q.series ?? 'bank'));
  const ordered = declared.filter((s) => present.has(s.id));
  for (const id of present) if (!ordered.some((s) => s.id === id)) ordered.push({ id, label: id });
  return ordered;
}

// Poids du mode adaptatif : questions jamais vues, difficiles pour toi,
// ou arrivées à échéance de révision passent en premier.
export function adaptiveWeight(stat, now) {
  if (stat.seen === 0) return 3;
  let w = 0.3 + 3 * difficulty(stat);
  if (isDue(stat, now)) w += 1.5;
  if (stat.box >= 4 && !isDue(stat, now)) w *= 0.2;
  return w;
}

// Sélectionne `count` questions dans `pool`.
// - sequential : dans l'ordre de la banque, à partir de `offset`
// - random     : au hasard
// - adaptive   : pondéré par difficulté mesurée et échéance de révision
// - review     : uniquement les questions ratées non maîtrisées, les plus ratées d'abord
export function selectQuestions(pool, { strategy = 'random', count = 20, offset = 0, progress, rng, now = Date.now() }) {
  switch (strategy) {
    case 'sequential': {
      const start = ((offset % pool.length) + pool.length) % pool.length;
      return [...pool.slice(start), ...pool.slice(0, start)].slice(0, count);
    }
    case 'random':
      return shuffle(pool, rng).slice(0, count);
    case 'adaptive':
      return weightedSample(pool, (q) => adaptiveWeight(statOf(progress, q.id), now), count, rng);
    case 'review': {
      const due = pool.filter((q) => needsReview(statOf(progress, q.id)));
      return shuffle(due, rng)
        .sort((a, b) => difficulty(statOf(progress, b.id)) - difficulty(statOf(progress, a.id)))
        .slice(0, count);
    }
    default:
      throw new Error(`Stratégie inconnue : ${strategy}`);
  }
}

// Génère un examen blanc respectant la répartition officielle par domaine.
// En mode adaptatif, on privilégie dans chaque domaine les questions moins maîtrisées.
export function generateExam(questions, examDef, { rng, progress, adaptive = false, now = Date.now() }) {
  const picked = [];
  for (const d of examDef.domains) {
    const pool = filterPool(questions, { exam: examDef.id, domains: [d.id] });
    if (pool.length < d.count) throw new Error(`Banque insuffisante pour le domaine ${d.id}`);
    const chosen = adaptive
      ? weightedSample(pool, (q) => adaptiveWeight(statOf(progress, q.id), now), d.count, rng)
      : shuffle(pool, rng).slice(0, d.count);
    picked.push(...chosen);
  }
  return picked;
}

// Examen blanc figé (ex. « mock-03 ») dans son ordre d'origine.
export function fixedSet(questions, examId, set) {
  return questions.filter((q) => q.exam === examId && q.set === set).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function listFixedSets(questions, examId) {
  return [...new Set(questions.filter((q) => q.exam === examId && q.set !== 'bank').map((q) => q.set))].sort();
}
