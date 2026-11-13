#!/usr/bin/env node
// Valide un pack de questions (pack.json + questions.json) avant publication.
// Usage : node content-pipeline/validate.mjs app/packs/<pack>
// Code de sortie 1 si une erreur bloquante est trouvée.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { questionRev } from './rev.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage : node content-pipeline/validate.mjs <dossier-du-pack>');
  process.exit(1);
}
const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
const questions = JSON.parse(readFileSync(join(dir, 'questions.json'), 'utf8'));

const errors = [];
const err = (q, msg) => errors.push(`${q?.id ?? '?'} : ${msg}`);
const exams = new Map(pack.exams.map((e) => [e.id, e]));

const ids = new Set();
for (const q of questions) {
  if (!q.id || ids.has(q.id)) err(q, 'identifiant manquant ou en double');
  ids.add(q.id);
  const exam = exams.get(q.exam);
  if (!exam) { err(q, `examen inconnu « ${q.exam} »`); continue; }
  if (!exam.domains.some((d) => d.id === q.domain)) err(q, `domaine inconnu « ${q.domain} »`);
  if (!q.stem?.trim()) err(q, 'énoncé vide');
  if (!Array.isArray(q.options) || q.options.length < 2) { err(q, 'moins de 2 options'); continue; }
  if (q.options.some((o) => !o.text?.trim())) err(q, 'option vide');
  if (q.options.some((o) => !Number.isInteger(o.points) || o.points < 0)) err(q, 'points invalides');
  const max = Math.max(...q.options.map((o) => o.points));
  if (max <= 0) err(q, 'aucune bonne réponse');
  if (q.select !== undefined) {
    // Plusieurs réponses : exactement `select` options valent 1 point, les autres 0.
    if (!Number.isInteger(q.select) || q.select < 2 || q.select >= q.options.length) err(q, `select invalide (${q.select})`);
    else if (q.options.filter((o) => o.points === 1).length !== q.select || q.options.some((o) => o.points > 1)) err(q, `${q.select} bonnes réponses attendues à 1 point`);
  } else if (q.options.filter((o) => o.points === max).length !== 1) err(q, 'plusieurs meilleures réponses');
  if (!q.explanation?.trim()) err(q, 'explication manquante');
  if (q.rev !== questionRev(q)) err(q, `empreinte « rev » absente ou périmée (${q.rev ?? 'aucune'})`);
}

// Les examens blancs figés doivent respecter le format officiel.
for (const exam of pack.exams) {
  const sets = [...new Set(questions.filter((q) => q.exam === exam.id && q.set !== 'bank').map((q) => q.set))];
  for (const set of sets) {
    const qs = questions.filter((q) => q.exam === exam.id && q.set === set);
    if (qs.length !== exam.questionCount) errors.push(`${exam.id}/${set} : ${qs.length} questions au lieu de ${exam.questionCount}`);
    for (const d of exam.domains) {
      const n = qs.filter((q) => q.domain === d.id).length;
      if (n !== d.count) errors.push(`${exam.id}/${set} : domaine ${d.id} = ${n} au lieu de ${d.count}`);
    }
  }
  const bank = questions.filter((q) => q.exam === exam.id && q.set === 'bank');
  for (const d of exam.domains) {
    if (bank.filter((q) => q.domain === d.id).length < d.count) errors.push(`${exam.id} : banque insuffisante pour générer un examen (domaine ${d.id})`);
  }
}

// Objectifs d'apprentissage : chaque « los » doit exister dans objectives.json.
if (pack.objectives?.file) {
  const f = join(dir, pack.objectives.file);
  if (!existsSync(f)) errors.push(`${pack.objectives.file} introuvable`);
  else {
    const objs = JSON.parse(readFileSync(f, 'utf8'));
    const known = new Set(objs.map((o) => o.id));
    for (const q of questions) for (const lo of q.los ?? []) if (!known.has(lo)) err(q, `objectif inconnu ${lo}`);
    for (const o of objs) {
      const n = questions.filter((q) => q.los?.includes(o.id)).length;
      if (n !== o.questionCount) errors.push(`objectif ${o.id} : ${o.questionCount} annoncée(s), ${n} trouvée(s)`);
    }
    console.log(`Objectifs : ${objs.length}, dont ${objs.filter((o) => o.questionCount === 0).length} sans question`);
  }
}

// Les remises à zéro déclarées doivent viser des questions existantes.
for (const r of pack.resets ?? []) {
  for (const id of r.questions) if (!ids.has(id)) errors.push(`remise à zéro ${r.id} : question inconnue ${id}`);
}

// Information : position d'origine des meilleures réponses. Le moteur mélange les
// options à l'affichage, donc un biais ici n'est plus bloquant, mais il reste visible.
const pos = {};
for (const q of questions) {
  const best = q.options.reduce((a, b) => (b.points > a.points ? b : a));
  pos[best.key] = (pos[best.key] ?? 0) + 1;
}

console.log(`${pack.name} : ${questions.length} questions, ${errors.length} erreur(s)`);
console.log(`Position d'origine des meilleures réponses : ${Object.entries(pos).sort().map(([k, v]) => `${k}=${v}`).join(' ')} (mélangées à l'affichage)`);
if (errors.length) {
  for (const e of errors.slice(0, 50)) console.error('  ✗ ' + e);
  process.exit(1);
}
