// Empreinte « rev » d'une question : change quand l'énoncé, le texte d'une option
// ou ses points changent ; ne change pas pour une justification ou une explication.
// La progression enregistrée pour une ancienne rev n'est plus prise en compte.

import { createHash } from 'node:crypto';

export function questionRev(q) {
  const options = [...q.options].sort((a, b) => a.key.localeCompare(b.key)).map((o) => [o.key, o.text, o.points]);
  return createHash('sha256').update(JSON.stringify([q.stem, options])).digest('hex').slice(0, 8);
}
