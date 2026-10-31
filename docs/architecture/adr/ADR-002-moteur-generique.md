# ADR-002 — Moteur indépendant de toute certification

- **Statut :** acceptée (v1)
- **Contexte :** après TOGAF, d'autres certifications sont visées (ArchiMate, Microsoft, Red Hat). Réécrire une appli par certification n'est pas soutenable.
- **Décision :** le moteur (`app/js/core`) ne connaît que des notions génériques : examen, domaine, question, option à points, session, progression. Formats, durées, seuils et répartitions sont déclarés dans `pack.json` ; le barème est porté par les points des options.
- **Conséquences :**
  - ✓ Ajouter une certification = un `pack.json` + un script de conversion, sans toucher au moteur.
  - ✓ Le moteur est testable avec un pack fictif.
  - ✗ Environ 10–15 % d'effort en plus sur la v1.
  - ✗ Les examens pratiques sur machine (ex. Red Hat) ne sont couverts que pour la révision des notions, pas pour l'épreuve elle-même.
- **Limite volontaire :** pas de système de plugins ni de types de questions exotiques tant qu'un besoin réel ne l'impose pas.
