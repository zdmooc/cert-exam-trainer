# Phase C — Data Architecture

## Entités

| Entité | Où elle vit | Propriétaire |
| --- | --- | --- |
| Pack (définition d'examens, domaines, seuils) | `app/packs/<id>/pack.json` | Dépôt de l'appli |
| Question, Option | `app/packs/<id>/questions.json`, généré depuis le dépôt de cours | Dépôt de cours |
| Session (en cours ou dernière terminée) | Stockage local de l'appareil | Utilisateur |
| Progression par question, historique | Stockage local de l'appareil | Utilisateur |

## Définition d'examen (`pack.json`)

| Champ | Exemple TOGAF F101 | Rôle |
| --- | --- | --- |
| `id`, `name` | `f101`, « Foundation (OGEA-F101) » | Identification |
| `questionCount`, `durationMinutes` | 40, 60 | Format de l'examen blanc |
| `maxPoints`, `passMark`, `goMark` | 40, 24, 32 | Seuil officiel et objectif avant réservation. `passMark: null` quand le seuil officiel n'est pas un nombre de points (examens Claude, 720/1000 échelonné) : pas de verdict, seul l'objectif personnel est affiché |
| `domains[] {id, label, count}` | `adm`, « Introduction à l'ADM », 14 | Répartition officielle |
| `openBook` | `false` | Information affichée |

## Question (`questions.json`)

```json
{
  "id": "togaf-f102-s022",
  "exam": "f102",
  "set": "bank",
  "order": 1,
  "domain": "bcd",
  "title": "Capability ou application ?",
  "stem": "En Phase B, une équipe affirme…",
  "options": [
    { "key": "A", "text": "Définir Payment Validation comme business capability…", "points": 5 },
    { "key": "B", "text": "…", "points": 3, "rationale": "Pourquoi cette option vaut 3 points" },
    { "key": "C", "text": "…", "points": 1 },
    { "key": "D", "text": "…", "points": 0 }
  ],
  "series": "bank",
  "lo": "L2.4.2",
  "rev": "3f9a1c02",
  "explanation": "…",
  "topic": "Architecture Development — Phase B vs Phase C",
  "source": "10-practitioner-scenarios/04-bcd-s022-s030.md"
}
```

- `set` vaut `bank` (banque d'entraînement) ou l'identifiant d'un examen blanc figé (`mock-01`…).
- Le barème est porté par les **points de chaque option** : 1/0 pour un QCM simple, 5/3/1/0 pour un scénario gradué. Le moteur n'a pas d'autre notion de barème.
- `select` (facultatif, ≥ 2) : question à plusieurs réponses. Exactement `select` options valent 1 point ; la réponse enregistrée est un tableau de lettres et ne rapporte 1 point que si toutes les bonnes options sont cochées (pas de point partiel).
- `key` est la lettre d'origine, utilisée seulement pour relier l'explication aux options.
- `series` regroupe les questions par série d'exercices (déclarées dans `pack.json` → `series`) ; filtrable en entraînement.
- `lo` (facultatif) est l'objectif d'apprentissage écrit à côté de la question dans le dépôt de cours (ex. X2202 `L2.1.7`).
- `los` (facultatif) liste les objectifs auxquels la matrice de traçabilité du dépôt de cours rattache la question (une question peut en servir plusieurs). Rattachement **candidat, non relu** : il sert à détecter les manques et à orienter la révision, pas à certifier une couverture.
- `rev` est l'empreinte de la question (8 caractères de SHA-256 sur l'énoncé, le texte et les points des options ; voir `content-pipeline/rev.mjs`). Elle ne change pas pour une justification ou une explication (ADR-004).
- `rationale` (facultatif, par option) justifie le score de l'option ; l'appli l'affiche sous chaque réponse dans la correction.

## Objectifs (`objectives.json`)

Généré depuis `14-official-sources/06-x2202-learning-outcome-traceability.md` du dépôt de cours :

| Champ | Exemple |
| --- | --- |
| `id`, `level`, `unit`, `unitLabel` | `L2.1.5`, 2, 1, « Context for Enterprise Architecture » |
| `label` | « Conformance et niveaux de conformité » |
| `course` | chemin de la fiche dans le dépôt de cours (l'appli renvoie vers GitHub, rien n'est recopié — P4) |
| `bloom`, `review` | niveau Bloom officiel indiqué par la matrice, statut de revue (« Candidat précis — non relu ») |
| `questionCount` | nombre de questions rattachées |

Le build **échoue** si une référence de la matrice (Q###, S###, XP##, XF##, F##, D##, A##, plages « Q005–Q008 ») ne correspond à aucune question, et liste les objectifs sans question.

Statut d'un objectif (`js/core/objectives.js`), par priorité : **jamais vu** (aucune réponse) → **à réviser** (une question à revoir) → **acquis** (≥ 3 réponses et ≥ 75 %) → **en cours** (sinon).

## Progression (stockage local, clé `cet:<pack>:progress`)

Par question : `seen`, `correct`, `wrong`, `box` (Leitner 1–5), `lastAt`, `lastCorrect`, `rev` (version de la question au moment de la réponse). La difficulté est **mesurée** : `(wrong + 1) / (seen + 2)`.

- Une statistique dont la `rev` ne correspond plus à la question est ignorée : la question repart de zéro (ADR-004).
- Une statistique sans `rev` (antérieure à cette règle) est conservée, sauf si le pack déclare une remise à zéro (`pack.json` → `resets`), appliquée une seule fois et tracée dans `migrations`.
- `sessions` : historique des sessions terminées ; la règle « Prêt à réserver » (`bookingReadiness`) lit les 3 derniers examens blancs de l'examen concerné.

## Sauvegarde (fichier exporté)

`{ "format": "cert-exam-trainer/progress", "version": 1, "pack": "togaf", "exportedAt": "…", "progress": { "questions": {…}, "sessions": […] } }`

À l'import, la fusion garde pour chaque question l'état le plus récent (`lastAt`) et réunit les historiques sans doublon : importer deux fois ou depuis deux appareils ne fait rien perdre.

## Qualité des données (contrôlée en CI)

- Identifiants uniques, domaine et examen connus du pack, 4 options non vides, une seule meilleure option, explication présente.
- Chaque examen blanc figé respecte le nombre de questions et la répartition officielle par domaine.
- La banque contient assez de questions par domaine pour générer un examen.
- La position d'origine des bonnes réponses est rapportée (information ; neutralisée par ADR-003).
