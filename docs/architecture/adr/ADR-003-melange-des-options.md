# ADR-003 — Mélange des options à l'affichage, correction en ordre d'origine

- **Statut :** acceptée (v1)
- **Contexte :** dans les sources TOGAF, la meilleure réponse est en position A pour 391 questions sur 648 (60 %). S'entraîner ainsi donne des scores trompeurs. Mais 309 explications citent les options par leur lettre (« A relève de la Phase D… »), ce qui empêche de simplement réordonner les sources.
- **Décision :**
  1. Les options sont mélangées à la création de chaque session ; pendant la question, elles sont affichées **sans lettre**.
  2. Dans la correction, les options sont rappelées **dans l'ordre d'origine avec leur lettre**, pour que l'explication reste juste.
  3. Les sources ne sont pas modifiées ; leur biais est rapporté par le validateur à titre d'information.
- **Conséquences :**
  - ✓ Aucune position n'est privilégiée (≈ 25 % chacune, vérifié par un test).
  - ✓ Les explications existantes restent valables sans réécriture.
  - ✗ L'utilisateur voit deux ordres différents (question puis correction) ; atténué par le libellé « L'explication désigne les options par leur lettre d'origine ».
