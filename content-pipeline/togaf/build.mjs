#!/usr/bin/env node
// Convertit le contenu Markdown du dépôt togaf-ogea-103-combined-certification-prep
// en un pack de questions au format générique du moteur (voir data/schema.md).
//
// Usage : node content-pipeline/togaf/build.mjs <chemin-du-depot-source> [dossier-de-sortie]

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = process.argv[2];
const out = resolve(process.argv[3] ?? 'app/packs/togaf');
if (!src) {
  console.error('Usage : node content-pipeline/togaf/build.mjs <dépôt-source> [sortie]');
  process.exit(1);
}

const read = (p) => readFileSync(join(src, p), 'utf8').replace(/\r\n/g, '\n');
const list = (dir) => readdirSync(join(src, dir)).filter((f) => /^\d\d-.*\.md$/.test(f) && !f.startsWith('00-')).sort();

// Domaines officiels (plan d'examen X2202)
const F101_FILE_DOMAIN = {
  '01-concepts': 'concepts',
  '02-adm': 'adm', '03-adm': 'adm', '04-adm': 'adm',
  '05-techniques': 'techniques',
  '06-applying': 'applying',
  '07-governance': 'governance',
  '08-content': 'content',
};
const F102_FILE_DOMAIN = {
  '01-context': 'context', '02-stakeholders': 'stakeholders', '03-phase-a': 'phase-a',
  '04-bcd': 'bcd', '05-efg': 'efg', '06-phase-h': 'phase-h',
  '07-requirements': 'requirements', '08-supporting': 'supporting',
};
const MOCK_F101_HEADINGS = [
  [/^Concepts/i, 'concepts'],
  [/^Introduction to the ADM/i, 'adm'],
  [/^ADM Techniques/i, 'techniques'],
  [/^Applying/i, 'applying'],
  [/^(Architecture )?Governance/i, 'governance'],
  [/^Architecture Content/i, 'content'],
];
const MOCK_F102_ORDER = ['context', 'stakeholders', 'phase-a', 'bcd', 'efg', 'phase-h', 'requirements', 'supporting'];

const clean = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Découpe un bloc « A. …  B. …  C. …  D. … » (sur une ou plusieurs lignes) en 4 options.
function parseOptions(block, ctx) {
  const flat = '  ' + block.replace(/\n/g, '  ');
  const re = /(?:^|\s{2,})([A-D])\.\s/g;
  const marks = [];
  let m;
  let expected = 0;
  while ((m = re.exec(flat))) {
    if (m[1] === 'ABCD'[expected]) {
      marks.push({ key: m[1], start: m.index + m[0].length, at: m.index });
      expected++;
      if (expected === 4) break;
    }
  }
  if (marks.length !== 4) throw new Error(`${ctx} : options A–D introuvables`);
  return marks.map((mk, i) => ({
    key: mk.key,
    text: flat.slice(mk.start, i < 3 ? marks[i + 1].at : undefined).trim(),
  }));
}

// Sépare l'énoncé (avant la ligne « A. ») du bloc d'options.
function splitStem(body, ctx) {
  const idx = body.search(/^A\.\s/m);
  if (idx < 0) throw new Error(`${ctx} : pas de ligne « A. »`);
  return [clean(body.slice(0, idx)), body.slice(idx)];
}

function parseScoring(line, ctx) {
  const pts = {};
  for (const m of line.matchAll(/([A-D])=(\d)/g)) pts[m[1]] = Number(m[2]);
  if (Object.keys(pts).length !== 4) throw new Error(`${ctx} : barème incomplet`);
  return pts;
}

const questions = [];

// 1. Banque Foundation : 300 QCM
for (const file of list('09-foundation-question-bank')) {
  const domain = F101_FILE_DOMAIN[file.split('-').slice(0, 2).join('-')];
  if (!domain) throw new Error(`Domaine inconnu pour ${file}`);
  const text = read(join('09-foundation-question-bank', file));
  for (const chunk of text.split(/^## (?=Q\d{3})/m).slice(1)) {
    const [head, ...rest] = chunk.split('\n');
    const [, num, title] = head.match(/^Q(\d{3})\s*—\s*(.*)$/) ?? [];
    const ctx = `${file} Q${num}`;
    const body = rest.join('\n');
    const ansIdx = body.search(/^\*\*Réponse/m);
    const [stem, optBlock] = splitStem(body.slice(0, ansIdx), ctx);
    const after = body.slice(ansIdx);
    const [, correct, expl] = after.match(/^\*\*Réponse\s*:\s*([A-D])\.?\*\*\s*(.*)$/m) ?? [];
    if (!correct) throw new Error(`${ctx} : réponse introuvable`);
    const mapping = (after.match(/^\*\*Mapping\s*:\s*(.*?)\.?\*\*/m) ?? [])[1] ?? '';
    questions.push({
      id: `togaf-f101-q${num}`,
      exam: 'f101',
      set: 'bank',
      domain,
      title: title.trim(),
      stem,
      options: parseOptions(optBlock, ctx).map((o) => ({ ...o, points: o.key === correct ? 1 : 0 })),
      explanation: expl.trim(),
      topic: mapping,
      source: `09-foundation-question-bank/${file}`,
    });
  }
}

// 2. Scénarios Practitioner : 60 scénarios
for (const file of list('10-practitioner-scenarios')) {
  const domain = F102_FILE_DOMAIN[file.split('-').slice(0, file.startsWith('03') || file.startsWith('06') ? 3 : 2).join('-')];
  if (!domain) throw new Error(`Domaine inconnu pour ${file}`);
  const text = read(join('10-practitioner-scenarios', file));
  for (const chunk of text.split(/^## (?=S\d{3})/m).slice(1)) {
    const [head, ...rest] = chunk.split('\n');
    const [, num, title] = head.match(/^S(\d{3})\s*—\s*(.*)$/) ?? [];
    const ctx = `${file} S${num}`;
    const body = rest.join('\n').replace(/\n---\s*$/m, '');
    const scIdx = body.search(/^\*\*Scoring/m);
    const [stem, optBlock] = splitStem(body.slice(0, scIdx), ctx);
    const after = body.slice(scIdx);
    const pts = parseScoring(after.split('\n')[0], ctx);
    const expl = (after.match(/^\*\*Pourquoi [A-D][^*]*:\*\*\s*(.*)$/m) ?? [])[1] ?? '';
    const mapping = (after.match(/^\*\*Mapping\s*:\s*(.*?)\.?\*\*/m) ?? [])[1] ?? '';
    questions.push({
      id: `togaf-f102-s${num}`,
      exam: 'f102',
      set: 'bank',
      domain,
      title: title.trim(),
      stem,
      options: parseOptions(optBlock, ctx).map((o) => ({ ...o, points: pts[o.key] })),
      explanation: expl.trim(),
      topic: mapping,
      source: `10-practitioner-scenarios/${file}`,
    });
  }
}

// 3. Examens blancs : Part 1 (40 QCM) et Part 2 (8 scénarios) de chaque mock
const mockFiles = readdirSync(join(src, '11-mock-exams')).filter((f) => /^mock-\d\d-exam\.md$/.test(f)).sort();
for (const file of mockFiles) {
  const n = file.match(/mock-(\d\d)/)[1];
  const exam = read(join('11-mock-exams', file));
  const corr = read(join('11-mock-exams/corrections', `mock-${n}-correction.md`));
  const [p1, p2] = exam.split(/^# Part 2/m);

  // Part 1
  const key = {};
  for (const m of corr.matchAll(/^(\d+)\.\s+\*\*([A-D])\*\*\s*—\s*(.*)$/gm)) key[m[1]] = { correct: m[2], expl: m[3].trim() };
  let domain = null;
  for (const block of p1.split(/^(?=## |\*\*Q\d+\.\*\*)/m)) {
    const h = block.match(/^## (.*)$/m);
    if (block.startsWith('## ') && h) {
      domain = (MOCK_F101_HEADINGS.find(([re]) => re.test(h[1])) ?? [])[1] ?? domain;
      continue;
    }
    const q = block.match(/^\*\*Q(\d+)\.\*\*\s*([\s\S]*)$/);
    if (!q) continue;
    const ctx = `${file} Q${q[1]}`;
    const [stem, optBlock] = splitStem(q[2], ctx);
    const k = key[q[1]];
    if (!k) throw new Error(`${ctx} : clé de correction manquante`);
    questions.push({
      id: `togaf-f101-mock${n}-q${q[1].padStart(2, '0')}`,
      exam: 'f101',
      set: `mock-${n}`,
      order: Number(q[1]),
      domain,
      title: '',
      stem,
      options: parseOptions(optBlock.trim(), ctx).map((o) => ({ ...o, points: o.key === k.correct ? 1 : 0 })),
      explanation: k.expl,
      topic: '',
      source: `11-mock-exams/${file}`,
    });
  }

  // Part 2
  const scoring = {};
  // Deux formats existent : « ## P1 — Titre\n**B=5, …** expl » et « **P1 — B=5, …** expl »
  for (const m of corr.matchAll(/^## P(\d)\s*—.*\n\*\*(.*?)\*\*\s*(.*)$/gm)) scoring[m[1]] = { pts: parseScoring(m[2], `${file} P${m[1]}`), expl: m[3].trim() };
  for (const m of corr.matchAll(/^\*\*P(\d)\s*—\s*(.*?)\*\*\s*(.*)$/gm)) scoring[m[1]] = { pts: parseScoring(m[2], `${file} P${m[1]}`), expl: m[3].trim() };
  for (const chunk of p2.split(/^## (?=P\d)/m).slice(1)) {
    const [head, ...rest] = chunk.split('\n');
    const [, num, title] = head.match(/^P(\d)\s*—\s*(.*)$/) ?? [];
    const ctx = `${file} P${num}`;
    const [stem, optBlock] = splitStem(rest.join('\n').replace(/\n---[\s\S]*$/, ''), ctx);
    const sc = scoring[num];
    if (!sc) throw new Error(`${ctx} : barème manquant`);
    questions.push({
      id: `togaf-f102-mock${n}-p${num}`,
      exam: 'f102',
      set: `mock-${n}`,
      order: Number(num),
      domain: MOCK_F102_ORDER[Number(num) - 1],
      title: title.trim(),
      stem,
      options: parseOptions(optBlock.trim(), ctx).map((o) => ({ ...o, points: sc.pts[o.key] })),
      explanation: sc.expl,
      topic: '',
      source: `11-mock-exams/${file}`,
    });
  }
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'questions.json'), JSON.stringify(questions, null, 1) + '\n');
const count = (f) => questions.filter(f).length;
console.log(`Pack TOGAF : ${questions.length} questions`);
console.log(`  F101 banque ${count((q) => q.exam === 'f101' && q.set === 'bank')}, mocks ${count((q) => q.exam === 'f101' && q.set !== 'bank')}`);
console.log(`  F102 banque ${count((q) => q.exam === 'f102' && q.set === 'bank')}, mocks ${count((q) => q.exam === 'f102' && q.set !== 'bank')}`);
