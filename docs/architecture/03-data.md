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
| `maxPoints`, `passMark`, `goMark` | 40, 24, 32 | Seuil officiel et objectif avant réservation |
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
    { "key": "B", "text": "…", "points": 3 },
    { "key": "C", "text": "…", "points": 1 },
    { "key": "D", "text": "…", "points": 0 }
  ],
  "explanation": "…",
  "topic": "Architecture Development — Phase B vs Phase C",
  "source": "10-practitioner-scenarios/04-bcd-s022-s030.md"
}
```

- `set` vaut `bank` (banque d'entraînement) ou l'identifiant d'un examen blanc figé (`mock-01`…).
- Le barème est porté par les **points de chaque option** : 1/0 pour un QCM simple, 5/3/1/0 pour un scénario gradué. Le moteur n'a pas d'autre notion de barème.
- `key` est la lettre d'origine, utilisée seulement pour relier l'explication aux options.

## Progression (stockage local, clé `cet:<pack>:progress`)

Par question : `seen`, `correct`, `wrong`, `box` (Leitner 1–5), `lastAt`, `lastCorrect`. La difficulté est **mesurée** : `(wrong + 1) / (seen + 2)`.

## Qualité des données (contrôlée en CI)

- Identifiants uniques, domaine et examen connus du pack, 4 options non vides, une seule meilleure option, explication présente.
- Chaque examen blanc figé respecte le nombre de questions et la répartition officielle par domaine.
- La banque contient assez de questions par domaine pour générer un examen.
- La position d'origine des bonnes réponses est rapportée (information ; neutralisée par ADR-003).
