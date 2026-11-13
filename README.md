# Cert Exam Trainer

Application mobile d'entraînement aux certifications : questions avec explications, révision des erreurs et examens blancs chronométrés. Elle fonctionne hors ligne et s'installe sur l'écran d'accueil du téléphone.

Packs disponibles (choix en haut de l'accueil) :

- **Certifications Claude** : Foundations (CCAR-F), Professional (CCAR-P), Developer (CCDV-F) et Associate (CCAO-F), 96 questions originales issues de [claude-architect-lab](https://github.com/zdmooc/claude-architect-lab), dont 9 à plusieurs réponses. La banque étant petite, l'examen blanc est un **mini-examen** réparti selon les poids officiels des domaines ; le score officiel (720/1000 échelonné) n'est pas reproduit, l'appli affiche un pourcentage et un objectif personnel de 80 %.
- **TOGAF Enterprise Architecture** (Foundation OGEA-F101 et Practitioner OGEA-F102), 734 questions originales en français, rattachées aux objectifs X2202, issues de [togaf-ogea-103-combined-certification-prep](https://github.com/zdmooc/togaf-ogea-103-combined-certification-prep).

**Utiliser l'appli :** <https://zdmooc.github.io/cert-exam-trainer/> → sur Android (Chrome) menu ⋮ › *Ajouter à l'écran d'accueil* ; sur iPhone (Safari) Partager › *Sur l'écran d'accueil*.

## Fonctionnalités

| Mode | Ce qu'il fait |
| --- | --- |
| Entraînement | Correction après chaque question, avec la justification de chaque réponse (5/3/1/0 pour les scénarios). Sélection adaptative, aléatoire, séquentielle ou « mes erreurs », filtrable par domaine et par série (banque, exercices discriminants, livrables, ateliers multi-contraintes, couverture X2202…). |
| Examen blanc | Format officiel (F101 : 40 QCM en 60 min ; F102 : 8 scénarios en 90 min, barème 5/3/1/0). Correction à la fin uniquement. Examen généré selon la répartition officielle, ciblé sur tes faiblesses, ou l'un des 6 examens blancs du dépôt. |
| Revoir mes erreurs | Boîtes de Leitner : une question ratée revient jusqu'à être réussie plusieurs fois. |
| Progression | Maîtrise par domaine, taux de réussite, historique des examens. |
| Sauvegarde | Export de la progression dans un fichier (partage Android : Drive, e-mail…) et import par fusion, sans perte. Rappel sur l'accueil après 14 jours sans sauvegarde. |

Les options sont **mélangées à chaque affichage** : on ne peut pas mémoriser la position de la bonne réponse. Après réponse, la correction rappelle les options avec leur lettre d'origine, à laquelle les explications font référence.

La progression est enregistrée **sur l'appareil** (stockage du navigateur). Pour changer d'appareil : *Progression › Exporter*, puis *Importer* sur l'autre appareil.

## Architecture

```
content-pipeline/    Markdown des dépôts de cours → packs JSON (+ validateur)
app/
  js/core/           Moteur générique : sélection, session, barème, progression (sans DOM)
  js/adapters/       Stockage (port remplaçable)
  js/main.js         Interface
  packs/<id>/        pack.json (définition d'examens) + questions.json (généré)
tests/               Tests du moteur (node --test)
docs/architecture/   Démarche TOGAF appliquée à l'appli + décisions (ADR)
```

Le moteur ne contient aucune règle propre à une certification : formats, barèmes, domaines et seuils viennent du `pack.json`. Voir [docs/architecture](docs/architecture/README.md).

## Développement

```bash
npm test                      # tests du moteur + validation des packs
npm run build:togaf -- ../togaf-ogea-103-combined-certification-prep
npm run build:claude -- ../claude-architect-lab
npm run serve                 # http://localhost:8080
```

Node 20+ ; aucune dépendance npm.

## Ajouter une certification

1. Créer `app/packs/<id>/pack.json` (examens, domaines, durée, seuils, `maxPoints`).
2. Produire `questions.json` au format décrit dans [docs/architecture/03-data.md](docs/architecture/03-data.md) (un script dans `content-pipeline/<id>/`).
3. Ajouter le pack dans `app/packs/index.json`, puis `npm test`.

## Mentions

Questions originales d'autoformation : ni questions officielles, ni brain dumps. TOGAF® est une marque déposée de The Open Group. Ce projet n'est ni affilié à The Open Group ni approuvé par elle.
