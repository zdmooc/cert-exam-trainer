// Progression par objectif d'apprentissage (ex. objectifs X2202 de TOGAF).
// Générique : un objectif est un identifiant porté par le tableau `los` des questions.
//
// Statut, par ordre de priorité :
//   1. « never »    jamais vu   : aucune réponse aux questions de l'objectif ;
//   2. « review »   à réviser   : au moins une question de l'objectif est à revoir (needsReview) ;
//   3. « acquired » acquis      : au moins 3 réponses et au moins 75 % de bonnes réponses ;
//   4. « learning » en cours    : sinon (moins de 3 réponses ou moins de 75 %).
// « À réviser » passe avant « acquis » : une erreur non corrigée l'emporte sur un bon taux global.

import { statOf, needsReview } from './progress.js';

export const OBJECTIVE_STATUSES = ['never', 'learning', 'review', 'acquired'];
export const MIN_ANSWERS = 3;
export const MIN_RATE = 0.75;

export function objectiveProgress(objectiveQuestions, progress) {
  let answers = 0;
  let correct = 0;
  let review = 0;
  for (const q of objectiveQuestions) {
    const s = statOf(progress, q);
    answers += s.seen;
    correct += s.correct;
    if (needsReview(s)) review++;
  }
  const rate = answers ? correct / answers : null;
  let status;
  if (answers === 0) status = 'never';
  else if (review > 0) status = 'review';
  else if (answers >= MIN_ANSWERS && rate >= MIN_RATE) status = 'acquired';
  else status = 'learning';
  return { status, answers, correct, rate, review, questions: objectiveQuestions.length };
}

// Index objectif → questions, à partir du champ `los` des questions.
export function questionsByObjective(questions) {
  const map = new Map();
  for (const q of questions) for (const lo of q.los ?? []) {
    if (!map.has(lo)) map.set(lo, []);
    map.get(lo).push(q);
  }
  return map;
}

// Statut de chaque objectif + décompte par statut.
export function summarizeObjectives(objectives, questions, progress) {
  const index = questionsByObjective(questions);
  const items = objectives.map((o) => ({ ...o, ...objectiveProgress(index.get(o.id) ?? [], progress) }));
  const counts = Object.fromEntries(OBJECTIVE_STATUSES.map((s) => [s, 0]));
  for (const it of items) if (it.questions > 0) counts[it.status]++;
  return { items, counts, withoutQuestions: items.filter((it) => it.questions === 0).length };
}
