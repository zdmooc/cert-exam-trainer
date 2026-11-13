#!/usr/bin/env node
// Construit le pack « Claude » depuis le dépôt de cours claude-architect-lab.
// Usage : node content-pipeline/claude/build.mjs <chemin-vers-claude-architect-lab>
//
// Sources lues (Markdown, corrigés en tableau) :
//   docs/lecons/M2-quiz.md … M7-quiz.md, docs/lecons/M8-scenarios.md  → Foundations
//   docs/professional/entrainement.md                                → Professional
//   docs/developer/entrainement.md                                   → Developer
//   docs/associate/entrainement.md                                   → Associate
//
// Une question à plusieurs bonnes réponses (corrigé « A, C » ou « A + B ») reçoit
// `select: n` : il faut choisir exactement les n bonnes options (1 point, sinon 0).
// Le build échoue si une question n'a pas de corrigé, ou un corrigé pas de question.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { questionRev } from '../rev.mjs';

const src = process.argv[2];
if (!src || !existsSync(join(src, 'docs'))) {
  console.error('Usage : node content-pipeline/claude/build.mjs <chemin-vers-claude-architect-lab>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '../../app/packs/claude');
const errors = [];

// Rattachement des quiz Foundations aux domaines D1–D5, d'après le tableau des modules
// de docs/parcours.md (M2 → D4, M4 → D2, M5 → D3, M6 → D1, M7 → D5). M3 couvre D1 et D2 :
// la boucle agentique va en D1, la conception des outils en D2. Rattachement pédagogique,
// pas une classification officielle.
const FOUNDATIONS_DOMAIN = {
  m2: 'd4', m4: 'd2', m5: 'd3', m6: 'd1', m7: 'd5',
  'm3-q1': 'd1', 'm3-q2': 'd2', 'm3-q3': 'd2', 'm3-q4': 'd1', 'm3-q5': 'd2', 'm3-q6': 'd1',
  // Scénarios M8 : S1 support (agentique), S2 Claude Code, S3 multi-agent, S4 outils/MCP,
  // S5 Claude Code en CI, S6 extraction (sorties structurées).
  'm8-s1': 'd1', 'm8-s2': 'd3', 'm8-s3': 'd1', 'm8-s4-q1': 'd3', 'm8-s4-q2': 'd2', 'm8-s5': 'd3', 'm8-s6': 'd4',
};

const clean = (s) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').replace(/^[\s·;,.-]+|[\s·;,]+$/g, '').trim();

// Découpe « énoncé A. … B. … C. … D. … » (options en liste, séparées par « · » ou « ; »).
function splitOptions(text) {
  const keys = ['A', 'B', 'C', 'D'];
  const pos = [];
  let from = 0;
  for (const k of keys) {
    const re = new RegExp(`(^|[\\s·;?:.»)])${k}\\.\\s`, 'g');
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) return null;
    const start = m.index + m[1].length;
    pos.push(start);
    from = start + 2;
  }
  const stem = clean(text.slice(0, pos[0]));
  const options = keys.map((k, i) => ({ key: k, text: clean(text.slice(pos[i] + 2, pos[i + 1] ?? text.length)).replace(/\.$/, '') }));
  return { stem, options };
}

// Lignes de corrigé : | id | **A, C** | justification | [pourquoi pas] |
function parseKey(md) {
  const key = new Map();
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*([A-Z]?\d*-?Q?\d+)\s*\|\s*\*\*([A-D](?:\s*[,+]\s*[A-D])*)\*\*\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const letters = m[2].split(/[,+]/).map((x) => x.trim());
    const cols = m[3].split('|').map((c) => c.trim()).filter(Boolean);
    key.set(m[1].replace(/^Q/, '').replace(/^0+(?=\d)/, ''), { letters, explanation: cols.join(' — Pourquoi pas les autres : ').replace(/\*\*/g, '') });
  }
  return key;
}

// Repère les questions : **Q1.**, **Q01.**, **A1 / Q01.**, - **S1-Q1.**
const Q_START = /^\s*(?:-\s*)?\*\*(?:(A\d) \/ )?(S\d-Q\d+|Q\d+)\.\*\*\s*(.*)$/;

function parseFile(rel, { exam, idPrefix, domainOf, series }) {
  const md = readFileSync(join(src, rel), 'utf8');
  const keyStart = md.search(/^##\s+Corrig/m);
  const body = keyStart >= 0 ? md.slice(0, keyStart) : md;
  const key = parseKey(keyStart >= 0 ? md.slice(keyStart) : '');
  const found = [];
  let heading = '';
  let cur = null;
  const flush = () => { if (cur) found.push(cur); cur = null; };
  for (const line of body.split('\n')) {
    if (/^#{2,3}\s/.test(line)) { flush(); heading = line.replace(/^#+\s*/, ''); continue; }
    const m = line.match(Q_START);
    if (m) { flush(); cur = { unit: m[1], label: m[2], heading, text: m[3] }; continue; }
    if (cur) {
      if (!line.trim()) { if (cur.text.match(/D\.\s/)) flush(); continue; }
      cur.text += ' ' + line.trim().replace(/^-\s+/, '');
    }
  }
  flush();
  const used = new Set();
  const questions = [];
  for (const f of found) {
    const ref = f.label.replace(/^Q/, '').replace(/^0+(?=\d)/, '');
    const id = `${idPrefix}-${f.label.toLowerCase().replace(/^q0*/, 'q')}`;
    const parsed = splitOptions(f.text);
    if (!parsed) { errors.push(`${rel} ${f.label} : options A–D introuvables`); continue; }
    const k = key.get(ref);
    if (!k) { errors.push(`${rel} ${f.label} : pas de corrigé`); continue; }
    used.add(ref);
    const stem = parsed.stem.replace(/^\((?:2|deux) réponses\)\s*/i, '').replace(/\s*\((?:2|deux) réponses\)\s*$/i, '');
    const q = {
      id: `claude-${id}`,
      exam,
      set: 'bank',
      domain: domainOf(f, id),
      ...(/^S\d\s/.test(f.heading) ? { title: f.heading } : {}),
      stem,
      ...(k.letters.length > 1 ? { select: k.letters.length } : {}),
      options: parsed.options.map((o) => ({ ...o, points: k.letters.includes(o.key) ? 1 : 0 })),
      series,
      explanation: k.explanation,
      source: rel,
    };
    q.rev = questionRev(q);
    questions.push(q);
  }
  for (const ref of key.keys()) if (!used.has(ref)) errors.push(`${rel} : corrigé ${ref} sans question`);
  return questions;
}

const questions = [];
let order = 0;
for (const m of ['M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
  const file = m === 'M8' ? 'docs/lecons/M8-scenarios.md' : `docs/lecons/${m}-quiz.md`;
  const mod = m.toLowerCase();
  questions.push(...parseFile(file, {
    exam: 'ccar-f', idPrefix: mod, series: mod,
    domainOf: (f, id) => {
      const short = id.replace(/^m8-(s\d)-.*/, 'm8-$1');
      const d = FOUNDATIONS_DOMAIN[id] ?? FOUNDATIONS_DOMAIN[short] ?? FOUNDATIONS_DOMAIN[mod];
      if (!d) errors.push(`${id} : domaine Foundations non rattaché`);
      return d;
    },
  }));
}
questions.push(...parseFile('docs/professional/entrainement.md', {
  exam: 'ccar-p', idPrefix: 'p', series: 'bank', domainOf: (f) => f.heading.match(/^D(\d)/) ? `d${f.heading.match(/^D(\d)/)[1]}` : null,
}));
questions.push(...parseFile('docs/developer/entrainement.md', {
  exam: 'ccdv-f', idPrefix: 'v', series: 'bank', domainOf: (f) => f.heading.match(/^V(\d)/) ? `v${f.heading.match(/^V(\d)/)[1]}` : null,
}));
questions.push(...parseFile('docs/associate/entrainement.md', {
  exam: 'ccao-f', idPrefix: 'a', series: 'bank', domainOf: (f) => (f.unit ? f.unit.toLowerCase() : null),
}));
for (const q of questions) {
  q.order = ++order;
  if (!q.domain) errors.push(`${q.id} : domaine introuvable`);
}

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'questions.json'), JSON.stringify(questions, null, 1) + '\n');
const by = (k) => questions.reduce((a, q) => ({ ...a, [q[k]]: (a[q[k]] ?? 0) + 1 }), {});
console.log(`Pack Claude : ${questions.length} questions (${questions.filter((q) => q.select).length} à plusieurs réponses)`);
console.log('  par examen :', JSON.stringify(by('exam')));
for (const e of Object.keys(by('exam'))) {
  const qs = questions.filter((q) => q.exam === e);
  console.log(`  ${e} par domaine :`, JSON.stringify(qs.reduce((a, q) => ({ ...a, [q.domain]: (a[q.domain] ?? 0) + 1 }), {})));
}
