import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createRng, shuffle } from '../app/js/core/random.js';
import { scoreQuestion, scoreSession } from '../app/js/core/scoring.js';
import { createSession, answer, finish, canReveal, isExpired, isAnswered, answeredCount } from '../app/js/core/session.js';
import { selectQuestions, generateExam, filterPool, fixedSet } from '../app/js/core/selection.js';
import { emptyProgress, recordAnswer, statOf, needsReview, difficulty } from '../app/js/core/progress.js';
import { questionRev } from '../content-pipeline/rev.mjs';

// Pack fictif, sans rapport avec TOGAF : le moteur ne doit dépendre d'aucune certification.
const pack = {
  exams: [{ id: 'demo', questionCount: 4, maxPoints: 4, passMark: 3, goMark: 4, domains: [{ id: 'x', count: 2 }, { id: 'y', count: 2 }] }],
};
const q = (id, domain, best = 'A', graded = false) => ({
  id, exam: 'demo', set: 'bank', domain, stem: id, explanation: '-',
  options: ['A', 'B', 'C', 'D'].map((k, i) => ({ key: k, text: k, points: graded ? [5, 3, 1, 0][(i + 'ABCD'.indexOf(best) * 3) % 4] : k === best ? 1 : 0 })),
});
const bank = [q('x1', 'x'), q('x2', 'x', 'B'), q('x3', 'x', 'C'), q('y1', 'y', 'D'), q('y2', 'y'), q('y3', 'y', 'B')];
const byId = new Map(bank.map((x) => [x.id, x]));

test('le générateur avec graine est reproductible', () => {
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], createRng(42)), shuffle([1, 2, 3, 4, 5], createRng(42)));
});

test('le mélange répartit la bonne réponse sur les 4 positions', () => {
  const rng = createRng(7);
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 4000; i++) {
    const s = createSession({ mode: 'training', exam: 'demo', questions: [bank[0]], rng });
    counts[s.items[0].order.indexOf('A')]++;
  }
  for (const c of counts) assert.ok(c > 850 && c < 1150, `répartition déséquilibrée : ${counts}`);
});

test('barème 1 point et barème gradué', () => {
  assert.equal(scoreQuestion(bank[0], 'A').points, 1);
  assert.equal(scoreQuestion(bank[0], 'B').correct, false);
  const graded = { options: [{ key: 'A', points: 3 }, { key: 'B', points: 5 }, { key: 'C', points: 1 }, { key: 'D', points: 0 }] };
  assert.deepEqual(
    ['A', 'B', 'C', 'D', null].map((k) => scoreQuestion(graded, k).points),
    [3, 5, 1, 0, 0],
  );
  assert.equal(scoreQuestion(graded, 'B').correct, true);
  assert.equal(scoreQuestion(graded, 'A').bestKey, 'B');
});

test('mode examen : aucune correction avant la fin', () => {
  let s = createSession({ mode: 'exam', exam: 'demo', questions: bank.slice(0, 4), rng: createRng(1), durationMinutes: 10, now: 0 });
  s = answer(s, 0, 'A', 1000);
  assert.equal(canReveal(s, 0), false);
  s = answer(s, 0, 'B', 2000); // changer d'avis est permis en examen
  assert.equal(s.items[0].answer, 'B');
  s = finish(s, 3000);
  assert.equal(s.status, 'finished');
  assert.equal(canReveal(s, 0), true);
  assert.throws(() => answer(s, 1, 'A'));
});

test('mode entraînement : correction immédiate et réponse figée', () => {
  let s = createSession({ mode: 'training', exam: 'demo', questions: bank.slice(0, 2), rng: createRng(1) });
  assert.equal(canReveal(s, 0), false);
  s = answer(s, 0, 'C');
  assert.equal(canReveal(s, 0), true);
  assert.equal(answer(s, 0, 'A').items[0].answer, 'C');
});

test('le temps écoulé termine l’examen', () => {
  let s = createSession({ mode: 'exam', exam: 'demo', questions: bank.slice(0, 2), rng: createRng(1), durationMinutes: 1, now: 0 });
  assert.equal(isExpired(s, 59_999), false);
  s = answer(s, 0, 'A', 61_000);
  assert.equal(s.status, 'finished');
  assert.equal(s.items[0].answer, null);
});

test('score de session, par domaine, et seuils ramenés à la taille', () => {
  let s = createSession({ mode: 'exam', exam: 'demo', questions: [bank[0], bank[1], bank[3], bank[4]], rng: createRng(3) });
  s = answer(s, 0, 'A'); s = answer(s, 1, 'B'); s = answer(s, 2, 'A'); s = answer(s, 3, 'A');
  const r = scoreSession(finish(s), byId, pack.exams[0]);
  assert.equal(r.total, 3);
  assert.equal(r.max, 4);
  assert.equal(r.passed, true);
  assert.equal(r.go, false);
  assert.deepEqual(r.byDomain.x, { points: 2, max: 2, correct: 2, count: 2 });
  const half = scoreSession(finish(createSession({ mode: 'training', exam: 'demo', questions: bank.slice(0, 2), rng: createRng(1) })), byId, pack.exams[0]);
  assert.equal(half.passMark, 2); // 3/4 ramené à 2 questions → ceil(1,5)
});

test('stratégies : séquentielle, aléatoire, par domaine', () => {
  assert.deepEqual(selectQuestions(bank, { strategy: 'sequential', count: 3, offset: 4 }).map((x) => x.id), ['y2', 'y3', 'x1']);
  assert.equal(new Set(selectQuestions(bank, { strategy: 'random', count: 6, rng: createRng(2) }).map((x) => x.id)).size, 6);
  assert.deepEqual(filterPool(bank, { exam: 'demo', domains: ['y'] }).map((x) => x.id), ['y1', 'y2', 'y3']);
});

test('révision : seules les questions ratées et non maîtrisées reviennent', () => {
  let p = emptyProgress();
  p = recordAnswer(p, 'x1', false, 0);
  p = recordAnswer(p, 'x2', true, 0);
  p = recordAnswer(p, 'y1', false, 0);
  p = recordAnswer(p, 'y1', true, 0);
  p = recordAnswer(p, 'y1', true, 0); // boîte 3 : maîtrisée
  const ids = selectQuestions(bank, { strategy: 'review', count: 10, progress: p, rng: createRng(1) }).map((x) => x.id);
  assert.deepEqual(ids, ['x1']);
  assert.equal(needsReview(statOf(p, 'y1')), false);
  assert.ok(difficulty(statOf(p, 'x1')) > difficulty(statOf(p, 'x2')));
});

test('adaptatif : les questions ratées sortent plus souvent que les maîtrisées', () => {
  let p = emptyProgress();
  for (let i = 0; i < 5; i++) { p = recordAnswer(p, 'x1', false, 0); p = recordAnswer(p, 'x2', true, 0); }
  const rng = createRng(9);
  let hard = 0, easy = 0;
  for (let i = 0; i < 2000; i++) {
    const [first] = selectQuestions([bank[0], bank[1]], { strategy: 'adaptive', count: 1, progress: p, rng, now: 0 });
    first.id === 'x1' ? hard++ : easy++;
  }
  assert.ok(hard > easy * 3, `adaptatif trop faible : ${hard} vs ${easy}`);
});

test('examen généré : répartition officielle respectée', () => {
  const exam = generateExam(bank, pack.exams[0], { rng: createRng(5), progress: emptyProgress() });
  assert.equal(exam.length, 4);
  assert.equal(exam.filter((x) => x.domain === 'x').length, 2);
});

// Contrôle du vrai pack TOGAF généré.
test('pack TOGAF : examens figés et générés conformes au format officiel', () => {
  const togaf = JSON.parse(readFileSync(new URL('../app/packs/togaf/pack.json', import.meta.url)));
  const qs = JSON.parse(readFileSync(new URL('../app/packs/togaf/questions.json', import.meta.url)));
  for (const def of togaf.exams) {
    const g = generateExam(qs, def, { rng: createRng(11), progress: emptyProgress() });
    assert.equal(g.length, def.questionCount);
    assert.equal(fixedSet(qs, def.id, 'mock-01').length, def.questionCount);
    const maxSum = g.reduce((s, x) => s + Math.max(...x.options.map((o) => o.points)), 0);
    assert.equal(maxSum, def.maxPoints);
  }
});

test('filtre par série et liste des séries présentes', async () => {
  const { listSeries } = await import('../app/js/core/selection.js');
  const mixed = [{ ...bank[0], series: 'bank' }, { ...bank[1], series: 'advanced' }, { ...bank[3], series: 'advanced' }];
  assert.deepEqual(filterPool(mixed, { exam: 'demo', series: ['advanced'] }).map((x) => x.id), ['x2', 'y1']);
  assert.deepEqual(listSeries(mixed, 'demo', [{ id: 'advanced', label: 'Avancé' }]).map((s) => s.id), ['advanced', 'bank']);
});

test('sauvegarde : export, lecture, fusion sans perte', async () => {
  const { exportProgress, parseProgressFile, mergeProgress, recordSession } = await import('../app/js/core/progress.js');
  let phone = emptyProgress();
  phone = recordAnswer(phone, 'x1', false, 100);
  phone = recordAnswer(phone, 'x2', true, 100);
  phone = recordSession(phone, { at: 100, label: 'Examen blanc 01', total: 30, max: 40 });
  const file = JSON.stringify(exportProgress('demo', phone, 200));

  assert.ok(parseProgressFile('pas du json', 'demo').error);
  assert.ok(parseProgressFile(file, 'autre-pack').error);
  const { progress } = parseProgressFile(file, 'demo');
  assert.deepEqual(progress.questions, phone.questions);

  let laptop = emptyProgress();
  laptop = recordAnswer(laptop, 'x1', true, 300); // plus récent : gagne
  laptop = recordAnswer(laptop, 'y1', true, 50);
  laptop = recordSession(laptop, { at: 100, label: 'Examen blanc 01', total: 30, max: 40 }); // doublon
  const merged = mergeProgress(laptop, progress);
  assert.equal(merged.questions.x1.lastAt, 300);
  assert.ok(merged.questions.x2 && merged.questions.y1);
  assert.equal(merged.sessions.length, 1);
});

// ---------- Lot 1 : fiabilité des scores ----------

test('rev : un changement de points rend la statistique obsolète', async () => {
  const { isStale } = await import('../app/js/core/progress.js');
  let p = emptyProgress();
  p = recordAnswer(p, { id: 's9', rev: 'aaaa1111' }, true, 0);
  p = recordAnswer(p, { id: 's9', rev: 'aaaa1111' }, true, 0);
  p = recordAnswer(p, { id: 's9', rev: 'aaaa1111' }, true, 0);
  assert.equal(statOf(p, { id: 's9', rev: 'aaaa1111' }).box, 4);
  // Nouveau barème → nouvelle empreinte : la question repart de zéro.
  assert.equal(statOf(p, { id: 's9', rev: 'bbbb2222' }).seen, 0);
  assert.equal(isStale(p.questions.s9, 'bbbb2222'), true);
  p = recordAnswer(p, { id: 's9', rev: 'bbbb2222' }, false, 1);
  assert.deepEqual([p.questions.s9.seen, p.questions.s9.rev], [1, 'bbbb2222']);
});

test('rev : changer seulement une justification ne remet pas à zéro', () => {
  const base = { id: 'q1', stem: 'Énoncé', options: [{ key: 'A', text: 'a', points: 1 }, { key: 'B', text: 'b', points: 0 }] };
  const revA = questionRev(base);
  const reworded = { ...base, options: [{ ...base.options[0], rationale: 'nouvelle justification' }, base.options[1]], explanation: 'autre' };
  assert.equal(questionRev(reworded), revA);
  const rescored = { ...base, options: [{ ...base.options[0], points: 0 }, { ...base.options[1], points: 1 }] };
  assert.notEqual(questionRev(rescored), revA);
  let p = recordAnswer(emptyProgress(), { id: 'q1', rev: revA }, true, 0);
  assert.equal(statOf(p, { id: 'q1', rev: questionRev(reworded) }).seen, 1);
  assert.equal(statOf(p, { id: 'q1', rev: questionRev(rescored) }).seen, 0);
});

test('migration : anciennes statistiques sans rev conservées, sauf les questions déclarées', async () => {
  const { applyResets } = await import('../app/js/core/progress.js');
  const legacy = { version: 1, sessions: [], questions: { s9: { seen: 3, correct: 3, wrong: 0, box: 4, lastAt: 1 }, q1: { seen: 2, correct: 2, wrong: 0, box: 3, lastAt: 1 } } };
  const resets = [{ id: 'reset-1', questions: ['s9'] }];
  const once = applyResets(legacy, resets);
  assert.deepEqual(Object.keys(once.questions), ['q1']);
  assert.deepEqual(once.migrations, ['reset-1']);
  // Ré-appliquée : sans effet, même sur une nouvelle réponse enregistrée depuis.
  const again = applyResets(recordAnswer(once, { id: 's9', rev: 'new' }, true, 2), resets);
  assert.equal(again.questions.s9.seen, 1);
});

test('import : mêmes règles (rev obsolète ignorée, remise à zéro du pack appliquée)', async () => {
  const { mergeProgress } = await import('../app/js/core/progress.js');
  const device = recordAnswer(emptyProgress(), { id: 'x1', rev: 'r-new' }, true, 10);
  const oldBackup = { version: 1, sessions: [], questions: {
    x1: { seen: 9, correct: 9, wrong: 0, box: 5, lastAt: 99, rev: 'r-old' }, // ancienne version, plus récente
    s9: { seen: 4, correct: 4, wrong: 0, box: 5, lastAt: 5 }, // sans rev, question re-notée
    q2: { seen: 1, correct: 1, wrong: 0, box: 2, lastAt: 5 }, // sans rev, conservée
  } };
  const merged = mergeProgress(device, oldBackup, {
    revById: new Map([['x1', 'r-new'], ['s9', 'r-s9'], ['q2', 'r-q2']]),
    resets: [{ id: 'reset-1', questions: ['s9'] }],
  });
  assert.equal(merged.questions.x1.rev, 'r-new');
  assert.equal(merged.questions.s9, undefined);
  assert.equal(merged.questions.q2.seen, 1);
});

test('prêt à réserver : 3 examens blancs consécutifs au-dessus de l’objectif', async () => {
  const { bookingReadiness } = await import('../app/js/core/progress.js');
  const def = { id: 'f101', maxPoints: 40, goMark: 32 };
  const ex = (at, total, extra = {}) => ({ at, exam: 'f101', mode: 'exam', total, max: 40, ...extra });
  assert.deepEqual(bookingReadiness([ex(1, 39)], def), { ready: false, streak: 1, required: 3, examsTaken: 1 });
  assert.equal(bookingReadiness([ex(1, 33), ex(2, 25), ex(3, 34), ex(4, 32)], def).streak, 2);
  // Entraînement et autre examen ignorés ; ordre chronologique respecté.
  const mixed = [ex(5, 35), ex(1, 20), ex(3, 36), { at: 4, exam: 'f101', mode: 'training', total: 2, max: 10 }, ex(2, 33), ex(6, 10, { exam: 'f102' })];
  assert.deepEqual(bookingReadiness(mixed, def), { ready: true, streak: 3, required: 3, examsTaken: 4 });
  assert.equal(bookingReadiness([ex(1, 40), ex(2, 40), ex(3, 31)], def).streak, 0);
});

// ---------- Lot 2 : progression par objectif ----------

test('objectif : jamais vu, en cours, à réviser, acquis', async () => {
  const { objectiveProgress, summarizeObjectives } = await import('../app/js/core/objectives.js');
  const qa = { id: 'o1', rev: 'r1', los: ['L1.1.1'] };
  const qb = { id: 'o2', rev: 'r2', los: ['L1.1.1', 'L1.1.2'] };
  let p = emptyProgress();
  assert.equal(objectiveProgress([qa, qb], p).status, 'never');
  p = recordAnswer(p, qa, true, 0);
  p = recordAnswer(p, qb, true, 0);
  assert.equal(objectiveProgress([qa, qb], p).status, 'learning'); // 2 réponses < 3
  p = recordAnswer(p, qa, true, 0);
  assert.equal(objectiveProgress([qa, qb], p).status, 'acquired'); // 3 réponses, 100 %
  p = recordAnswer(p, qb, false, 0);
  assert.equal(objectiveProgress([qa, qb], p).status, 'review'); // erreur non corrigée
  p = recordAnswer(p, qb, true, 0);
  p = recordAnswer(p, qb, true, 0); // qb remonte en boîte 3 : plus à revoir
  const r = objectiveProgress([qa, qb], p);
  assert.deepEqual([r.status, r.answers, r.correct], ['acquired', 6, 5]); // 83 %
  const qc = { id: 'o3', rev: 'r3', los: ['L1.1.3'] };
  let p3 = recordAnswer(emptyProgress(), qc, false, 0);
  p3 = recordAnswer(p3, qc, true, 0);
  p3 = recordAnswer(p3, qc, true, 0); // boîte 3 (plus à revoir) mais 2/3 = 67 % < 75 %
  assert.equal(objectiveProgress([qc], p3).status, 'learning');
  let p4 = p3;
  p4 = recordAnswer(p4, qc, true, 0); // 3/4 = 75 % : seuil atteint
  assert.equal(objectiveProgress([qc], p4).status, 'acquired');
  const sum = summarizeObjectives([{ id: 'L1.1.1' }, { id: 'L1.1.2' }, { id: 'L1.8.1' }], [qa, qb], p);
  assert.equal(sum.withoutQuestions, 1);
  assert.equal(sum.items.find((i) => i.id === 'L1.1.2').questions, 1);
});

test('objectif : une statistique d’une ancienne version de question ne compte pas', async () => {
  const { objectiveProgress } = await import('../app/js/core/objectives.js');
  let p = emptyProgress();
  for (let i = 0; i < 3; i++) p = recordAnswer(p, { id: 'o1', rev: 'old' }, true, 0);
  assert.equal(objectiveProgress([{ id: 'o1', rev: 'old' }], p).status, 'acquired');
  assert.equal(objectiveProgress([{ id: 'o1', rev: 'new' }], p).status, 'never');
});

// ---------- Questions à plusieurs réponses (select) ----------

const multi = {
  id: 'm1', exam: 'demo', set: 'bank', domain: 'x', stem: 'Deux réponses', explanation: '-', select: 2,
  options: [{ key: 'A', text: 'A', points: 1 }, { key: 'B', text: 'B', points: 0 }, { key: 'C', text: 'C', points: 1 }, { key: 'D', text: 'D', points: 0 }],
};

test('plusieurs réponses : 1 point seulement si toutes les bonnes options sont choisies', () => {
  assert.deepEqual(scoreQuestion(multi, ['C', 'A']).points, 1);
  assert.equal(scoreQuestion(multi, ['A', 'B']).correct, false);
  assert.equal(scoreQuestion(multi, ['A']).answered, false);
  assert.equal(scoreQuestion(multi, ['A']).points, 0);
  assert.equal(scoreQuestion(multi, null).answered, false);
  assert.deepEqual(scoreQuestion(multi, null).bestKeys, ['A', 'C']);
  assert.deepEqual(scoreQuestion(bank[1], 'B').bestKeys, ['B']);
});

test('plusieurs réponses : cocher, décocher, limite et correction en entraînement', () => {
  let s = createSession({ mode: 'training', exam: 'demo', questions: [multi], rng: createRng(1) });
  s = answer(s, 0, 'A');
  assert.deepEqual(s.items[0].answer, ['A']);
  assert.equal(isAnswered(s.items[0]), false);
  assert.equal(canReveal(s, 0), false);
  s = answer(s, 0, 'A');
  assert.equal(s.items[0].answer, null, 'décocher la seule option vide la réponse');
  s = answer(answer(s, 0, 'A'), 0, 'B');
  assert.equal(isAnswered(s.items[0]), true);
  assert.equal(canReveal(s, 0), true);
  assert.deepEqual(answer(s, 0, 'C').items[0].answer, ['A', 'B'], 'réponse figée une fois complète');
});

test('plusieurs réponses : en examen, pas plus que le nombre demandé', () => {
  let s = createSession({ mode: 'exam', exam: 'demo', questions: [multi, bank[0]], rng: createRng(2), durationMinutes: 10, now: 0 });
  s = answer(answer(s, 0, 'A', 1), 0, 'C', 1);
  assert.deepEqual(answer(s, 0, 'B', 1).items[0].answer, ['A', 'C']);
  s = answer(answer(s, 0, 'C', 1), 0, 'D', 1);
  assert.deepEqual(s.items[0].answer, ['A', 'D']);
  assert.equal(answeredCount(s), 1);
  s = finish(answer(s, 1, 'A', 1), 2);
  const r = scoreSession(s, new Map([[multi.id, multi], [bank[0].id, bank[0]]]));
  assert.equal(r.total, 1);
  assert.equal(r.max, 2);
});

test('pack sans seuil officiel : pas de verdict réussi/échoué, objectif conservé', () => {
  let s = createSession({ mode: 'exam', exam: 'demo', questions: [bank[0]], rng: createRng(3) });
  s = finish(answer(s, 0, 'A'));
  const r = scoreSession(s, byId, { maxPoints: 10, passMark: null, goMark: 8 });
  assert.equal(r.passed, null);
  assert.equal(r.go, true);
});
