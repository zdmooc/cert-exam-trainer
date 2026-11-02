#!/usr/bin/env node
// Convertit le contenu Markdown du dépôt togaf-ogea-103-combined-certification-prep
// en un pack de questions au format générique du moteur (docs/architecture/03-data.md).
//
// Usage : node content-pipeline/togaf/build.mjs <chemin-du-depot-source> [dossier-de-sortie]
//
// Formats pris en charge :
//  - questions avec réponse intégrée (« **Réponse : B.** », « **Scoring : A=5, …** ») ;
//  - séries d'exercices dont les corrections sont dans un fichier « NN-…-corrections.md » ;
//  - examens blancs (Part 1 : clé « 1. **B** — … » ; Part 2 : sections « ## P1 » avec barème).
// Pour chaque option, la justification (« Distracteur B : », « - **B — 3 points :** … »)
// est conservée quand elle existe.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { questionRev } from '../rev.mjs';

const src = process.argv[2];
const out = resolve(process.argv[3] ?? 'app/packs/togaf');
if (!src) {
  console.error('Usage : node content-pipeline/togaf/build.mjs <dépôt-source> [sortie]');
  process.exit(1);
}

const read = (p) => readFileSync(join(src, p), 'utf8').replace(/\r\n/g, '\n');
const filesIn = (dir) => readdirSync(join(src, dir)).filter((f) => /^\d\d-.*\.md$/.test(f) && !f.startsWith('00-')).sort();

// ---------- Domaines ----------

const L1_UNIT = { 1: 'concepts', 2: 'concepts', 3: 'adm', 4: 'techniques', 5: 'applying', 6: 'governance', 7: 'content', 8: 'concepts' };
const L2_UNIT = { 1: 'context', 2: 'stakeholders', 3: 'phase-a', 4: 'bcd', 5: 'efg', 6: 'phase-h', 7: 'requirements', 8: 'supporting' };
const F101_FILE_DOMAIN = { '01': 'concepts', '02': 'adm', '03': 'adm', '04': 'adm', '05': 'techniques', '06': 'applying', '07': 'governance', '08': 'content' };
const F102_FILE_DOMAIN = { '01': 'context', '02': 'stakeholders', '03': 'phase-a', '04': 'bcd', '05': 'efg', '06': 'phase-h', '07': 'requirements', '08': 'supporting' };
const MOCK_F102_ORDER = ['context', 'stakeholders', 'phase-a', 'bcd', 'efg', 'phase-h', 'requirements', 'supporting'];

// Séries complémentaires (fichier questions + fichier corrections de même préfixe).
const SERIES = {
  '09-foundation-question-bank': {
    '09': { id: 'advanced', label: 'Exercices discriminants', exam: 'f101' },
    '10': { id: 'x2202-targeted', label: 'Ciblés X2202', exam: 'f101' },
    '11': { id: 'deliverables', label: 'Les 16 livrables', exam: 'f101', domain: 'content' },
  },
  '10-practitioner-scenarios': {
    '09': { id: 'multi-constraint', label: 'Ateliers multi-contraintes', exam: 'f102' },
    '10': { id: 'x2202-targeted', label: 'Cas ciblés X2202', exam: 'f102' },
    '11': { id: 'x2202-coverage', label: 'Couverture X2202', exam: 'f102' },
    '12': { id: 'conformance', label: 'Conformité et migration', exam: 'f102' },
  },
};

// Objectif d'apprentissage X2202 → { level, unit, label }.
function learningOutcome(text) {
  let m = text.match(/\bL([12])\.(\d)\.(\d+)/);
  if (m) return { level: +m[1], unit: +m[2], label: `L${m[1]}.${m[2]}.${m[3]}` };
  m = text.match(/\bL([12]) U(\d)(?: (\d+)\.(\d+))?/);
  if (m) return { level: +m[1], unit: +m[2], label: m[4] ? `L${m[1]}.${m[2]}.${m[4]}` : `L${m[1]} U${m[2]}` };
  m = text.match(/\bL([12]) (\d)\.(\d+)/);
  if (m) return { level: +m[1], unit: +m[2], label: `L${m[1]}.${m[2]}.${m[3]}` };
  m = text.match(/§3\.([12])\.(\d)(?:.*?LO (\d+)\.(\d+))?/);
  if (m) return { level: +m[1], unit: +m[2], label: m[4] ? `L${m[1]}.${m[2]}.${m[4]}` : `L${m[1]} U${m[2]}` };
  return null;
}
// Un scénario Practitioner peut viser un objectif de niveau 1 : on le range dans le domaine L2 le plus proche.
const L1_TO_L2 = { 1: 'context', 2: 'context', 3: 'phase-a', 4: 'supporting', 5: 'context', 6: 'efg', 7: 'supporting', 8: 'context' };
const domainFromLo = (lo, exam) => {
  if (!lo) return null;
  if (exam === 'f102') return lo.level === 2 ? L2_UNIT[lo.unit] : L1_TO_L2[lo.unit];
  return lo.level === 1 ? L1_UNIT[lo.unit] : null;
};
// Examens blancs Part 1 : la position de la question donne son domaine (répartition officielle 8/14/6/4/3/5).
const MOCK_F101_ORDER = [[8, 'concepts'], [14, 'adm'], [6, 'techniques'], [4, 'applying'], [3, 'governance'], [5, 'content']];
function mockF101Domain(n) {
  let acc = 0;
  for (const [count, d] of MOCK_F101_ORDER) { acc += count; if (n <= acc) return d; }
  return null;
}

// ---------- Texte ----------

// Markdown léger → texte brut (l'appli affiche du texte, pas du HTML).
const plain = (s) =>
  String(s ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Sépare une section « ## ID — titre » : énoncé, bloc d'options, reste.
function splitQuestion(body, ctx) {
  const start = body.search(/^A\.\s/m);
  if (start < 0) throw new Error(`${ctx} : pas de ligne « A. »`);
  const rest = body.slice(start);
  const end = rest.search(/^\*\*(Réponse|Scoring|Justification)|^---\s*$/m);
  return {
    stem: plain(body.slice(0, start)),
    optBlock: end < 0 ? rest : rest.slice(0, end),
    after: end < 0 ? '' : rest.slice(end),
  };
}

// « A. …  B. … » sur une ligne, ou une option par ligne (avec ou sans ligne vide).
function parseOptions(block, ctx) {
  const flat = '  ' + block.replace(/\n/g, '  ');
  const re = /(?:^|\s{2,})([A-D])\.\s/g;
  const marks = [];
  let m;
  let expected = 0;
  while ((m = re.exec(flat))) {
    if (m[1] === 'ABCD'[expected]) {
      marks.push({ key: m[1], start: m.index + m[0].length, at: m.index });
      if (++expected === 4) break;
    }
  }
  if (marks.length !== 4) throw new Error(`${ctx} : options A–D introuvables`);
  return marks.map((mk, i) => ({ key: mk.key, text: plain(flat.slice(mk.start, i < 3 ? marks[i + 1].at : undefined)) }));
}

function parsePoints(text) {
  const pts = {};
  for (const m of text.matchAll(/\b([A-D])\s*=\s*(\d)\b/g)) if (!(m[1] in pts)) pts[m[1]] = Number(m[2]);
  return Object.keys(pts).length === 4 ? pts : null;
}

// Justifications par option, quels que soient les formats rencontrés.
function parseRationales(text, options) {
  const r = {};
  for (const m of text.matchAll(/^\*\*Distracteur ([A-D])\s*:\*\*\s*(.+)$/gm)) r[m[1]] = m[2];
  for (const m of text.matchAll(/^-\s+\*\*([A-D])\b[^*\n]*\*\*\s*[:.]?\s*(.+)$/gm)) r[m[1]] = m[2];
  for (const k of Object.keys(r)) {
    let t = plain(r[k]);
    const opt = options.find((o) => o.key === k);
    // Beaucoup de justifications recopient l'option avant d'expliquer : on retire la redite.
    if (opt && t.startsWith(opt.text.replace(/\.$/, ''))) t = t.slice(opt.text.replace(/\.$/, '').length).replace(/^[\s.:;—-]+/, '');
    t = t.replace(/\s+([.,;:])/g, '$1');
    if (t) r[k] = t.charAt(0).toUpperCase() + t.slice(1); else delete r[k];
  }
  return r;
}

// Explication générale : paragraphes hors listes et hors lignes de métadonnées.
function generalExplanation(text) {
  const keep = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l === '---' || l.startsWith('- ') || l.startsWith('#')) continue;
    if (/^\*\*(Distracteur|Mapping|Référence|Source|Syllabus|Contenu|Learning outcome|Barème|Scoring|Justification)/.test(l)) continue;
    keep.push(l.replace(/^\*\*Réponse\s*:\s*[A-D]\.?\*\*\s*/, '').replace(/^\*\*Pourquoi [A-D][^*]*:\*\*\s*/, ''));
  }
  return plain(keep.join(' '));
}

const mapping = (text) => plain((text.match(/^\*\*Mapping[^:]*:\*?\*?\s*(.*?)\.?(\*\*)?\s*$/m) ?? [])[1] ?? '').replace(/\.$/, '');

function finalize(q, ctx) {
  const max = Math.max(...q.options.map((o) => o.points));
  if (!q.explanation) {
    const best = q.options.find((o) => o.points === max);
    q.explanation = best?.rationale ?? '';
  }
  for (const o of q.options) if (!o.rationale) delete o.rationale;
  if (!q.lo) delete q.lo;
  if (!q.domain) throw new Error(`${ctx} : domaine introuvable`);
  q.rev = questionRev(q);
  questions.push(q);
}

function buildOptions(optBlock, after, points, ctx) {
  const opts = parseOptions(optBlock, ctx);
  const rat = parseRationales(after, opts);
  return opts.map((o) => ({ key: o.key, text: o.text, points: points[o.key], ...(rat[o.key] ? { rationale: rat[o.key] } : {}) }));
}

const sections = (text, idRe) => text.split(new RegExp(`^## (?=${idRe})`, 'm')).slice(1).map((chunk) => {
  const nl = chunk.indexOf('\n');
  return { head: chunk.slice(0, nl).trim(), body: chunk.slice(nl + 1).replace(/\n---\s*(\n|$)[\s\S]*$/, '\n') };
});

const questions = [];

// ---------- 1. Banque Foundation Q001–Q300 (réponse intégrée) ----------

for (const file of filesIn('09-foundation-question-bank').filter((f) => /^0[1-8]-/.test(f))) {
  const domain = F101_FILE_DOMAIN[file.slice(0, 2)];
  for (const { head, body } of sections(read(join('09-foundation-question-bank', file)), 'Q\\d{3}')) {
    const [, num, title] = head.match(/^Q(\d{3})\s*—\s*(.*)$/);
    const ctx = `${file} Q${num}`;
    const { stem, optBlock, after } = splitQuestion(body, ctx);
    const correct = (after.match(/\*\*Réponse\s*:\s*([A-D])/) ?? [])[1];
    if (!correct) throw new Error(`${ctx} : réponse introuvable`);
    finalize({
      id: `togaf-f101-q${num}`, exam: 'f101', set: 'bank', series: 'bank', domain, title: plain(title), stem,
      options: buildOptions(optBlock, after, { A: 0, B: 0, C: 0, D: 0, [correct]: 1 }, ctx),
      explanation: generalExplanation(after), topic: mapping(after), lo: learningOutcome(after)?.label,
      source: `09-foundation-question-bank/${file}`,
    }, ctx);
  }
}

// ---------- 2. Banque Practitioner S001–S060 (barème intégré) ----------

for (const file of filesIn('10-practitioner-scenarios').filter((f) => /^0[1-8]-/.test(f))) {
  const domain = F102_FILE_DOMAIN[file.slice(0, 2)];
  for (const { head, body } of sections(read(join('10-practitioner-scenarios', file)), 'S\\d{3}')) {
    const [, num, title] = head.match(/^S(\d{3})\s*—\s*(.*)$/);
    const ctx = `${file} S${num}`;
    const { stem, optBlock, after } = splitQuestion(body, ctx);
    const pts = parsePoints((after.match(/^\*\*Scoring[^\n]*/m) ?? [''])[0]);
    if (!pts) throw new Error(`${ctx} : barème introuvable`);
    finalize({
      id: `togaf-f102-s${num}`, exam: 'f102', set: 'bank', series: 'bank', domain, title: plain(title), stem,
      options: buildOptions(optBlock, after, pts, ctx),
      explanation: generalExplanation(after), topic: mapping(after), lo: learningOutcome(after)?.label,
      source: `10-practitioner-scenarios/${file}`,
    }, ctx);
  }
}

// ---------- 3. Séries complémentaires (corrections séparées) ----------

for (const [dir, series] of Object.entries(SERIES)) {
  const files = filesIn(dir);
  for (const [prefix, meta] of Object.entries(series)) {
    const qFile = files.find((f) => f.startsWith(prefix + '-') && !/correction/.test(f));
    const cFile = files.find((f) => f.startsWith(prefix + '-') && /correction/.test(f));
    if (!qFile || !cFile) throw new Error(`${dir} : série ${prefix} incomplète`);
    const corr = new Map(sections(read(join(dir, cFile)), '[A-Z]+\\d+').map((s) => [s.head.match(/^([A-Z]+\d+)/)[1], s]));
    for (const { head, body } of sections(read(join(dir, qFile)), '[A-Z]+\\d+')) {
      const [, code, rawTitle] = head.match(/^([A-Z]+\d+)\s*—\s*(.*)$/);
      const ctx = `${qFile} ${code}`;
      const c = corr.get(code);
      if (!c) throw new Error(`${ctx} : correction manquante`);
      const { stem, optBlock } = splitQuestion(body, ctx);
      const cText = `${c.head}\n${c.body}`;
      let pts;
      if (meta.exam === 'f102') {
        pts = parsePoints(cText);
        if (!pts) throw new Error(`${ctx} : barème introuvable`);
      } else {
        const correct = (cText.match(/\*\*Réponse\s*:\s*([A-D])/) ?? c.head.match(/—\s*([A-D])\b/) ?? [])[1];
        if (!correct) throw new Error(`${ctx} : réponse introuvable`);
        pts = { A: 0, B: 0, C: 0, D: 0, [correct]: 1 };
      }
      const lo = learningOutcome(`${head}\n${c.body}`);
      finalize({
        id: `togaf-${meta.exam}-${code.toLowerCase()}`, exam: meta.exam, set: 'bank', series: meta.id,
        domain: meta.domain ?? domainFromLo(lo, meta.exam), title: plain(rawTitle.replace(/^L\d[.\d]*\s*:\s*/, '')), stem,
        options: buildOptions(optBlock, c.body, pts, ctx),
        explanation: generalExplanation(c.body), topic: mapping(c.body), lo: lo?.label,
        source: `${dir}/${qFile}`,
      }, ctx);
    }
  }
}

// ---------- 4. Examens blancs ----------

const mockFiles = readdirSync(join(src, '11-mock-exams')).filter((f) => /^mock-\d\d-exam\.md$/.test(f)).sort();
for (const file of mockFiles) {
  const n = file.match(/mock-(\d\d)/)[1];
  const exam = read(join('11-mock-exams', file));
  const corr = read(join('11-mock-exams/corrections', `mock-${n}-correction.md`));
  const [p1, p2] = exam.split(/^# Part 2.*$/m);
  const [c1, c2] = corr.split(/^# Part 2.*$/m);

  // Part 1 : 40 QCM, clé « 12. **D** — explication »
  const key = {};
  for (const m of c1.matchAll(/^(\d+)\.\s+\*\*([A-D])\*\*\s*—\s*(.*)$/gm)) key[m[1]] = { correct: m[2], expl: plain(m[3].replace(/\s*\[X2202[^\]]*\]\.?$/, '')) };
  for (const block of p1.split(/^(?=## |\*\*Q\d+\.\*\*)/m)) {
    const q = block.match(/^\*\*Q(\d+)\.\*\*\s*([\s\S]*)$/);
    if (!q) continue;
    const ctx = `${file} Q${q[1]}`;
    const { stem, optBlock } = splitQuestion(q[2], ctx);
    const k = key[q[1]];
    if (!k) throw new Error(`${ctx} : clé de correction manquante`);
    finalize({
      id: `togaf-f101-mock${n}-q${q[1].padStart(2, '0')}`, exam: 'f101', set: `mock-${n}`, series: 'mock', order: Number(q[1]),
      domain: mockF101Domain(Number(q[1])), title: '', stem,
      options: parseOptions(optBlock.trim(), ctx).map((o) => ({ ...o, points: o.key === k.correct ? 1 : 0 })),
      explanation: k.expl, topic: '', source: `11-mock-exams/${file}`,
    }, ctx);
  }

  // Part 2 : 8 scénarios, corrections « ## P1 — … » (barème + justifications)
  const corrP = new Map();
  for (const s of sections(c2 ?? '', 'P\\d')) corrP.set(s.head.match(/^P(\d)/)[1], s.body);
  // Ancien format compact « **P1 — B=5, …** explication »
  for (const m of (c2 ?? '').matchAll(/^\*\*P(\d)\s*—\s*([^*]*)\*\*\s*(.*)$/gm)) if (!corrP.has(m[1])) corrP.set(m[1], `${m[2]}\n${m[3]}`);
  for (const { head, body } of sections(p2, 'P\\d')) {
    const [, num, title] = head.match(/^P(\d)\s*—\s*(.*)$/);
    const ctx = `${file} P${num}`;
    const c = corrP.get(num);
    if (!c) throw new Error(`${ctx} : correction manquante`);
    const pts = parsePoints(c);
    if (!pts) throw new Error(`${ctx} : barème introuvable`);
    const { stem, optBlock } = splitQuestion(body, ctx);
    finalize({
      id: `togaf-f102-mock${n}-p${num}`, exam: 'f102', set: `mock-${n}`, series: 'mock', order: Number(num),
      domain: MOCK_F102_ORDER[Number(num) - 1], title: plain(title), stem,
      options: buildOptions(optBlock, c, pts, ctx),
      explanation: generalExplanation(c.replace(/^[^\n]*=\d[^\n]*\n?/, '')), topic: '', source: `11-mock-exams/${file}`,
    }, ctx);
  }
}

// ---------- 5. Objectifs X2202 (matrice de traçabilité du dépôt de cours) ----------
// La matrice associe chaque objectif à des exercices « candidats » : ce rattachement
// n'est pas une validation (statut « Candidat précis — non relu » dans la source).

const MATRIX = '14-official-sources/06-x2202-learning-outcome-traceability.md';
const CODE_TO_ID = {
  Q: (n) => `togaf-f101-q${n}`, S: (n) => `togaf-f102-s${n}`, XP: (n) => `togaf-f102-xp${n}`,
  XF: (n) => `togaf-f101-xf${n}`, F: (n) => `togaf-f101-f${n}`, D: (n) => `togaf-f101-d${n}`, A: (n) => `togaf-f102-a${n}`,
};
const REF = /\b(XP|XF|Q|S|F|D|A)(\d{2,3})(?:\s*[–-]\s*(?:XP|XF|Q|S|F|D|A)?(\d{2,3}))?\b/g;

function expandRefs(cell, ctx) {
  const ids = [];
  for (const m of cell.matchAll(REF)) {
    const [, prefix, from, to] = m;
    const width = from.length;
    const end = to ? Number(to) : Number(from);
    if (end < Number(from) || end - Number(from) > 60) throw new Error(`${ctx} : plage invalide « ${m[0]} »`);
    for (let n = Number(from); n <= end; n++) ids.push(CODE_TO_ID[prefix](String(n).padStart(width, '0')));
  }
  return ids;
}

const byId = new Map(questions.map((q) => [q.id, q]));
const objectives = [];
const unknownRefs = [];
const matrixText = read(MATRIX);
let unitLabel = '';
for (const line of matrixText.split('\n')) {
  const h = line.match(/^## (L[12]) U(\d) — (.*?)(?: \(\d+ objectifs?\))?$/);
  if (h) { unitLabel = h[3].trim(); continue; }
  const row = line.match(/^\| (L([12])\.(\d)\.(\d+)) \|(.*)\|\s*$/);
  if (!row) continue;
  const [, id, level, unit] = row;
  const cells = row[5].split('|').map((c) => c.trim());
  const [label, courseCell, refsCell, status = ''] = cells;
  const coursePath = (courseCell.match(/\]\(([^)]+)\)/) ?? [])[1];
  const refs = expandRefs(refsCell, id);
  for (const ref of refs) {
    const q = byId.get(ref);
    if (!q) { unknownRefs.push(`${id} → ${ref}`); continue; }
    q.los = [...new Set([...(q.los ?? []), id])];
  }
  objectives.push({
    id, level: Number(level), unit: Number(unit), unitLabel,
    label: plain(label),
    course: coursePath ? join('14-official-sources', coursePath).replace(/\\/g, '/') : null,
    bloom: (status.match(/Bloom officiel\s*:\s*([\w_]+)/) ?? [])[1] ?? null,
    review: plain(status.split(';')[0]),
    questionCount: refs.filter((r) => byId.has(r)).length,
  });
}
if (objectives.length === 0) throw new Error(`${MATRIX} : aucun objectif lu`);
if (unknownRefs.length) {
  throw new Error(`${MATRIX} : ${unknownRefs.length} référence(s) sans question correspondante :\n  ${unknownRefs.join('\n  ')}`);
}
for (const q of questions) if (q.los) q.los.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'questions.json'), JSON.stringify(questions, null, 1) + '\n');
writeFileSync(join(out, 'objectives.json'), JSON.stringify(objectives, null, 1) + '\n');
const count = (f) => questions.filter(f).length;
const withRat = count((q) => q.options.some((o) => o.rationale));
console.log(`Pack TOGAF : ${questions.length} questions (${withRat} avec justification par option)`);
const orphans = objectives.filter((o) => o.questionCount === 0);
console.log(`Objectifs X2202 : ${objectives.length}, ${objectives.length - orphans.length} avec au moins une question, ${questions.filter((q) => q.los).length} questions rattachées (rattachement candidat, non relu)`);
if (orphans.length) console.log(`  Objectifs sans question : ${orphans.map((o) => o.id).join(', ')}`);
for (const ex of ['f101', 'f102']) {
  const bySeries = {};
  for (const q of questions.filter((x) => x.exam === ex)) bySeries[q.series] = (bySeries[q.series] ?? 0) + 1;
  console.log(`  ${ex} : ${Object.entries(bySeries).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
