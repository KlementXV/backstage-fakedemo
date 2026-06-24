# Helios — maquette de portail développeur inspirée de Backstage

Maquette de démonstration **100 % statique** (HTML / CSS / JavaScript) reproduisant
l'expérience UI/UX de [Backstage](https://backstage.io) (portail développeur open
source initié par Spotify), sous une identité visuelle personnalisée « Helios ».

> ⚠️ Ceci est une **fausse implémentation à but démonstratif** : aucun backend,
> aucun appel réel à Rancher, Harbor, VMware, PostgreSQL ou MongoDB. Toutes les
> données sont simulées localement en JavaScript et persistées dans `localStorage`.
> Les logos et marques de Spotify/Backstage ne sont pas utilisés.

## Lancement

Ouvrir simplement `index.html` dans un navigateur. Aucun serveur, aucune
dépendance, aucune compilation.

Le bouton **« ⟲ Réinitialiser la démo »** (barre du haut) efface l'état local et
ramène la démonstration à son point de départ.

## Ce que montre la démo

L'écran est scindé en deux volets visibles simultanément :

- **Gauche — interface utilisateur** : Software Catalog (filtres, tableau
  d'entités, pages de détail), Software Templates et assistant de création en
  6 étapes (informations, environnement, ressources, dimensionnement avec
  estimation de coût mensuel, résumé, envoi), suivi des demandes.
- **Droite — interface administrateur** : file de validation avec filtres,
  détail d'une demande, approbation/refus avec commentaire, provisionnement
  simulé étape par étape (stepper, barre de progression, journal d'exécution),
  journal d'activité.

### Scénario de présentation

1. L'utilisateur parcourt le catalogue puis ouvre **Créer…**
2. Il choisit le template **« Provisionnement de projet plateforme »**
3. Il complète le formulaire multi-étapes et envoie sa demande
4. La demande apparaît immédiatement dans le volet administrateur
5. L'administrateur l'ouvre, la commente et l'**approuve**
6. Le provisionnement se déroule automatiquement (Rancher → Harbor → VM →
   bases de données → accès → finalisation)
7. Les nouvelles ressources apparaissent dans le catalogue utilisateur avec
   le badge « Nouveau » et la demande passe au statut **Disponible**

## Structure du code

| Fichier      | Rôle                                                            |
|--------------|-----------------------------------------------------------------|
| `index.html` | Coquille de la page : barre de démo, deux volets, sidebars      |
| `styles.css` | Tout le design system « façon Backstage » (variables en tête)   |
| `script.js`  | Données simulées, état, rendu des vues, provisionnement simulé  |

Les points d'extension les plus utiles sont en tête de `script.js` :
équipes (`TEAMS`), environnements (`ENVIRONMENTS`), tailles et coûts (`SIZES`,
`RESOURCE_DEFS`), templates (`TEMPLATES`) et étapes de provisionnement
(`PROV_STEPS`).
