// Barème générique : chaque option porte un nombre de points.
// - QCM simple : 1 point pour la bonne réponse, 0 sinon.
// - Barème gradué (TOGAF Practitioner) : 5 / 3 / 1 / 0.
// Le moteur ne connaît pas ces cas : il additionne les points du pack.

// - Plusieurs réponses (`select: n`) : 1 point si exactement les n bonnes options
//   sont choisies, 0 sinon (pas de point partiel).
export function scoreQuestion(question, chosen) {
  if (isMulti(question)) {
    const bestKeys = question.options.filter((o) => o.points > 0).map((o) => o.key);
    const picked = Array.isArray(chosen) ? chosen : [];
    const answered = picked.length === question.select;
    const correct = answered && picked.every((k) => bestKeys.includes(k));
    return { answered, points: correct ? 1 : 0, max: 1, correct, bestKey: bestKeys[0], bestKeys };
  }
  const max = Math.max(...question.options.map((o) => o.points));
  const chosenOpt = question.options.find((o) => o.key === chosen) ?? null;
  const points = chosenOpt ? chosenOpt.points : 0;
  const bestKey = question.options.find((o) => o.points === max).key;
  return {
    answered: chosenOpt !== null,
    points,
    max,
    correct: chosenOpt !== null && points === max,
    bestKey,
    bestKeys: [bestKey],
  };
}

// Question à plusieurs réponses : le pack indique combien d'options choisir.
export function isMulti(question) {
  return Number.isInteger(question.select) && question.select > 1;
}

// Score d'une session terminée, global et par domaine.
export function scoreSession(session, questionsById, examDef = null) {
  let total = 0;
  let max = 0;
  const byDomain = {};
  for (const item of session.items) {
    const q = questionsById.get(item.questionId);
    const r = scoreQuestion(q, item.answer);
    total += r.points;
    max += r.max;
    const d = (byDomain[q.domain] ??= { points: 0, max: 0, correct: 0, count: 0 });
    d.points += r.points;
    d.max += r.max;
    d.count += 1;
    d.correct += r.correct ? 1 : 0;
  }
  // Seuils exprimés sur le maximum officiel (ex. 24/40), ramenés à la taille
  // réelle de la session (ex. une série de 20 questions → 12/20).
  const scale = (mark) => (examDef?.maxPoints && mark != null ? Math.ceil((mark / examDef.maxPoints) * max) : null);
  const passMark = scale(examDef?.passMark);
  const goMark = scale(examDef?.goMark);
  return {
    total,
    max,
    percent: max ? Math.round((100 * total) / max) : 0,
    byDomain,
    passMark,
    goMark,
    passed: passMark === null ? null : total >= passMark,
    go: goMark === null ? null : total >= goMark,
  };
}
