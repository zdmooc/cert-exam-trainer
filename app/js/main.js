// Couche interface : relie le moteur (js/core), le stockage (js/adapters)
// et le contenu (packs/). Aucune règle de certification ici : tout vient du pack.

import { createRng } from './core/random.js';
import { scoreQuestion, scoreSession } from './core/scoring.js';
import {
  createSession, answer, finish, toggleFlag, goTo, canReveal, isExpired, remainingMs, answeredCount,
} from './core/session.js';
import { filterPool, selectQuestions, generateExam, fixedSet, listFixedSets } from './core/selection.js';
import { emptyProgress, recordAnswer, recordSession, statOf, needsReview } from './core/progress.js';
import { createLocalStorage } from './adapters/storage.js';

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $timer = document.getElementById('timer');
const $homeBtn = document.getElementById('home-btn');

const S = {
  pack: null, questions: [], byId: new Map(), store: null,
  examId: null, progress: emptyProgress(), session: null,
  setup: { strategy: 'adaptive', count: 20, domains: [] },
  confirm: null, showGrid: false,
};
let timerHandle = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const exam = () => S.pack.exams.find((e) => e.id === S.examId);
const domainLabel = (id) => exam()?.domains.find((d) => d.id === id)?.label ?? id;
const isGraded = (q) => Math.max(...q.options.map((o) => o.points)) > 1;
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
    const s = statOf(S.progress, q.id);
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
      <p class="muted small">Seuil ${e.passMark}/${e.maxPoints} · objectif avant de réserver ${e.goMark}/${e.maxPoints}</p></div>` : ''}
    ${ongoing ? `<button class="btn primary" data-action="resume">Reprendre la session<span class="sub">&nbsp;· ${answeredCount(S.session)}/${S.session.items.length}</span></button>` : ''}
    <button class="btn" data-action="go" data-view="train"><span>Entraînement<span class="sub">Correction et explication après chaque question</span></span></button>
    <button class="btn" data-action="go" data-view="exam"><span>Examen blanc<span class="sub">${e.questionCount} questions · ${e.durationMinutes} min · correction à la fin</span></span></button>
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
  const pool = filterPool(S.questions, { exam: S.examId, domains: S.setup.domains });
  const counts = [10, 20, 40, 0];
  return `
    <h3>Mode de sélection</h3>
    ${Object.entries(STRATEGY_INFO).map(([k, [name, sub]]) => `
      <button class="option" data-action="set-strategy" data-strategy="${k}" aria-pressed="${S.setup.strategy === k}">
        <b>${name}</b><br><span class="muted small">${sub}</span></button>`).join('')}
    <h3>Nombre de questions</h3>
    <div class="chips">${counts.map((c) => `<button class="chip" data-action="set-count" data-count="${c}" aria-pressed="${S.setup.count === c}">${c || 'Toutes'}</button>`).join('')}</div>
    <h3>Domaines <span class="muted small">(aucun = tous)</span></h3>
    <div class="chips">${exam().domains.map((d) => `<button class="chip" data-action="toggle-domain" data-domain="${d.id}" aria-pressed="${S.setup.domains.includes(d.id)}">${esc(d.label)}</button>`).join('')}</div>
    <p class="muted small">${pool.length} question(s) dans la sélection.</p>
    <button class="btn primary" data-action="start-training">Commencer</button>`;
}

function viewExam() {
  const e = exam();
  $title.textContent = `Examen blanc · ${e.name}`;
  const sets = listFixedSets(S.questions, S.examId);
  const last = (label) => [...S.progress.sessions].reverse().find((s) => s.exam === S.examId && s.label === label);
  return `
    <div class="card small">${e.questionCount} questions · ${e.durationMinutes} min · seuil ${e.passMark}/${e.maxPoints}.
      ${e.openBook ? 'Livre ouvert : garde le PDF du standard (en anglais) à côté, comme le jour de l’examen.' : 'Documentation fermée.'}
      La correction n’apparaît qu’à la fin.</div>
    <h3>Examen généré selon la répartition officielle</h3>
    <button class="btn" data-action="start-exam" data-kind="random"><span>Nouvel examen aléatoire<span class="sub">Tiré dans toute la banque</span></span></button>
    <button class="btn" data-action="start-exam" data-kind="adaptive"><span>Examen ciblé sur mes faiblesses<span class="sub">Même répartition, questions moins maîtrisées en priorité</span></span></button>
    <h3>Examens blancs du dépôt</h3>
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
  let cls = '';
  if (revealed && key === r.bestKey) cls = 'best';
  else if (revealed && key === item.answer) cls = 'wrong';
  const pts = revealed && graded ? `<span class="pts">${opt.points} pt${opt.points > 1 ? 's' : ''}</span>` : '';
  return `<button class="option ${cls}" data-action="choose" data-key="${key}" aria-pressed="${item.answer === key}" ${revealed ? 'disabled' : ''}>${pts}${esc(opt.text)}</button>`;
}

function explanationHtml(q, item) {
  const r = scoreQuestion(q, item.answer);
  const verdict = !r.answered ? 'Non répondue' : r.correct ? 'Bonne réponse' : isGraded(q) ? `Pas la meilleure réponse · ${r.points}/${r.max} points` : 'Mauvaise réponse';
  const src = S.pack.source && q.source ? `${S.pack.source}/blob/main/${q.source}` : null;
  return `
    <div class="explain ${r.correct ? 'ok' : 'ko'}">
      <p><b>${verdict}</b></p>
      <p>${esc(q.explanation)}</p>
      <p class="muted small">L’explication désigne les options par leur lettre d’origine :</p>
      <ol>${q.options.map((o) => `<li><span class="k">${o.key}</span>${esc(o.text)}${isGraded(q) ? ` <span class="muted small">(${o.points})</span>` : ''}${o.key === r.bestKey ? ' ✓' : ''}${o.key === item.answer && !r.correct ? ' ✗ ton choix' : ''}</li>`).join('')}</ol>
      ${q.topic ? `<p class="muted small">${esc(q.topic)}</p>` : ''}
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
    nav = item.answer === null
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
      let c = it.answer !== null ? 'done' : '';
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
    ${q.title ? `<p class="muted small" style="margin-top:10px">${esc(q.title)}</p>` : ''}
    <p class="stem">${esc(q.stem)}</p>
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
        ${r.passed ? '<span class="badge ok">Seuil atteint</span>' : '<span class="badge ko">Sous le seuil</span>'}
        ${official ? (r.go ? ' <span class="badge ok">Prêt à réserver</span>' : '') : ''}</p>
      <p class="muted small">Seuil ${r.passMark}/${r.max}${r.goMark != null ? ` · objectif avant de réserver ${r.goMark}/${r.max}` : ''}${official ? '' : ' (ramenés à la taille de la série)'}.</p>
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
      const st = statOf(S.progress, q.id);
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
    <h3>Dernières sessions</h3>
    ${hist.length ? `<ul class="list">${hist.map((h) => `<li class="row"><span>${esc(h.label)}<br><span class="muted small">${new Date(h.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
      <span class="badge ${h.go ? 'ok' : h.passed ? '' : 'ko'}">${h.total}/${h.max}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune session terminée.</p>'}
    <h3>Données</h3>
    ${S.confirm === 'reset'
      ? `<div class="card"><p>Effacer toute la progression ${esc(S.pack.name)} sur cet appareil ?</p>
          <button class="btn danger" data-action="confirm-reset">Effacer</button><button class="btn" data-action="cancel">Annuler</button></div>`
      : '<button class="btn danger" data-action="reset">Effacer ma progression</button>'}`;
}

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
      if (it.answer !== null) S.progress = recordAnswer(S.progress, it.questionId, scoreQuestion(S.byId.get(it.questionId), it.answer).correct);
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
  'set-exam': (el) => { S.examId = el.dataset.exam; S.setup.domains = []; save(); render(); },
  'set-strategy': (el) => { S.setup.strategy = el.dataset.strategy; save(); render(); },
  'set-count': (el) => { S.setup.count = Number(el.dataset.count); save(); render(); },
  'toggle-domain': (el) => {
    const d = el.dataset.domain;
    S.setup.domains = S.setup.domains.includes(d) ? S.setup.domains.filter((x) => x !== d) : [...S.setup.domains, d];
    save(); render();
  },
  'start-training': () => {
    const pool = filterPool(S.questions, { exam: S.examId, domains: S.setup.domains });
    const count = S.setup.count || pool.length;
    const offsets = S.store.get('offsets', {});
    const key = `${S.examId}:${S.setup.domains.slice().sort().join(',')}`;
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
    const before = s.items[s.current].answer;
    S.session = answer(s, s.current, el.dataset.key);
    if (S.session.status === 'finished') { endSession(); return; }
    if (S.session.mode === 'training' && before === null) {
      const q = S.byId.get(s.items[s.current].questionId);
      S.progress = recordAnswer(S.progress, q.id, scoreQuestion(q, el.dataset.key).correct);
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
    const packs = await (await fetch('packs/index.json')).json();
    const entry = packs[0];
    const [pack, questions] = await Promise.all([
      fetch(`${entry.path}pack.json`).then((r) => r.json()),
      fetch(`${entry.path}questions.json`).then((r) => r.json()),
    ]);
    S.pack = pack;
    S.questions = questions;
    S.byId = new Map(questions.map((q) => [q.id, q]));
    S.store = createLocalStorage(`cet:${pack.id}:`);
    S.progress = S.store.get('progress', emptyProgress());
    const prefs = S.store.get('prefs', {});
    S.examId = pack.exams.some((e) => e.id === prefs.examId) ? prefs.examId : pack.exams[0].id;
    S.setup = { ...S.setup, ...(prefs.setup ?? {}) };
    S.session = S.store.get('session') ?? S.store.get('lastSession');
    if (S.session && S.session.status === 'in_progress' && isExpired(S.session)) endSession();
    render();
    timerHandle = setInterval(updateTimer, 1000);
  } catch (err) {
    $view.innerHTML = `<div class="card"><p><b>Impossible de charger les questions.</b></p><p class="muted small">${esc(err.message)}</p></div>`;
  }
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
