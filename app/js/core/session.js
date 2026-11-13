// Session d'entraînement ou d'examen blanc : une machine à états pure.
//
//   in_progress ──answer()──▶ in_progress
//        │
//        └──finish() / temps écoulé──▶ finished
//
// - mode « training » : la correction est visible dès qu'une question est répondue.
// - mode « exam »     : aucune correction avant l'état « finished », chronomètre.
//
// Les options sont mélangées à la création de la session : la position d'origine
// de la bonne réponse ne donne donc aucun indice.

import { shuffle } from './random.js';
import { scoreQuestion } from './scoring.js';

export function createSession({ mode, exam, questions, rng, durationMinutes = null, label = '', now = Date.now() }) {
  if (!['training', 'exam'].includes(mode)) throw new Error(`Mode inconnu : ${mode}`);
  if (!questions.length) throw new Error('Aucune question à proposer');
  return {
    id: `${now.toString(36)}-${Math.floor(rng() * 1e6).toString(36)}`,
    mode,
    exam,
    label,
    status: 'in_progress',
    startedAt: now,
    finishedAt: null,
    deadline: mode === 'exam' && durationMinutes ? now + durationMinutes * 60_000 : null,
    current: 0,
    items: questions.map((q) => ({
      questionId: q.id,
      order: shuffle(q.options.map((o) => o.key), rng),
      ...(q.select > 1 ? { select: q.select } : {}),
      answer: null,
      flagged: false,
    })),
  };
}

// Une question à plusieurs réponses (`select`) est répondue quand le nombre
// d'options demandé est coché ; sa réponse est alors un tableau de lettres.
export function isAnswered(item) {
  if (item.select > 1) return Array.isArray(item.answer) && item.answer.length === item.select;
  return item.answer !== null;
}

export function isExpired(session, now = Date.now()) {
  return session.deadline !== null && now >= session.deadline;
}

export function remainingMs(session, now = Date.now()) {
  return session.deadline === null ? null : Math.max(0, session.deadline - now);
}

// La correction d'une question est-elle visible ?
export function canReveal(session, index) {
  if (session.status === 'finished') return true;
  return session.mode === 'training' && isAnswered(session.items[index]);
}

export function answer(session, index, optionKey, now = Date.now()) {
  if (session.status !== 'in_progress') throw new Error('Session terminée');
  if (isExpired(session, now)) return finish(session, now);
  const item = session.items[index];
  if (!item) throw new Error(`Question ${index} inexistante`);
  if (!item.order.includes(optionKey)) throw new Error(`Option ${optionKey} inconnue`);
  if (session.mode === 'training' && isAnswered(item)) return session; // réponse figée en entraînement
  let value = optionKey;
  if (item.select > 1) {
    // Cocher / décocher ; au-delà du nombre demandé, il faut d'abord décocher.
    const cur = Array.isArray(item.answer) ? item.answer : [];
    if (cur.includes(optionKey)) value = cur.filter((k) => k !== optionKey);
    else if (cur.length < item.select) value = [...cur, optionKey];
    else return session;
    if (!value.length) value = null;
  }
  const items = session.items.map((it, i) => (i === index ? { ...it, answer: value } : it));
  return { ...session, items };
}

export function toggleFlag(session, index) {
  const items = session.items.map((it, i) => (i === index ? { ...it, flagged: !it.flagged } : it));
  return { ...session, items };
}

export function goTo(session, index) {
  const current = Math.max(0, Math.min(session.items.length - 1, index));
  return { ...session, current };
}

export function finish(session, now = Date.now()) {
  if (session.status === 'finished') return session;
  const finishedAt = session.deadline !== null ? Math.min(now, session.deadline) : now;
  return { ...session, status: 'finished', finishedAt };
}

export function answeredCount(session) {
  return session.items.filter(isAnswered).length;
}

// Résultat par question, une fois la correction visible.
export function itemResult(session, index, questionsById) {
  const item = session.items[index];
  return scoreQuestion(questionsById.get(item.questionId), item.answer);
}
