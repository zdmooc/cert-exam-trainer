# Phase A — Architecture Vision

## Problème

Préparer TOGAF Foundation puis Practitioner **en français**, sur mobile, avec des scores fiables. Les banques de questions existantes sont en Markdown, peu pratiques sur téléphone, et la bonne réponse y est le plus souvent en position A, ce qui fausse les scores.

## Vision

Une appli de poche qui transforme n'importe quelle banque de questions en entraînement adaptatif et en examens blancs fidèles au format officiel, d'abord pour TOGAF, ensuite pour d'autres certifications.

## Parties prenantes et préoccupations

| Partie prenante | Préoccupations (concerns) |
| --- | --- |
| Candidat (utilisateur) | Réviser partout, savoir quand réserver l'examen, comprendre ses erreurs |
| Auteur des contenus | Éditer en Markdown, sans double saisie |
| The Open Group (indirect) | Respect de la marque, pas de diffusion de questions officielles |
| Futurs utilisateurs | Contenu en français, appli gratuite |

## Périmètre

- **Dans le périmètre v1 :** pack TOGAF (F101 + F102), entraînement, examens blancs, révision des erreurs, progression, hors ligne.
- **Hors périmètre v1 :** comptes, synchronisation entre appareils, édition de questions dans l'appli, autres certifications.

## Indicateurs de réussite

| Indicateur | Cible |
| --- | --- |
| Score aux examens blancs F101 | ≥ 32/40 sur 3 examens consécutifs avant réservation |
| Score aux examens blancs F102 | ≥ 28/40 sur 3 examens consécutifs avant réservation |
| Biais de position visible à l'utilisateur | 0 (≈ 25 % par position après mélange, testé en CI) |
| Coût mensuel | 0 € |
