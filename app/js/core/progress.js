// Suivi de progression par question, indépendant de toute certification.
// La difficulté n'est pas saisie : elle est mesurée à partir des réponses.
// La révision des erreurs suit un système de boîtes de Leitner.

const DAY = 24 * 60 * 60 * 1000;
export const BOX_INTERVAL_DAYS = [0, 0, 1, 3, 7, 14]; // index = boîte (1 à 5)
export const MAX_BOX = 5;

export function emptyProgress() {
  return { version: 1, questions: {}, sessions: [] };
}

export function statOf(progress, id) {
  return progress.questions[id] ?? { seen: 0, correct: 0, wrong: 0, box: 0, lastAt: 0, lastCorrect: null };
}

// Enregistre une réponse. `correct` = la meilleure option a été choisie.
export function recordAnswer(progress, id, correct, now = Date.now()) {
  const s = statOf(progress, id);
  const next = {
    seen: s.seen + 1,
    correct: s.correct + (correct ? 1 : 0),
    wrong: s.wrong + (correct ? 0 : 1),
    box: correct ? Math.min(MAX_BOX, Math.max(1, s.box) + 1) : 1,
    lastAt: now,
    lastCorrect: correct,
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
  return { progress: { version: 1, questions: p.questions, sessions: p.sessions } };
}

// Fusionne deux progressions sans rien perdre : pour chaque question, on garde
// l'état le plus récent ; les historiques de sessions sont réunis sans doublon.
export function mergeProgress(a, b) {
  const questions = { ...a.questions };
  for (const [id, s] of Object.entries(b.questions)) {
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
  return { version: 1, questions, sessions };
}
