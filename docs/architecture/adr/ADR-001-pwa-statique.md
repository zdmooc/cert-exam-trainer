# ADR-001 — Application web installable, statique, hors ligne

- **Statut :** acceptée (v1)
- **Contexte :** utilisation sur téléphone, souvent sans réseau ; projet personnel sans budget d'exploitation ; une seule personne pour maintenir.
- **Décision :** Progressive Web App statique (HTML/CSS/JS sans framework), hébergée sur GitHub Pages, avec service worker et stockage local.
- **Conséquences :**
  - ✓ Coût nul, publication automatique, fonctionnement hors ligne, aucun store.
  - ✗ Progression liée au navigateur de l'appareil ; atténué en v2 par l'export/import d'un fichier de sauvegarde.
  - ✗ Notifications de rappel peu fiables sur iOS.
- **Alternatives écartées :** appli native, backend, page artifact (voir [06-roadmap.md](../06-roadmap.md)).
