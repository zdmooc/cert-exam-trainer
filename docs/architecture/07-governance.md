# Phases G, H et Requirements Management

## Contrat d'architecture (Phase G)

Toute modification passe par une pull request et doit respecter :

| Exigence | Contrôle |
| --- | --- |
| Le moteur ne contient aucune règle propre à une certification (P3) | Revue ; tests du moteur sur un pack fictif |
| Les packs sont valides et conformes aux formats officiels (P7) | `content-pipeline/validate.mjs` en CI, bloquant |
| Le mélange des options équilibre les positions (P7) | Test `le mélange répartit la bonne réponse sur les 4 positions` |
| Les packs JSON ne sont pas modifiés à la main (P4) | La CI régénère le pack depuis le dépôt de cours |
| Aucune dépendance serveur (P1, P2) | Revue ; l'appli est servie en statique |
| Une progression ne survit pas à un changement de barème (P7) | Empreinte `rev` vérifiée par le validateur ; tests du moteur (ADR-004) |

**Définition de « terminé » :** tests verts, validation verte, appli vérifiée sur un écran mobile, documentation à jour (ce dossier + ADR si décision structurante).

## Gestion du changement (Phase H)

| Déclencheur | Traitement |
| --- | --- |
| Nouvelle question ou correction dans le dépôt de cours | Changement simple : relancer la CI (publication automatique) |
| Nouvelle version du syllabus ou du format d'examen | Mettre à jour `pack.json` ; si la répartition change, revoir les examens blancs |
| Nouvelle certification | Nouveau pack + script de pipeline ; aucun changement de `js/core` attendu (sinon : ADR) |
| Nouveau type de question (plusieurs bonnes réponses, glisser-déposer) | Changement d'architecture : nouvelle ADR, évolution du modèle de données |

## Gestion des exigences

Les exigences sont des **issues GitHub** étiquetées `exigence`, chacune reliée à une capacité de la Phase B. Les décisions structurantes sont consignées dans `adr/`.
