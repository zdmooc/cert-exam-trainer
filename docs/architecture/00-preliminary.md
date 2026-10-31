# Preliminary — principes, tailoring, gouvernance

## Principes d'architecture

| # | Principe | Justification | Implications |
| --- | --- | --- | --- |
| P1 | **Hors ligne d'abord** | Révision dans les transports, sans réseau | Tout le contenu est téléchargé et mis en cache ; aucun appel serveur pendant une session |
| P2 | **Coût d'exploitation nul** | Projet personnel, pas de budget de run | Hébergement statique, pas de serveur, pas de base de données |
| P3 | **Moteur indépendant des certifications** | Réutiliser l'appli pour ArchiMate, Microsoft, Red Hat… | Aucune règle d'examen dans `js/core` ; tout est décrit dans `pack.json` (ADR-002) |
| P4 | **Le contenu vit dans les dépôts de cours** | Une seule source de vérité, éditée en Markdown | Les packs JSON sont générés ; on ne les modifie pas à la main |
| P5 | **Contenu original uniquement** | Respect des droits et des règles de certification | Pas de questions officielles ni de dumps ; mention de marque TOGAF |
| P6 | **Données personnelles sur l'appareil** | Pas de compte, pas de RGPD à gérer | Progression en stockage local ; export/synchronisation reportés (v4) |
| P7 | **Un score doit refléter la compréhension** | Les sources ont un biais de position (A ≈ 60 %) | Options mélangées à l'affichage (ADR-003) ; contrôle de validité en CI |

## Tailoring de l'ADM

- Une itération par version (v1, v2…), chacune parcourant A → F en version courte.
- Pas d'Architecture Board : la revue est une pull request relue par le propriétaire du dépôt.
- Le référentiel d'architecture est ce dossier `docs/architecture`, versionné avec le code.
- Les exigences sont gérées dans les issues GitHub (voir [07-governance.md](07-governance.md)).

## Rôles

| Rôle | Qui |
| --- | --- |
| Sponsor, utilisateur principal, architecte | Zidane Djamal (`zdmooc`) |
| Auteur des contenus | Dépôts de cours de `zdmooc` |
| Développement assisté | Claude (pull requests relues par le propriétaire) |
