// Couche interface : relie le moteur (js/core), le stockage (js/adapters)
// et le contenu (packs/). Aucune règle de certification ici : tout vient du pack.

import { createRng } from './core/random.js';
import { scoreQuestion, scoreSession, isMulti } from './core/scoring.js';
import {
  createSession, answer, finish, toggleFlag, goTo, canReveal, isExpired, remainingMs, answeredCount, isAnswered,
} from './core/session.js';
import { filterPool, selectQuestions, generateExam, fixedSet, listFixedSets, listSeries } from './core/selection.js';
import {
  emptyProgress, recordAnswer, recordSession, statOf, needsReview, exportProgress, parseProgressFile, mergeProgress,
  applyResets, bookingReadiness,
} from './core/progress.js';
import { createLocalStorage } from './adapters/storage.js';
import { summarizeObjectives, questionsByObjective } from './core/objectives.js';

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $timer = document.getElementById('timer');
const $homeBtn = document.getElementById('home-btn');

const S = {
  packs: [], pack: null, questions: [], byId: new Map(), objectives: [], store: null,
  examId: null, progress: emptyProgress(), session: null,
  setup: { strategy: 'adaptive', count: 20, domains: [], series: [] },
  confirm: null, showGrid: false,
};
let timerHandle = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const exam = () => S.pack.exams.find((e) => e.id === S.examId);
const domainLabel = (id) => exam()?.domains.find((d) => d.id === id)?.label ?? id;
const objectiveText = (q) => {
  const ids = [...new Set([...(q.los ?? []), ...(q.lo && !/U\d$/.test(q.lo) ? [q.lo] : [])])];
  if (!ids.length) return q.lo ? `Objectif X2202 ${q.lo}` : '';
  return `Objectif${ids.length > 1 ? 's' : ''} X2202 ${ids.join(', ')}${q.los ? ' (rattachement candidat)' : ''}`;
};
const readiness = () => bookingReadiness(S.progress.sessions, exam());
const readinessBadge = (r) => (r.ready
  ? '<span class="badge ok">Prêt à réserver</span>'
  : `<span class="badge">Objectif réservation ${r.streak}/${r.required}</span>`);
const seriesLabel = (id) => (id && id !== 'bank' && id !== 'mock' ? S.pack.series?.find((x) => x.id === id)?.label ?? id : '');
const isGraded = (q) => Math.max(...q.options.map((o) => o.points)) > 1;
const chosenKeys = (answer) => (Array.isArray(answer) ? answer : answer == null ? [] : [answer]);
const thresholdText = (e) => (e.passMark != null ? `Seuil ${e.passMark}/${e.maxPoints} · objectif ${e.goMark}/${e.maxPoints}` : `Objectif personnel ${e.goMark}/${e.maxPoints}`);
const passBadge = (r) => (r.passed === null ? '' : r.passed ? '<span class="badge ok">Seuil atteint</span>' : '<span class="badge ko">Sous le seuil</span>');
const rng = () => createRng(Date.now() ^ Math.floor(Math.random() * 1e9));

function save() {
  S.store.set('progress', S.progress);
  if (S.session && S.session.status === 'in_progress') S.store.set('session', S.session);
  else S.store.remove('session');
  S.store.set('prefs', { examId: S.examId, setup: S.setup });
}

// ---------- Navigation ----------

function navigate(view, replace = false) {
  const url = `#/${view}`;
  if (replace) history.replaceState(null, '', url);
  else if (location.hash !== url) history.pushState(null, '', url);
  render();
}
const currentView = () => (location.hash.replace(/^#\/?/, '') || 'home');
window.addEventListener('popstate', () => render());

// ---------- Vues ----------

function render() {
  S.confirm = null;
  let view = currentView();
  if (['session', 'result'].includes(view) && !S.session) view = 'home';
  $homeBtn.style.visibility = view === 'home' ? 'hidden' : 'visible';
  const views = { home: viewHome, train: viewTrain, exam: viewExam, session: viewSession, result: viewResult, stats: viewStats };
  $view.innerHTML = (views[view] ?? viewHome)();
  updateTimer();
  window.scrollTo(0, 0);
}

function examStats() {
  const pool = filterPool(S.questions, { exam: S.examId, set: null });
  let seen = 0, mastered = 0, review = 0;
  for (const q of pool) {
    const s = statOf(S.progress, q);
    if (s.seen) seen++;
    if (s.box >= 3) mastered++;
    if (needsReview(s)) review++;
  }
  return { total: pool.length, seen, mastered, review };
}

function viewHome() {
  $title.textContent = S.pack.name;
  const st = examStats();
  const lastExam = [...S.progress.sessions].reverse().find((s) => s.exam === S.examId && s.mode === 'exam');
  const ongoing = S.session && S.session.status === 'in_progress';
  const e = exam();
  return `
    ${S.packs.length > 1 ? `<div class="seg" role="group" aria-label="Certification">
      ${S.packs.map((p) => `<button data-action="set-pack" data-pack="${p.id}" aria-pressed="${p.id === S.pack.id}">${esc(p.label ?? p.id)}</button>`).join('')}
    </div>` : ''}
    <div class="seg" role="group" aria-label="Examen">
      ${S.pack.exams.map((x) => `<button data-action="set-exam" data-exam="${x.id}" aria-pressed="${x.id === S.examId}">${esc(x.name)}</button>`).join('')}
    </div>
    <div class="stat-row">
      <div class="stat"><b>${st.seen}</b><span>vues / ${st.total}</span></div>
      <div class="stat"><b>${st.mastered}</b><span>maîtrisées</span></div>
      <div class="stat"><b>${st.review}</b><span>à revoir</span></div>
    </div>
    ${lastExam ? `<div class="card"><div class="row"><span>Dernier examen blanc</span>
      <span class="badge ${lastExam.go ? 'ok' : lastExam.passed ? '' : 'ko'}">${lastExam.total}/${lastExam.max}</span></div>
      <div class="row" style="margin-top:6px"><span class="muted small">${thresholdText(e)} sur ${readiness().required} examens blancs consécutifs</span>${readinessBadge(readiness())}</div></div>` : ''}
    ${backupDue() ? `<div class="card small"><div class="row"><span>Pense à sauvegarder ta progression.</span>
      <button class="btn compact" data-action="export">Exporter</button></div></div>` : ''}
    ${ongoing ? `<button class="btn primary" data-action="resume">Reprendre la session<span class="sub">&nbsp;· ${answeredCount(S.session)}/${S.session.items.length}</span></button>` : ''}
    <button class="btn" data-action="go" data-view="train"><span>Entraînement<span class="sub">Correction et explication après chaque question</span></span></button>
    <button class="btn" data-action="go" data-view="exam"><span>${S.pack.scoreNote ? 'Mini-examen' : 'Examen blanc'}<span class="sub">${e.questionCount} questions · ${e.durationMinutes} min · correction à la fin</span></span></button>
    ${e.official ? `<p class="muted small center">Examen réel : ${esc(e.official)}</p>` : ''}
    <button class="btn" data-action="review-errors"><span>Revoir mes erreurs<span class="sub">${st.review ? `${st.review} question(s) ratée(s) non maîtrisée(s)` : 'Aucune erreur à revoir pour l’instant'}</span></span></button>
    <button class="btn" data-action="go" data-view="stats"><span>Progression<span class="sub">Par domaine et historique des examens</span></span></button>
    ${S.store.persistent ? '' : '<p class="muted small center">Stockage indisponible dans ce navigateur : la progression sera perdue à la fermeture.</p>'}
    <p class="muted small center">${esc(S.pack.disclaimer)}</p>`;
}

const STRATEGY_INFO = {
  adaptive: ['Adaptatif', 'Questions jamais vues et celles que tu rates le plus'],
  random: ['Aléatoire', 'Tirage au hasard dans la banque'],
  sequential: ['Séquentiel', 'Dans l’ordre de la banque, en reprenant où tu t’es arrêté'],
  review: ['Mes erreurs', 'Uniquement les questions ratées non maîtrisées'],
};

function viewTrain() {
  $title.textContent = `Entraînement · ${exam().name}`;
  const pool = filterPool(S.questions, { exam: S.examId, domains: S.setup.domains, series: S.setup.series });
  const counts = [10, 20, 40, 0];
  const series = listSeries(S.questions, S.examId, S.pack.series);
  const countOf = (id) => filterPool(S.questions, { exam: S.examId, series: [id] }).length;
  return `
    <h3>Mode de sélection</h3>
    ${Object.entries(STRATEGY_INFO).map(([k, [name, sub]]) => `
      <button class="option" data-action="set-strategy" data-strategy="${k}" aria-pressed="${S.setup.strategy === k}">
        <b>${name}</b><br><span class="muted small">${sub}</span></button>`).join('')}
    <h3>Nombre de questions</h3>
    <div class="chips">${counts.map((c) => `<button class="chip" data-action="set-count" data-count="${c}" aria-pressed="${S.setup.count === c}">${c || 'Toutes'}</button>`).join('')}</div>
    <h3>Domaines <span class="muted small">(aucun = tous)</span></h3>
    <div class="chips">${exam().domains.map((d) => `<button class="chip" data-action="toggle-domain" data-domain="${d.id}" aria-pressed="${S.setup.domains.includes(d.id)}">${esc(d.label)}</button>`).join('')}</div>
    ${series.length > 1 ? `<h3>Séries <span class="muted small">(aucune = toutes)</span></h3>
    <div class="chips">${series.map((x) => `<button class="chip" data-action="toggle-series" data-series="${x.id}" aria-pressed="${S.setup.series.includes(x.id)}">${esc(x.label)} · ${countOf(x.id)}</button>`).join('')}</div>` : ''}
    <p class="muted small">${pool.length} question(s) dans la sélection.</p>
    <button class="btn primary" data-action="start-training">Commencer</button>`;
}

function viewExam() {
  const e = exam();
  const mini = Boolean(S.pack.scoreNote);
  $title.textContent = `${mini ? 'Mini-examen' : 'Examen blanc'} · ${e.name}`;
  const sets = listFixedSets(S.questions, S.examId);
  const last = (label) => [...S.progress.sessions].reverse().find((s) => s.exam === S.examId && s.label === label);
  return `
    <div class="card small">${e.questionCount} questions · ${e.durationMinutes} min · ${e.passMark != null ? `seuil ${e.passMark}/${e.maxPoints}` : `objectif personnel ${e.goMark}/${e.maxPoints}`}.
      ${e.openBook ? 'Livre ouvert : garde le PDF du standard (en anglais) à côté, comme le jour de l’examen.' : 'Documentation fermée.'}
      La correction n’apparaît qu’à la fin.${mini ? `<br><span class="muted">${esc(S.pack.scoreNote)}</span>` : ''}</div>
    <h3>${mini ? 'Mini-examen réparti selon les poids officiels des domaines' : 'Examen généré selon la répartition officielle'}</h3>
    <button class="btn" data-action="start-exam" data-kind="random"><span>Nouvel examen aléatoire<span class="sub">Tiré dans toute la banque</span></span></button>
    <button class="btn" data-action="start-exam" data-kind="adaptive"><span>Examen ciblé sur mes faiblesses<span class="sub">Même répartition, questions moins maîtrisées en priorité</span></span></button>
    ${sets.length ? '<h3>Examens blancs du dépôt</h3>' : ''}
    ${sets.map((set) => {
      const label = `Examen blanc ${set.replace('mock-', '')}`;
      const l = last(label);
      return `<button class="btn" data-action="start-exam" data-kind="fixed" data-set="${set}">
        <span style="flex:1">${label}</span>${l ? `<span class="badge ${l.go ? 'ok' : l.passed ? '' : 'ko'}">${l.total}/${l.max}</span>` : ''}</button>`;
    }).join('')}`;
}

function optionHtml(q, key, item, revealed, graded) {
  const opt = q.options.find((o) => o.key === key);
  const r = revealed ? scoreQuestion(q, item.answer) : null;
  const mine = chosenKeys(item.answer).includes(key);
  let cls = '';
  if (revealed && r.bestKeys.includes(key)) cls = 'best';
  else if (revealed && mine) cls = 'wrong';
  const pts = revealed && graded ? `<span class="pts">${opt.points} pt${opt.points > 1 ? 's' : ''}</span>` : '';
  const box = isMulti(q) ? `<span class="check" aria-hidden="true">${mine ? '☑' : '☐'}</span> ` : '';
  return `<button class="option ${cls}" data-action="choose" data-key="${key}" aria-pressed="${mine}" ${revealed ? 'disabled' : ''}>${pts}${box}${esc(opt.text)}</button>`;
}

function explanationHtml(q, item) {
  const r = scoreQuestion(q, item.answer);
  const mine = chosenKeys(item.answer);
  const verdict = !r.answered ? (mine.length ? `Incomplète : ${q.select} réponses attendues` : 'Non répondue') : r.correct ? 'Bonne réponse' : isGraded(q) ? `Pas la meilleure réponse · ${r.points}/${r.max} points` : 'Mauvaise réponse';
  const src = S.pack.source && q.source ? `${S.pack.source}/blob/main/${q.source}` : null;
  const graded = isGraded(q);
  const hasRationale = q.options.some((o) => o.rationale);
  const best = q.options.find((o) => o.key === r.bestKey);
  const isBest = (o) => r.bestKeys.includes(o.key);
  const showExpl = q.explanation && (isMulti(q) || q.explanation !== best.rationale);
  // Barème gradué : on présente les options de la meilleure à la moins bonne ; sinon ordre d'origine.
  const ordered = graded ? [...q.options].sort((a, b) => b.points - a.points) : q.options;
  return `
    <div class="explain ${r.correct ? 'ok' : 'ko'}">
      <p><b>${verdict}</b></p>
      ${showExpl ? `<p>${esc(q.explanation)}</p>` : ''}
      <p class="muted small">${hasRationale ? 'Pourquoi chaque réponse (lettres d’origine, citées dans les explications) :' : 'L’explication désigne les options par leur lettre d’origine :'}</p>
      <ol>${ordered.map((o) => `<li class="${isBest(o) ? 'is-best' : mine.includes(o.key) ? 'is-mine' : ''}">
        <span class="k">${o.key}</span>${esc(o.text)}${graded ? ` <span class="badge">${o.points} pt${o.points > 1 ? 's' : ''}</span>` : ''}${isBest(o) ? ' ✓' : ''}${mine.includes(o.key) && !r.correct ? ' <b>← ton choix</b>' : ''}
        ${o.rationale ? `<div class="why">${esc(o.rationale)}</div>` : ''}</li>`).join('')}</ol>
      ${q.topic || q.lo || q.los ? `<p class="muted small">${esc([objectiveText(q), q.topic].filter(Boolean).join(' · '))}</p>` : ''}
      ${src ? `<p class="small"><a href="${esc(src)}" target="_blank" rel="noopener">Voir dans le cours</a></p>` : ''}
    </div>`;
}

function viewSession() {
  const s = S.session;
  const i = s.current;
  const item = s.items[i];
  const q = S.byId.get(item.questionId);
  const revealed = canReveal(s, i);
  const graded = isGraded(q);
  const finished = s.status === 'finished';
  $title.textContent = s.label;
  const last = i === s.items.length - 1;

  let nav;
  if (finished) {
    nav = `<button class="btn" data-action="prev" ${i === 0 ? 'disabled' : ''}>‹ Préc.</button>
      <button class="btn" data-action="go" data-view="result">Résultat</button>
      <button class="btn" data-action="next" ${last ? 'disabled' : ''}>Suiv. ›</button>`;
  } else if (s.mode === 'training') {
    nav = !isAnswered(item)
      ? `<button class="btn" data-action="finish">Arrêter</button><button class="btn" data-action="next" ${last ? 'disabled' : ''}>Passer ›</button>`
      : `<button class="btn primary" data-action="${last ? 'finish' : 'next'}">${last ? 'Voir le résultat' : 'Question suivante ›'}</button>`;
  } else {
    nav = `<button class="btn" data-action="prev" ${i === 0 ? 'disabled' : ''}>‹</button>
      <button class="btn ${item.flagged ? 'flagged' : ''}" data-action="flag">${item.flagged ? 'Marquée' : 'Marquer'}</button>
      <button class="btn" data-action="next" ${last ? 'disabled' : ''}>›</button>`;
  }

  const grid = (s.mode === 'exam' && !finished) || finished ? `
    <button class="btn compact" data-action="toggle-grid">${S.showGrid ? 'Masquer l’aperçu' : `Aperçu · ${answeredCount(s)}/${s.items.length} répondues`}</button>
    ${S.showGrid ? `<div class="grid">${s.items.map((it, k) => {
      let c = isAnswered(it) ? 'done' : '';
      if (finished) c = scoreQuestion(S.byId.get(it.questionId), it.answer).correct ? 'ok' : 'ko';
      return `<button class="${c} ${it.flagged ? 'flag' : ''} ${k === i ? 'cur' : ''}" data-action="goto" data-index="${k}">${k + 1}</button>`;
    }).join('')}</div>` : ''}` : '';

  const finishBlock = s.mode === 'exam' && !finished ? (
    S.confirm === 'finish'
      ? `<div class="card"><p>${s.items.length - answeredCount(s)} question(s) sans réponse. Terminer quand même ?</p>
          <button class="btn primary" data-action="confirm-finish">Terminer et voir la correction</button>
          <button class="btn" data-action="cancel">Continuer l’examen</button></div>`
      : `<button class="btn" data-action="finish" style="margin-top:16px">Terminer l’examen</button>`
  ) : '';

  return `
    <div class="qhead"><span>Question ${i + 1}/${s.items.length} · ${esc(domainLabel(q.domain))}</span>
      ${graded ? '<span class="badge">5 · 3 · 1 · 0</span>' : ''}</div>
    <div class="progress"><i style="width:${Math.round((100 * (i + 1)) / s.items.length)}%"></i></div>
    ${q.title || (q.series && q.series !== 'bank' && q.series !== 'mock') ? `<p class="muted small" style="margin-top:10px">${esc([seriesLabel(q.series), q.title].filter(Boolean).join(' · '))}</p>` : ''}
    <p class="stem">${esc(q.stem)}</p>
    ${isMulti(q) && !revealed ? `<p class="muted small">Choisis ${q.select} réponses${item.answer ? ` · ${chosenKeys(item.answer).length}/${q.select} cochée(s)` : ''}.</p>` : ''}
    ${item.order.map((k) => optionHtml(q, k, item, revealed, graded)).join('')}
    ${revealed ? explanationHtml(q, item) : ''}
    ${grid}
    ${finishBlock}
    <nav class="navbar">${nav}</nav>`;
}

function viewResult() {
  const s = S.session;
  const e = exam();
  const r = scoreSession(s, S.byId, e);
  $title.textContent = `Résultat · ${s.label}`;
  const official = s.mode === 'exam';
  const mins = Math.round((s.finishedAt - s.startedAt) / 60000);
  return `
    <div class="card">
      <p class="score">${r.total}/${r.max}</p>
      <p>${r.percent} % · ${mins} min ·
        ${passBadge(r)}
        ${official ? ` ${readinessBadge(readiness())}` : ''}</p>
      <p class="muted small">${r.passMark != null ? `Seuil ${r.passMark}/${r.max} · ` : ''}${r.goMark != null ? `${r.passMark != null ? 'objectif' : 'Objectif personnel'} avant de réserver ${r.goMark}/${r.max}${official ? `, à atteindre sur ${readiness().required} examens blancs consécutifs` : ''}` : ''}${official ? '' : ' (ramenés à la taille de la série)'}.</p>
      ${S.pack.scoreNote ? `<p class="muted small">${esc(S.pack.scoreNote)}</p>` : ''}
    </div>
    <h3>Par domaine</h3>
    ${Object.entries(r.byDomain).map(([d, v]) => {
      const pct = v.max ? Math.round((100 * v.points) / v.max) : 0;
      return `<div class="row small"><span>${esc(domainLabel(d))}</span><span>${v.points}/${v.max}</span></div>
        <div class="progress"><i class="${pct >= 75 ? 'ok' : pct < 60 ? 'ko' : ''}" style="width:${pct}%"></i></div>`;
    }).join('')}
    <h3>Questions</h3>
    <div class="grid">${s.items.map((it, k) => {
      const ok = scoreQuestion(S.byId.get(it.questionId), it.answer).correct;
      return `<button class="${ok ? 'ok' : 'ko'}" data-action="review" data-index="${k}">${k + 1}</button>`;
    }).join('')}</div>
    <p class="muted small">Touche un numéro pour revoir la question et son explication.</p>
    <button class="btn primary" data-action="home">Retour à l’accueil</button>`;
}

function viewStats() {
  const e = exam();
  $title.textContent = `Progression · ${e.name}`;
  const rows = e.domains.map((d) => {
    const pool = filterPool(S.questions, { exam: S.examId, domains: [d.id], set: null });
    let seen = 0, correct = 0, answers = 0, review = 0, mastered = 0;
    for (const q of pool) {
      const st = statOf(S.progress, q);
      if (st.seen) seen++;
      answers += st.seen;
      correct += st.correct;
      if (needsReview(st)) review++;
      if (st.box >= 3) mastered++;
    }
    const rate = answers ? Math.round((100 * correct) / answers) : null;
    return `<li><div class="row"><b>${esc(d.label)}</b><span class="muted small">${rate === null ? '—' : rate + ' % de réussite'}</span></div>
      <div class="progress"><i class="ok" style="width:${Math.round((100 * mastered) / pool.length)}%"></i></div>
      <span class="muted small">${mastered} maîtrisées · ${seen}/${pool.length} vues · ${review} à revoir</span></li>`;
  }).join('');
  const hist = S.progress.sessions.filter((x) => x.exam === S.examId).slice(-15).reverse();
  return `
    <ul class="list">${rows}</ul>
    ${objectivesHtml()}
    <h3>Dernières sessions</h3>
    ${hist.length ? `<ul class="list">${hist.map((h) => `<li class="row"><span>${esc(h.label)}<br><span class="muted small">${new Date(h.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
      <span class="badge ${h.go ? 'ok' : h.passed ? '' : 'ko'}">${h.total}/${h.max}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune session terminée.</p>'}
    <h3>Sauvegarde</h3>
    <p class="muted small">Ta progression est stockée dans ce navigateur. Exporte-la régulièrement pour la retrouver sur un autre appareil ou après un effacement des données. L’import fusionne : rien n’est perdu.</p>
    <p class="small">${lastExportText()}</p>
    <button class="btn" data-action="export"><span>Exporter ma progression<span class="sub">Fichier à enregistrer (Drive, e-mail, fichiers du téléphone)</span></span></button>
    <button class="btn" data-action="import"><span>Importer une sauvegarde<span class="sub">Fusionne avec la progression de cet appareil</span></span></button>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <h3>Données</h3>
    ${S.confirm === 'reset'
      ? `<div class="card"><p>Effacer toute la progression ${esc(S.pack.name)} sur cet appareil ?</p>
          <button class="btn danger" data-action="confirm-reset">Effacer</button><button class="btn" data-action="cancel">Annuler</button></div>`
      : '<button class="btn danger" data-action="reset">Effacer ma progression</button>'}`;
}

// ---------- Objectifs d'apprentissage ----------

const STATUS_INFO = {
  never: ['Jamais vu', 'neutral'],
  learning: ['En cours', ''],
  review: ['À réviser', 'ko'],
  acquired: ['Acquis', 'ok'],
};

function objectivesHtml() {
  const level = exam().objectiveLevel;
  const objs = S.objectives.filter((o) => o.level === level);
  if (!objs.length) return '';
  const { items, counts } = summarizeObjectives(objs, S.questions, S.progress);
  const withQ = items.filter((i) => i.questions > 0).length;
  const units = [...new Set(items.map((i) => i.unit))];
  const courseUrl = (path) => `${S.pack.source}/blob/main/${path}`;
  return `
    <h3>${esc(S.pack.objectives.label)} · niveau ${level}</h3>
    <div class="stat-row" style="grid-template-columns:repeat(4,1fr)">
      ${['acquired', 'learning', 'review', 'never'].map((st) => `<div class="stat"><b>${counts[st]}</b><span>${STATUS_INFO[st][0].toLowerCase()}</span></div>`).join('')}
    </div>
    <div class="progress"><i class="ok" style="width:${withQ ? Math.round((100 * counts.acquired) / withQ) : 0}%"></i></div>
    <p class="muted small">${counts.acquired}/${withQ} objectifs acquis (au moins 3 réponses et 75 % de réussite, aucune erreur en attente). ${esc(S.pack.objectives.note)}</p>
    ${units.map((u) => {
      const list = items.filter((i) => i.unit === u);
      const acq = list.filter((i) => i.status === 'acquired').length;
      return `<details class="unit"><summary><b>U${u} · ${esc(list[0].unitLabel)}</b> <span class="muted small">${acq}/${list.filter((i) => i.questions).length} acquis</span></summary>
        <ul class="list">${list.map((o) => `<li>
          <div class="row"><span><b>${o.id}</b> ${esc(o.label)}</span>${o.questions ? `<span class="badge ${STATUS_INFO[o.status][1]}">${STATUS_INFO[o.status][0]}</span>` : '<span class="badge">Sans question</span>'}</div>
          <span class="muted small">${o.questions} question(s)${o.answers ? ` · ${o.answers} réponse(s) · ${Math.round(100 * o.rate)} %` : ''}${o.review ? ` · ${o.review} à revoir` : ''}</span>
          <div class="row small" style="margin-top:4px">${o.course ? `<a href="${esc(courseUrl(o.course))}" target="_blank" rel="noopener">Fiche de cours</a>` : '<span></span>'}
            ${o.questions ? `<button class="btn compact" data-action="train-objective" data-objective="${o.id}">S’entraîner</button>` : ''}</div>
        </li>`).join('')}</ul></details>`;
    }).join('')}`;
}

// ---------- Sauvegarde ----------

function lastExportText() {
  const at = S.store.get('lastExport');
  if (!at) return 'Aucune sauvegarde exportée depuis cet appareil.';
  const days = Math.floor((Date.now() - at) / 86_400_000);
  return `Dernière sauvegarde : ${days === 0 ? 'aujourd’hui' : days === 1 ? 'hier' : `il y a ${days} jours`}.`;
}

function backupDue() {
  const seen = Object.keys(S.progress.questions).length;
  const at = S.store.get('lastExport');
  return seen >= 20 && (!at || Date.now() - at > 14 * 86_400_000);
}

async function doExport() {
  const day = new Date().toISOString().slice(0, 10);
  const name = `cert-trainer-${S.pack.id}-${day}.json`;
  const json = JSON.stringify(exportProgress(S.pack.id, S.progress));
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sauvegarde Cert Exam Trainer' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }
    S.store.set('lastExport', Date.now());
    render();
    alertInline(`Sauvegarde créée : ${name}`);
  } catch (err) {
    if (err?.name !== 'AbortError') alertInline('L’export a échoué. Réessaie.');
  }
}

async function doImport(fileInput) {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const { progress, error } = parseProgressFile(await file.text(), S.pack.id);
  if (error) { alertInline(error); return; }
  const before = Object.keys(S.progress.questions).length;
  S.progress = mergeProgress(S.progress, progress, {
    revById: new Map(S.questions.map((q) => [q.id, q.rev])),
    resets: S.pack.resets ?? [],
  });
  save();
  render();
  const after = Object.keys(S.progress.questions).length;
  alertInline(`Sauvegarde importée : ${after} questions suivies (${after - before} nouvelle(s)), ${S.progress.sessions.length} session(s) dans l’historique.`);
}

document.addEventListener('change', (ev) => {
  if (ev.target.id === 'import-file') doImport(ev.target);
});

// ---------- Actions ----------

function startSession(mode, questions, label) {
  const e = exam();
  S.session = createSession({ mode, exam: S.examId, questions, rng: rng(), label, durationMinutes: mode === 'exam' ? e.durationMinutes : null });
  S.showGrid = false;
  save();
  navigate('session');
}

function endSession() {
  S.session = finish(S.session);
  const r = scoreSession(S.session, S.byId, exam());
  if (S.session.mode === 'exam') {
    for (const it of S.session.items) {
      if (it.answer !== null) S.progress = recordAnswer(S.progress, S.byId.get(it.questionId), scoreQuestion(S.byId.get(it.questionId), it.answer).correct);
    }
  }
  S.progress = recordSession(S.progress, {
    at: Date.now(), exam: S.session.exam, mode: S.session.mode, label: S.session.label,
    total: r.total, max: r.max, passed: r.passed, go: S.session.mode === 'exam' ? r.go : false, count: S.session.items.length,
  });
  save();
  S.store.set('lastSession', S.session);
  navigate('result', true);
}

const actions = {
  home: () => navigate('home'),
  go: (el) => navigate(el.dataset.view),
  'set-pack': (el) => {
    if (el.dataset.pack === S.pack.id) return;
    save();
    clearInterval(timerHandle);
    try { localStorage.setItem('cet:activePack', el.dataset.pack); } catch { /* stockage indisponible */ }
    S.session = null;
    S.setup = { strategy: 'adaptive', count: 20, domains: [], series: [] };
    loadPack(el.dataset.pack);
  },
  'set-exam': (el) => { S.examId = el.dataset.exam; S.setup.domains = []; S.setup.series = []; save(); render(); },
  'set-strategy': (el) => { S.setup.strategy = el.dataset.strategy; save(); render(); },
  'set-count': (el) => { S.setup.count = Number(el.dataset.count); save(); render(); },
  'toggle-series': (el) => {
    const d = el.dataset.series;
    S.setup.series = S.setup.series.includes(d) ? S.setup.series.filter((x) => x !== d) : [...S.setup.series, d];
    save(); render();
  },
  'toggle-domain': (el) => {
    const d = el.dataset.domain;
    S.setup.domains = S.setup.domains.includes(d) ? S.setup.domains.filter((x) => x !== d) : [...S.setup.domains, d];
    save(); render();
  },
  'start-training': () => {
    const pool = filterPool(S.questions, { exam: S.examId, domains: S.setup.domains, series: S.setup.series });
    const count = S.setup.count || pool.length;
    const offsets = S.store.get('offsets', {});
    const key = `${S.examId}:${S.setup.domains.slice().sort().join(',')}:${S.setup.series.slice().sort().join(',')}`;
    const qs = selectQuestions(pool, { strategy: S.setup.strategy, count, offset: offsets[key] ?? 0, progress: S.progress, rng: rng() });
    if (!qs.length) { alertInline('Aucune question ne correspond : rien à revoir pour l’instant.'); return; }
    if (S.setup.strategy === 'sequential') { offsets[key] = ((offsets[key] ?? 0) + qs.length) % pool.length; S.store.set('offsets', offsets); }
    startSession('training', qs, `Entraînement · ${STRATEGY_INFO[S.setup.strategy][0]}`);
  },
  'review-errors': () => {
    const pool = filterPool(S.questions, { exam: S.examId, set: null });
    const qs = selectQuestions(pool, { strategy: 'review', count: 20, progress: S.progress, rng: rng() });
    if (!qs.length) { alertInline('Aucune erreur à revoir : fais d’abord un entraînement ou un examen blanc.'); return; }
    startSession('training', qs, 'Revoir mes erreurs');
  },
  'start-exam': (el) => {
    const kind = el.dataset.kind;
    if (kind === 'fixed') {
      startSession('exam', fixedSet(S.questions, S.examId, el.dataset.set), `Examen blanc ${el.dataset.set.replace('mock-', '')}`);
    } else {
      const qs = generateExam(S.questions, exam(), { rng: rng(), progress: S.progress, adaptive: kind === 'adaptive' });
      startSession('exam', qs, kind === 'adaptive' ? 'Examen ciblé' : 'Examen aléatoire');
    }
  },
  resume: () => navigate('session'),
  choose: (el) => {
    const s = S.session;
    if (s.status !== 'in_progress') return;
    const wasAnswered = isAnswered(s.items[s.current]);
    S.session = answer(s, s.current, el.dataset.key);
    if (S.session.status === 'finished') { endSession(); return; }
    const item = S.session.items[S.session.current];
    if (S.session.mode === 'training' && !wasAnswered && isAnswered(item)) {
      const q = S.byId.get(item.questionId);
      S.progress = recordAnswer(S.progress, q, scoreQuestion(q, item.answer).correct);
    }
    save(); render();
  },
  next: () => { S.session = goTo(S.session, S.session.current + 1); save(); render(); },
  prev: () => { S.session = goTo(S.session, S.session.current - 1); save(); render(); },
  goto: (el) => { S.session = goTo(S.session, Number(el.dataset.index)); save(); render(); },
  flag: () => { S.session = toggleFlag(S.session, S.session.current); save(); render(); },
  'toggle-grid': () => { S.showGrid = !S.showGrid; render(); },
  finish: () => {
    if (S.session.mode === 'exam' && answeredCount(S.session) < S.session.items.length) { rerenderWith('finish'); return; }
    endSession();
  },
  'confirm-finish': () => endSession(),
  cancel: () => render(),
  review: (el) => { S.session = goTo(S.session, Number(el.dataset.index)); S.showGrid = false; navigate('session'); },
  'train-objective': (el) => {
    const id = el.dataset.objective;
    const qs = questionsByObjective(S.questions).get(id) ?? [];
    if (!qs.length) return;
    const ordered = selectQuestions(qs, { strategy: 'adaptive', count: qs.length, progress: S.progress, rng: rng() });
    startSession('training', ordered, `Objectif ${id}`);
  },
  export: () => doExport(),
  import: () => document.getElementById('import-file')?.click(),
  reset: () => rerenderWith('reset'),
  'confirm-reset': () => { S.progress = emptyProgress(); S.session = null; S.store.remove('lastSession'); S.store.remove('offsets'); save(); navigate('home'); },
};

function rerenderWith(confirm) {
  const y = window.scrollY;
  render();
  S.confirm = confirm;
  const view = currentView();
  $view.innerHTML = (view === 'stats' ? viewStats : viewSession)();
  window.scrollTo(0, y);
}

function alertInline(msg) {
  const p = document.createElement('p');
  p.className = 'card small';
  p.textContent = msg;
  $view.prepend(p);
  window.scrollTo(0, 0);
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { ev.preventDefault(); fn(el); }
});

// ---------- Chronomètre ----------

function updateTimer() {
  const s = S.session;
  const show = s && s.status === 'in_progress' && s.deadline && currentView() === 'session';
  $timer.hidden = !show;
  if (!show) return;
  const ms = remainingMs(s);
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  $timer.textContent = `${m}:${String(sec).padStart(2, '0')}`;
  $timer.classList.toggle('low', ms < 5 * 60000);
  if (isExpired(s)) endSession();
}

// ---------- Démarrage ----------

async function boot() {
  try {
    S.packs = await (await fetch('packs/index.json')).json();
    let wanted = null;
    try { wanted = localStorage.getItem('cet:activePack'); } catch { /* stockage indisponible */ }
    await loadPack(wanted, { home: false });
  } catch (err) {
    $view.innerHTML = `<div class="card"><p><b>Impossible de charger les questions.</b></p><p class="muted small">${esc(err.message)}</p></div>`;
  }
}

// Charge un pack (certification) : questions, progression et préférences propres au pack.
async function loadPack(packId, { home = true } = {}) {
  try {
    const entry = S.packs.find((p) => p.id === packId) ?? S.packs[0];
    const [pack, questions] = await Promise.all([
      fetch(`${entry.path}pack.json`).then((r) => r.json()),
      fetch(`${entry.path}questions.json`).then((r) => r.json()),
    ]);
    S.pack = pack;
    S.questions = questions;
    S.byId = new Map(questions.map((q) => [q.id, q]));
    S.objectives = [];
    if (pack.objectives?.file) {
      S.objectives = await fetch(`${entry.path}${pack.objectives.file}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    }
    S.store = createLocalStorage(`cet:${pack.id}:`);
    // Remises à zéro déclarées par le pack (barème corrigé…), appliquées une seule fois.
    S.progress = applyResets(S.store.get('progress', emptyProgress()), pack.resets);
    S.store.set('progress', S.progress);
    const prefs = S.store.get('prefs', {});
    S.examId = pack.exams.some((e) => e.id === prefs.examId) ? prefs.examId : pack.exams[0].id;
    S.setup = { ...S.setup, ...(prefs.setup ?? {}) };
    S.session = S.store.get('session') ?? S.store.get('lastSession') ?? null;
    // Une session qui référence des questions retirées du pack n'est plus jouable.
    if (S.session && !S.session.items.every((it) => S.byId.has(it.questionId))) {
      S.session = null;
      S.store.remove('session');
      S.store.remove('lastSession');
    }
    S.setup.series = (S.setup.series ?? []).filter((id) => pack.series?.some((x) => x.id === id));
    if (S.session && S.session.status === 'in_progress' && isExpired(S.session)) endSession();
    if (home) navigate('home', true);
    else render();
    clearInterval(timerHandle);
    timerHandle = setInterval(updateTimer, 1000);
  } catch (err) {
    $view.innerHTML = `<div class="card"><p><b>Impossible de charger les questions.</b></p><p class="muted small">${esc(err.message)}</p></div>`;
  }
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
