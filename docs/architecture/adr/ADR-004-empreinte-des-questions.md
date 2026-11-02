# ADR-004 — Empreinte « rev » des questions

- **Statut :** acceptée (lot 1, 2 novembre 2026)
- **Contexte :** la progression est stockée par identifiant de question. Le 2 novembre 2026, le dépôt de cours a corrigé le barème de 8 scénarios Practitioner (S009, S013, S019, S020, S023, S024, S028, S056). Une question « maîtrisée » avec l'ancien barème restait marquée maîtrisée : le score de préparation n'était plus fiable.
- **Décision :**
  1. Le build calcule pour chaque question une empreinte `rev` (8 caractères de SHA-256) sur l'énoncé, le texte et les points des options — pas sur les justifications ni l'explication, pour qu'une simple reformulation pédagogique ne fasse rien perdre.
  2. Chaque statistique enregistre la `rev` de la question au moment de la réponse. `statOf()` renvoie une statistique vide si les deux ne correspondent plus ; la réponse suivante repart de zéro.
  3. Les statistiques antérieures, sans `rev`, sont conservées (pas de perte). Quand un changement de barème est connu, le pack déclare une remise à zéro (`resets`), appliquée une seule fois, y compris aux sauvegardes importées.
- **Conséquences :**
  - ✓ Les badges et la révision reflètent la version actuelle des questions.
  - ✓ Une correction d'énoncé future est prise en compte automatiquement, sans liste à maintenir.
  - ✗ Une reformulation d'énoncé ou d'option (même mineure) remet la question à zéro ; c'est voulu, car le sens peut avoir changé.
