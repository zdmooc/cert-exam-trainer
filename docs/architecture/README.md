# Architecture — démarche TOGAF appliquée à Cert Exam Trainer

Ce dossier applique l'ADM TOGAF (10e édition) à un petit produit. Le **tailoring** est volontairement léger : une page par phase, des décisions tracées en ADR, la gouvernance portée par les contrôles automatiques de la CI.

| Phase ADM | Livrable | Fichier |
| --- | --- | --- |
| Preliminary | Principes d'architecture, tailoring, gouvernance | [00-preliminary.md](00-preliminary.md) |
| A — Architecture Vision | Vision, parties prenantes, périmètre, indicateurs | [01-vision.md](01-vision.md) |
| B — Business Architecture | Capacités, parcours | [02-business.md](02-business.md) |
| C — Data Architecture | Modèle de données, propriété, qualité | [03-data.md](03-data.md) |
| C — Application Architecture | Composants, pattern hexagonal | [04-application.md](04-application.md) |
| D — Technology Architecture | Plateforme et déploiement | [05-technology.md](05-technology.md) |
| E / F — Opportunities, Migration Planning | Options, feuille de route | [06-roadmap.md](06-roadmap.md) |
| G / H / Requirements Management | Contrat d'architecture, gestion du changement | [07-governance.md](07-governance.md) |

## Décisions d'architecture

| ADR | Décision | Statut |
| --- | --- | --- |
| [ADR-001](adr/ADR-001-pwa-statique.md) | Application web installable, statique, hors ligne | Acceptée |
| [ADR-002](adr/ADR-002-moteur-generique.md) | Moteur indépendant de toute certification, piloté par les packs | Acceptée |
| [ADR-003](adr/ADR-003-melange-des-options.md) | Mélange des options à l'affichage, correction en ordre d'origine | Acceptée |
| [ADR-004](adr/ADR-004-empreinte-des-questions.md) | Empreinte « rev » : la progression repart de zéro quand une question change | Acceptée |
