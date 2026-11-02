// Suivi de progression par question, indépendant de toute certification.
// La difficulté n'est pas saisie : elle est mesurée à partir des réponses.
// La révision des erreurs suit un système de boîtes de Leitner.

const DAY = 24 * 60 * 60 * 1000;
export const BOX_INTERVAL_DAYS = [0, 0, 1, 3, 7, 14]; // index = boîte (1 à 5)
export const MAX_BOX = 5;

export function emptyProgress() {
  return { version: 1, questions: {}, sessions: [], migrations: [] };
}

const EMPTY_STAT = Object.freeze({ seen: 0, correct: 0, wrong: 0, box: 0, lastAt: 0, lastCorrect: null });

// `q` est une question ({ id, rev }) ou un identifiant seul.
const idOf = (q) => (typeof q === 'string' ? q : q.id);
const revOf = (q) => (typeof q === 'string' ? undefined : q.rev);

// Une statistique est obsolète quand elle a été enregistrée pour une autre version
// de la question (empreinte « rev » différente : énoncé, options ou points modifiés).
// Une statistique sans « rev » (enregistrée avant cette règle) est conservée.
export function isStale(stat, rev) {
  return Boolean(stat && stat.rev && rev && stat.rev !== rev);
}

export function statOf(progress, q) {
  const s = progress.questions[idOf(q)];
  if (!s || isStale(s, revOf(q))) return { ...EMPTY_STAT };
  return s;
}

// Enregistre une réponse. `correct` = la meilleure option a été choisie.
// La statistique d'une version précédente de la question repart de zéro.
export function recordAnswer(progress, q, correct, now = Date.now()) {
  const id = idOf(q);
  const rev = revOf(q);
  const s = statOf(progress, q);
  const next = {
    seen: s.seen + 1,
    correct: s.correct + (correct ? 1 : 0),
    wrong: s.wrong + (correct ? 0 : 1),
    box: correct ? Math.min(MAX_BOX, Math.max(1, s.box) + 1) : 1,
    lastAt: now,
    lastCorrect: correct,
    ...(rev ? { rev } : {}),
  };
  return { ...progress, questions: { ...progress.questions, [id]: next } };
}

// Difficulté mesurée entre 0 (facile) et 1 (difficile), lissée pour les
// questions peu vues (une question jamais vue vaut 0,5).
export function difficulty(stat) {
  return (stat.wrong + 1) / (stat.seen + 2);
}

export function isDue(stat, now = Date.now()) {
  if (stat.seen === 0) return false;
  return now - stat.lastAt >= BOX_INTERVAL_DAYS[stat.box] * DAY;
}

// « À revoir » : déjà ratée au moins une fois et pas encore maîtrisée (boîte < 3).
export function needsReview(stat) {
  return stat.wrong > 0 && stat.box < 3;
}

export function recordSession(progress, summary) {
  const sessions = [...progress.sessions, summary].slice(-200);
  return { ...progress, sessions };
}

// ---------- Sauvegarde : export, import, fusion ----------
// Format de fichier indépendant du navigateur, pour changer d'appareil ou
// se protéger d'un effacement des données du navigateur.

export const EXPORT_FORMAT = 'cert-exam-trainer/progress';

export function exportProgress(packId, progress, now = Date.now()) {
  return { format: EXPORT_FORMAT, version: 1, pack: packId, exportedAt: new Date(now).toISOString(), progress };
}

// Lit un fichier exporté. Retourne { progress } ou { error } (message lisible).
export function parseProgressFile(text, packId) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'Ce fichier n’est pas une sauvegarde valide (JSON illisible).' };
  }
  if (data?.format !== EXPORT_FORMAT) return { error: 'Ce fichier n’est pas une sauvegarde Cert Exam Trainer.' };
  if (data.pack !== packId) return { error: `Cette sauvegarde concerne le pack « ${data.pack} », pas « ${packId} ».` };
  const p = data.progress;
  if (!p || typeof p.questions !== 'object' || !Array.isArray(p.sessions)) return { error: 'Sauvegarde incomplète.' };
  for (const s of Object.values(p.questions)) {
    if (![s?.seen, s?.correct, s?.wrong, s?.box, s?.lastAt].every(Number.isFinite)) return { error: 'Sauvegarde corrompue.' };
  }
  return { progress: { version: 1, questions: p.questions, sessions: p.sessions, migrations: Array.isArray(p.migrations) ? p.migrations : [] } };
}

// Remises à zéro ponctuelles déclarées par le pack (ex. barème corrigé) :
// chacune s'applique une seule fois, identifiée par son `id`.
export function applyResets(progress, resets = []) {
  const done = new Set(progress.migrations ?? []);
  let questions = progress.questions;
  for (const r of resets) {
    if (done.has(r.id)) continue;
    questions = { ...questions };
    for (const qid of r.questions) {
      // Une statistique déjà portée par une « rev » est jugée par sa rev, pas par la migration.
      if (questions[qid] && !questions[qid].rev) delete questions[qid];
    }
    done.add(r.id);
  }
  return { ...progress, questions, migrations: [...done] };
}

// Retire les statistiques obsolètes au regard des « rev » actuelles du pack.
export function dropStale(progress, revById) {
  const questions = {};
  for (const [id, s] of Object.entries(progress.questions)) if (!isStale(s, revById.get(id))) questions[id] = s;
  return { ...progress, questions };
}

// Fusionne deux progressions sans rien perdre : pour chaque question, on garde
// l'état le plus récent ; les historiques de sessions sont réunis sans doublon.
// Avec `revById` et `resets`, les mêmes règles que sur l'appareil s'appliquent
// (statistiques d'une ancienne version de question ignorées, remises à zéro du pack).
export function mergeProgress(a, b, { revById = null, resets = [] } = {}) {
  const prep = (p) => {
    const migrated = applyResets({ migrations: [], ...p }, resets);
    return revById ? dropStale(migrated, revById) : migrated;
  };
  const left = prep(a);
  const right = prep(b);
  const questions = { ...left.questions };
  for (const [id, s] of Object.entries(right.questions)) {
    const cur = questions[id];
    if (!cur || s.lastAt > cur.lastAt || (s.lastAt === cur.lastAt && s.seen > cur.seen)) questions[id] = s;
  }
  const seen = new Set();
  const sessions = [...a.sessions, ...b.sessions]
    .filter((s) => {
      const k = `${s.at}|${s.label}|${s.total}|${s.max}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => x.at - y.at)
    .slice(-200);
  const migrations = [...new Set([...(left.migrations ?? []), ...(right.migrations ?? [])])];
  return { version: 1, questions, sessions, migrations };
}

// ---------- Prêt à réserver ----------
// Règle de la Vision (docs/architecture/01-vision.md) : l'objectif `goMark` doit
// être atteint sur les `required` derniers examens blancs terminés, consécutifs.
// Seuls les examens blancs (mode « exam ») de l'examen concerné comptent.

export const READINESS_STREAK = 3;

export function reachedGoMark(session, examDef) {
  if (!examDef?.goMark || !examDef?.maxPoints || !session.max) return false;
  return session.total >= Math.ceil((examDef.goMark / examDef.maxPoints) * session.max);
}

export function bookingReadiness(sessions, examDef, required = READINESS_STREAK) {
  const exams = sessions.filter((s) => s.exam === examDef.id && s.mode === 'exam').sort((a, b) => a.at - b.at);
  let streak = 0;
  for (let i = exams.length - 1; i >= 0 && streak < required; i--) {
    if (!reachedGoMark(exams[i], examDef)) break;
    streak++;
  }
  return { ready: streak >= required, streak, required, examsTaken: exams.length };
}
