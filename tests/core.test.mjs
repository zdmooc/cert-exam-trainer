import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createRng, shuffle } from '../app/js/core/random.js';
import { scoreQuestion, scoreSession } from '../app/js/core/scoring.js';
import { createSession, answer, finish, canReveal, isExpired } from '../app/js/core/session.js';
import { selectQuestions, generateExam, filterPool, fixedSet } from '../app/js/core/selection.js';
import { emptyProgress, recordAnswer, statOf, needsReview, difficulty } from '../app/js/core/progress.js';

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
