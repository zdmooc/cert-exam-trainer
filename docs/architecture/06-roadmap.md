# Phases E et F — Opportunités, solutions et planification de la migration

## Options étudiées (Phase E)

| Option | Avantages | Inconvénients | Décision |
| --- | --- | --- | --- |
| **PWA statique** | Gratuite, hors ligne, une seule base de code, publiée en quelques secondes | Stockage limité au navigateur, pas de notifications fiables sur iOS | **Retenue** (ADR-001) |
| Appli native (React Native / Expo) | Expérience native, notifications | Stores, comptes développeur, build mobile à maintenir | Écartée pour v1 ; réexaminée si besoin de notifications |
| Page artifact Claude | Création immédiate | Pas de service worker, pas de CI, pas de dépôt partageable | Écartée |
| Backend + base de données | Synchronisation multi-appareils | Coût, exploitation, données personnelles | Reportée à v4 |

## Feuille de route (Phase F)

| Version | Contenu | Valeur | Statut |
| --- | --- | --- | --- |
| v1 | Moteur générique, pack TOGAF F101 + F102 (648 questions), entraînement, examens blancs, révision Leitner, hors ligne | Préparer les deux examens TOGAF | **Livrée** |
| v1.1 | Pack TOGAF enrichi (734 questions, objectifs X2202), justification de chaque réponse, filtre par série, conversion multi-formats | Corrections plus pédagogiques, exercices ciblés | **Livrée** |
| v2 | Export / import de la progression (fichier, fusion sans perte) | Ne pas perdre sa progression en changeant de téléphone | **Livrée** |
| v2.1 (lot 1) | Empreinte `rev` (progression remise à zéro quand une question change), « Prêt à réserver » sur 3 examens consécutifs | Scores fiables | PR #1 |
| v2.2 (lot 2) | Rattachement aux 131 objectifs X2202 (matrice du dépôt de cours), progression par objectif, entraînement par objectif | Suivre la couverture du syllabus | PR #2 |
| v2.4 | Écran « Jour J » (réservation et règles d'examen, décrit dans `pack.json`), intitulé de l'objectif X2202 sous chaque explication, contrôle du biais de longueur des réponses dans la validation des packs | Réserver sans erreur ; scores non devinables | **Livrée** (14 nov. 2026) |
| v2.3 | Parcours séquentiel Foundation → Practitioner | Apprendre dans l'ordre | À préciser |
| — | Mode sombre manuel, recherche d'une question | Confort | À faire |
| — | Pack TOGAF F102 : scénarios plus longs, proches du format réel ; justification déjà présente pour chaque option, à relire | Entraînement Practitioner plus réaliste | À faire après la Foundation |
| — | Référence précise au standard TOGAF (partie, chapitre) sur chaque question, en plus de l'objectif X2202 | Vérifier une réponse à la source | À faire (contenu à produire dans le dépôt de cours) |
| — | Pack Claude : biais de longueur mesuré (bonne réponse la plus longue dans 82 à 100 % des questions), à corriger dans le dépôt source | Scores fiables | À faire |
| v3 | Deuxième pack (ArchiMate 3.2) sans modifier `js/core` | Prouver la généricité du moteur | À faire |
| v4 | Synchronisation optionnelle (adaptateur distant) | Multi-appareils | À évaluer |

Critère de passage d'une version à la suivante : tests verts, validation des packs, et aucune régression sur les indicateurs de la Vision.
