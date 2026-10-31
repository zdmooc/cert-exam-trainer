// Suivi de progression par question, indépendant de toute certification.
// La difficulté n'est pas saisie : elle est mesurée à partir des réponses.
// La révision des erreurs suit un système de boîtes de Leitner.

const DAY = 24 * 60 * 60 * 1000;
export const BOX_INTERVAL_DAYS = [0, 0, 1, 3, 7, 14]; // index = boîte (1 à 5)
export const MAX_BOX = 5;

export function emptyProgress() {
  return { version: 1, questions: {}, sessions: [] };
}

export function statOf(progress, id) {
  return progress.questions[id] ?? { seen: 0, correct: 0, wrong: 0, box: 0, lastAt: 0, lastCorrect: null };
}

// Enregistre une réponse. `correct` = la meilleure option a été choisie.
export function recordAnswer(progress, id, correct, now = Date.now()) {
  const s = statOf(progress, id);
  const next = {
    seen: s.seen + 1,
    correct: s.correct + (correct ? 1 : 0),
    wrong: s.wrong + (correct ? 0 : 1),
    box: correct ? Math.min(MAX_BOX, Math.max(1, s.box) + 1) : 1,
    lastAt: now,
    lastCorrect: correct,
  };
  return { ...progress, questions: { ...progress.questions, [id]: next } };
}

// Difficulté mesurée entre 0 (facile) et 1 (difficile), lissée pour les
// questions peu vues (une question jamais vue vaut 0,5).
export function difficulty(stat) {
  return (stat.wrong + 1) / (stat.seen + 2);
}

export function isDue(stat, now = Date.now()) {
  if (stat.seen === 0) return false;
  return now - stat.lastAt >= BOX_INTERVAL_DAYS[stat.box] * DAY;
}

// « À revoir » : déjà ratée au moins une fois et pas encore maîtrisée (boîte < 3).
export function needsReview(stat) {
  return stat.wrong > 0 && stat.box < 3;
}

export function recordSession(progress, summary) {
  const sessions = [...progress.sessions, summary].slice(-200);
  return { ...progress, sessions };
}
