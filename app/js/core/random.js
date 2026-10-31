// Générateur pseudo-aléatoire avec graine (mulberry32) : rend le mélange
// reproductible dans les tests et rejouable pour une session donnée.

export function createRng(seed = Date.now()) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mélange de Fisher-Yates, sans modifier le tableau d'origine.
export function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Tirage pondéré sans remise de `count` éléments.
export function weightedSample(items, weightOf, count, rng) {
  const pool = items.map((item) => ({ item, w: Math.max(weightOf(item), 1e-6) }));
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rng() * total;
    let i = 0;
    while (i < pool.length - 1 && r >= pool[i].w) { r -= pool[i].w; i++; }
    picked.push(pool.splice(i, 1)[0].item);
  }
  return picked;
}
