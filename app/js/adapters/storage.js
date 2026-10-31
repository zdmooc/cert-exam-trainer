// Adaptateur de stockage (port « StoragePort ») : get / set / remove de JSON.
// Implémentation navigateur sur localStorage ; repli en mémoire si le stockage
// est indisponible (navigation privée, quotas). Remplaçable plus tard par une
// synchronisation distante sans toucher au moteur.

export function createLocalStorage(prefix) {
  const memory = new Map();
  const ls = (() => {
    try {
      const k = '__cet_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch {
      return null;
    }
  })();

  return {
    persistent: ls !== null,
    get(key, fallback = null) {
      try {
        const raw = ls ? ls.getItem(prefix + key) : memory.get(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try {
        if (ls) ls.setItem(prefix + key, raw);
        else memory.set(prefix + key, raw);
      } catch {
        memory.set(prefix + key, raw);
      }
    },
    remove(key) {
      try {
        if (ls) ls.removeItem(prefix + key);
      } catch { /* rien */ }
      memory.delete(prefix + key);
    },
  };
}
