/* ============================================================
   Helios — maquette de portail développeur inspirée de Backstage
   ------------------------------------------------------------
   Tout est simulé côté navigateur : aucun backend, aucun appel
   réel à Rancher / Harbor / VMware / PostgreSQL / MongoDB.

   Organisation du fichier :
     1. Données de référence (équipes, environnements, tailles,
        ressources, templates, statuts)
     2. État global + persistance localStorage
     3. Utilitaires (format, échappement, toasts)
     4. Petits composants HTML réutilisables
     5. Vue utilisateur (catalogue, entité, templates, assistant,
        mes demandes)
     6. Vue administrateur (validations, détail, provisionnement,
        journal d'activité)
     7. Simulation du provisionnement
     8. Gestion des événements (délégation)
     9. Initialisation
   ============================================================ */

'use strict';

/* ============================================================
   1. Données de référence
   ============================================================ */

const TEAMS = [
  'équipe-web', 'équipe-finance', 'équipe-data', 'équipe-mobile', 'équipe-plateforme',
];

const ENVIRONMENTS = {
  dev:     { label: 'Développement', icon: '🧪', lifecycle: 'experimental',
             desc: 'Bac à sable pour les développements en cours. Pas de garantie de disponibilité.' },
  staging: { label: 'Recette',       icon: '🔍', lifecycle: 'staging',
             desc: 'Environnement de validation fonctionnelle, iso-production allégé.' },
  prod:    { label: 'Production',    icon: '🚀', lifecycle: 'production',
             desc: 'Environnement de production. Haute disponibilité, sauvegardes et astreinte.' },
};

const SIZES = {
  S:  { label: 'S — Micro',       specs: 'VM-XS · PG-Dev · Redis-Dev · Rabbit-Dev' },
  M:  { label: 'M — Standard',    specs: 'VM-M  · PG-M  · Redis-M  · Rabbit-M' },
  L:  { label: 'L — Performance', specs: 'VM-L  · PG-L  · Redis-L  · Rabbit-L' },
  XL: { label: 'XL — Intensif',   specs: 'VM-XL · PG-XL · Redis-XL · Rabbit-XL' },
  custom: { label: 'Sur mesure',  specs: 'vCPU, RAM et stockage au choix' },
};

/* Réseaux / régions cibles (datacenters) — paramètre du Software Template Backstage */
const NETWORKS = {
  FR:  { flag: '🇫🇷', label: 'France (Paris)',       desc: 'Datacenter principal — hébergement par défaut des projets France.' },
  IT:  { flag: '🇮🇹', label: 'Italie (Milan)',       desc: 'Datacenter régional Italie — capacité réduite.' },
  USA: { flag: '🇺🇸', label: 'États-Unis (Ashburn)', desc: 'Datacenter Amériques — données soumises à la localisation US.' },
};

/* Zones de réseaux cloisonnés accessibles via diode unidirectionnelle */
const DIODE_NETWORKS = {
  'diode-prod':    { icon: '🔴', label: 'Diode Production (Zone-A)',    desc: 'Réseau cloisonné de production — flux entrant uniquement.' },
  'diode-quali':   { icon: '🟠', label: 'Diode Qualification (Zone-B)', desc: 'Réseau cloisonné de qualification — flux entrant uniquement.' },
  'diode-offline': { icon: '⚫', label: 'Diode Hors-ligne (Zone-C)',    desc: 'Réseau sans connexion externe — haute sécurité.' },
};

/* Niveaux de classification des données transférées vers les réseaux sous diode */
const SECURITY_LEVELS = {
  diffusion_restreinte: { icon: '🟡', label: 'Diffusion Restreinte',   color: '#d97706' },
  sensible:             { icon: '🟠', label: 'Sensible',               color: '#ea580c' },
  confidentiel:         { icon: '🔴', label: 'Confidentiel Défense',   color: '#dc2626' },
};

/* Hyperviseurs disponibles (optionnel — s’applique aux machines virtuelles) */
const HYPERVISORS = {
  auto:      { icon: '🎛️', label: 'Indifférent — choix de la plateforme' },
  vmware:    { icon: '🟦', label: 'VMware vSphere' },
  hyperv:    { icon: '🪟', label: 'Microsoft Hyper-V' },
  harvester: { icon: '🐄', label: 'Harvester (SUSE / Rancher)' },
};

/* Empreinte technique (vCPU / Go RAM / Go stockage) par gabarit, pour le calcul de capacité */
const SIZE_FOOTPRINT = {
  S:  { cpu: 2,  ram: 4,  storage: 40 },
  M:  { cpu: 4,  ram: 16, storage: 100 },
  L:  { cpu: 8,  ram: 32, storage: 250 },
  XL: { cpu: 16, ram: 64, storage: 500 },
};

/* Inventaire de capacité par région et par hyperviseur (simulé).
   pool = capacité totale ; used = charge existante de référence.
   Les demandes déjà approuvées/provisionnées s’y ajoutent dynamiquement. */
const CAPACITY = {
  FR: {
    pool: { cpu: 480, ram: 1920, storage: 36000 },
    used: { cpu: 250, ram: 1040, storage: 20000 },
    hypervisors: {
      vmware:    { pool: { cpu: 240, ram: 960, storage: 18000 }, used: { cpu: 150, ram: 600, storage: 11000 } },
      hyperv:    { pool: { cpu: 160, ram: 640, storage: 12000 }, used: { cpu: 70,  ram: 300, storage: 5500 } },
      harvester: { pool: { cpu: 80,  ram: 320, storage: 6000 },  used: { cpu: 30,  ram: 120, storage: 2500 } },
    },
  },
  USA: {
    pool: { cpu: 320, ram: 1280, storage: 26000 },
    used: { cpu: 210, ram: 880,  storage: 17000 },
    hypervisors: {
      vmware:    { pool: { cpu: 180, ram: 720, storage: 14000 }, used: { cpu: 120, ram: 500, storage: 9000 } },
      hyperv:    { pool: { cpu: 100, ram: 400, storage: 8000 },  used: { cpu: 70,  ram: 320, storage: 6000 } },
      harvester: { pool: { cpu: 40,  ram: 160, storage: 4000 },  used: { cpu: 18,  ram: 70,  storage: 2000 } },
    },
  },
  IT: {
    pool: { cpu: 140, ram: 560, storage: 11000 },
    used: { cpu: 104, ram: 430, storage: 8600 },
    hypervisors: {
      vmware:    { pool: { cpu: 80, ram: 320, storage: 6000 }, used: { cpu: 64, ram: 270, storage: 4900 } },
      hyperv:    { pool: { cpu: 44, ram: 176, storage: 3500 }, used: { cpu: 32, ram: 140, storage: 3000 } },
      harvester: { pool: { cpu: 16, ram: 64,  storage: 1500 }, used: { cpu: 8,  ram: 30,  storage: 700 } },
    },
  },
};


/* Ressources sélectionnables dans l’assistant (tarifs réels HT) */
const RESOURCE_DEFS = {
  rancher:    { icon: '🐮', label: 'Projet Rancher (K8s)',     base: 75,   sized: false,
                desc: 'Projet Kubernetes managé : namespaces, quotas, RBAC. Forfait 75 €/mois.' },
  harbor:     { icon: '⚓', label: 'Registry Harbor',          base: 1,    sized: false, qty: 'registryGb',
                desc: 'Registre d’images privé avec scan de vulnérabilités. Facturé 1 €/Go/mois.' },
  vm:         { icon: '🖥️', label: 'Machines virtuelles',     base: 65,   sized: true, qty: 'vmCount',
                prices: { S: 65, M: 220, L: 420, XL: 820 },
                planLabels: { S: 'VM-XS', M: 'VM-M', L: 'VM-L', XL: 'VM-XL' },
                desc: 'Machines virtuelles Linux managées (VMaaS). Socle d’exploitation inclus.' },
  postgres:   { icon: '🐘', label: 'PostgreSQL as a Service', base: 60,   sized: true,
                prices: { S: 60, M: 190, L: 340, XL: 650 },
                planLabels: { S: 'PG-Dev', M: 'PG-M', L: 'PG-L', XL: 'PG-XL' },
                desc: 'Base relationnelle managée, sauvegardée quotidiennement. Replica ×2,7.' },
  mariadb:    { icon: '🗃️', label: 'MariaDB as a Service',    base: 60,   sized: true,
                prices: { S: 60, M: 190, L: 340, XL: 650 },
                planLabels: { S: 'Maria-Dev', M: 'Maria-M', L: 'Maria-L', XL: 'Maria-XL' },
                desc: 'Base MariaDB managée, sauvegardée. Même grille tarifaire que PostgreSQL.' },
  mongo:      { icon: '🍃', label: 'MongoDB as a Service',    base: 90,   sized: true,
                prices: { S: 90, M: 320, L: 620, XL: 1200 },
                planLabels: { S: 'Mongo-Dev', M: 'Mongo-M', L: 'Mongo-L', XL: 'Mongo-XL' },
                desc: 'Base documentaire managée (replica set × 3). Tarif ×2,7 inclus.' },
  redis:      { icon: '🔴', label: 'Redis as a Service',      base: 35,   sized: true,
                prices: { S: 35, M: 110, L: 190, XL: 350 },
                planLabels: { S: 'Redis-Dev', M: 'Redis-M', L: 'Redis-L', XL: 'Redis-XL' },
                desc: 'Cache Redis managé. Options : persistance +20 €, haute disponibilité ×2,5.' },
  rabbitmq:   { icon: '🐰', label: 'RabbitMQ as a Service',   base: 60,   sized: true,
                prices: { S: 60, M: 190, L: 340, XL: 620 },
                planLabels: { S: 'Rabbit-Dev', M: 'Rabbit-M', L: 'Rabbit-L', XL: 'Rabbit-XL' },
                desc: 'Broker de messages managé. Cluster 3 nœuds : tarif ×2,5.' },
  serverless: { icon: '⚡', label: 'Serverless Containers',   base: 30,   sized: false,
                desc: 'Conteneurs serverless — 0,10 €/h/vCPU, 0,025 €/Gio/h. Min. 30 €/service/mois.' },
  wiki:       { icon: '📖', label: 'Wiki as a Service',       base: 120,  sized: false,
                desc: 'Wiki collaboratif managé (application, base de données, stockage inclus).' },
};

/* Catalogue de templates (page « Créer… ») */
const TEMPLATES = [
  {
    id: 'platform-project', enabled: true, type: 'Infrastructure', category: 'infra',
    title: 'Bundle',
    desc: 'Crée un projet complet : Rancher, Harbor, machines virtuelles et bases de données, avec workflow de validation.',
    tags: ['rancher', 'harbor', 'vm', 'postgresql', 'mongodb'],
    owner: 'équipe-plateforme', version: 'v2.4', usageCount: 47, isNew: false,
  },
];

/* Métadonnées des templates individuels (générés depuis RESOURCE_DEFS) */
const RES_TPL_META = {
  rancher:    { type: 'Infrastructure', category: 'infra', tags: ['rancher', 'kubernetes', 'k8s'],         usageCount: 38 },
  harbor:     { type: 'Infrastructure', category: 'infra', tags: ['harbor', 'docker', 'registry'],         usageCount: 29 },
  vm:         { type: 'Infrastructure', category: 'infra', tags: ['vm', 'linux', 'vmaas'],                 usageCount: 52 },
  postgres:   { type: 'Data',           category: 'data',  tags: ['postgresql', 'database', 'sql'],        usageCount: 41 },
  mariadb:    { type: 'Data',           category: 'data',  tags: ['mariadb', 'database', 'sql'],           usageCount: 17 },
  mongo:      { type: 'Data',           category: 'data',  tags: ['mongodb', 'database', 'nosql'],         usageCount: 22 },
  redis:      { type: 'Infrastructure', category: 'infra', tags: ['redis', 'cache', 'in-memory'],          usageCount: 33 },
  rabbitmq:   { type: 'Infrastructure', category: 'infra', tags: ['rabbitmq', 'messaging', 'amqp'],        usageCount: 19 },
  serverless: { type: 'Application',    category: 'app',   tags: ['serverless', 'containers', 'autoscale'],usageCount: 14, isNew: true },
  wiki:       { type: 'Documentation',  category: 'docs',  tags: ['wiki', 'documentation', 'mkdocs'],      usageCount: 11 },
};

Object.entries(RES_TPL_META).forEach(([key, meta]) => {
  const def = RESOURCE_DEFS[key];
  TEMPLATES.push({
    id: 'res-' + key,
    enabled: true,
    resourceKey: key,
    type: meta.type,
    category: meta.category,
    title: def.icon + ' ' + def.label,
    desc: def.desc,
    tags: meta.tags,
    owner: 'équipe-plateforme',
    version: 'v1.0',
    usageCount: meta.usageCount || 0,
    isNew: meta.isNew || false,
  });
});

/* PLM Deployment — coming soon */
TEMPLATES.push({
  id: 'plm-deployment', enabled: false, type: 'Application', category: 'app',
  title: 'PLM Deployment',
  desc: 'Automated provisioning of the PLM platform: application server, database, file storage and network configuration. Estimated setup time: 5 min.',
  tags: ['plm', 'enterprise', 'deployment'],
  owner: 'équipe-plateforme', version: 'v0.1', usageCount: 0, isNew: false,
  duration: '5 min',
});

/* Harbor Pull — rapatriement d’image depuis le registre vers un cluster Rancher */
TEMPLATES.push({
  id: 'harbor-pull', enabled: true, type: 'Infrastructure', category: 'infra',
  title: '⚓ Pull image Harbor',
  desc: 'Demande de rapatriement d’une image depuis le registre Harbor vers un cluster Rancher. Scan Trivy automatique et validation équipe plateforme inclus.',
  tags: ['harbor', 'docker', 'image', 'pull', 'registry'],
  owner: 'équipe-plateforme', version: 'v1.2', usageCount: 8, isNew: true,
  action: 'open-image-wizard', wizardType: 'harbor-pull',
});

/* Diode Push — transfert d’image vers un réseau cloisonné sous diode unidirectionnelle */
TEMPLATES.push({
  id: 'diode-push', enabled: true, type: 'Infrastructure', category: 'infra',
  title: '🔒 Push vers réseau sous diode',
  desc: 'Demande de transfert unidirectionnel d’une image Harbor vers un réseau sécurisé sous diode. Scan AV + Trivy, chiffrement AES-256 et validation renforcée.',
  tags: ['harbor', 'docker', 'diode', 'sécurité', 'push', 'cloisonné'],
  owner: 'équipe-plateforme', version: 'v1.0', usageCount: 3, isNew: true,
  action: 'open-image-wizard', wizardType: 'diode-push',
});

/* Statuts d'une demande */
const STATUSES = {
  draft:        { label: 'Brouillon',                cls: 'status--draft' },
  pending:      { label: 'En attente de validation', cls: 'status--pending' },
  approved:     { label: 'Approuvée',                cls: 'status--approved' },
  provisioning: { label: 'Provisionnement en cours', cls: 'status--running' },
  available:    { label: 'Disponible',               cls: 'status--available' },
  rejected:     { label: 'Refusée',                  cls: 'status--rejected' },
};

/* Étapes simulées du provisionnement.
   `needs` indique si l'étape s'applique à la demande,
   `logs`  fournit les lignes du journal d'exécution. */
const PROV_STEPS = [
  {
    key: 'rancher', title: 'Création du projet Rancher',
    needs: r => r.resources.rancher,
    logs: r => [
      ['info', `Connexion à l'API Rancher (cluster ${r.env === 'prod' ? 'prod-01' : 'nonprod-02'})…`],
      ['', `Création du projet « ${r.resources.rancherName || r.name} » et des namespaces associés`],
      ['ok', 'Quotas CPU/RAM appliqués · RBAC synchronisé'],
    ],
  },
  {
    key: 'harbor', title: 'Création du projet Harbor',
    needs: r => r.resources.harbor,
    logs: r => [
      ['info', 'Connexion au registre Harbor…'],
      ['', `Projet « ${r.name} » créé · politique de rétention : 10 tags`],
      ['ok', 'Scan de vulnérabilités activé (Trivy)'],
    ],
  },
  {
    key: 'vm', title: 'Création des machines virtuelles',
    needs: r => r.resources.vm,
    logs: r => {
      const vmSizes = r.vmSizes ?? Array(r.resources.vmCount).fill(r.size);
      const def = RESOURCE_DEFS.vm;
      return [
        ['info', `Provisionnement sur ${(r.hypervisor && r.hypervisor !== 'auto') ? HYPERVISORS[r.hypervisor].label : 'l’hyperviseur sélectionné automatiquement'} · région ${NETWORKS[r.network || 'FR'].label}`],
        ['info', `Clonage du modèle ubuntu-22.04 (${r.resources.vmCount} instance(s))…`],
        ...vmSizes.map((sz, i) => ['', `VM #${i + 1} : gabarit ${sizePlan(def, sz)}`]),
        ['', 'Attribution des adresses IP et enregistrement DNS'],
        ['ok', `${r.resources.vmCount} VM démarrée(s) · agent de supervision installé`],
      ];
    },
  },
  {
    key: 'db', title: 'Création des bases de données',
    needs: r => r.resources.postgres || r.resources.mariadb || r.resources.mongo,
    logs: r => [
      ['info', 'Provisionnement des instances managées…'],
      ...(r.resources.postgres ? [['', `PostgreSQL 16 « ${r.name}-postgresql » créée · sauvegarde quotidienne`]] : []),
      ...(r.resources.mariadb  ? [['', `MariaDB 10 « ${r.name}-mariadb » créée · sauvegarde quotidienne`]] : []),
      ...(r.resources.mongo    ? [['', `MongoDB 7 « ${r.name}-mongodb » créée (replica set × 3)`]] : []),
      ['ok', 'Comptes applicatifs générés et stockés dans le coffre'],
    ],
  },
  {
    key: 'messaging', title: 'Déploiement des services de messagerie et cache',
    needs: r => r.resources.redis || r.resources.rabbitmq,
    logs: r => [
      ['info', 'Déploiement des brokers et caches…'],
      ...(r.resources.redis    ? [['', `Redis « ${r.name}-redis » déployé · persistance configurée`]] : []),
      ...(r.resources.rabbitmq ? [['', `RabbitMQ « ${r.name}-rabbitmq » déployé · vhosts et policies appliqués`]] : []),
      ['ok', 'Services de messagerie opérationnels'],
    ],
  },
  {
    key: 'services', title: 'Déploiement des services complémentaires',
    needs: r => r.resources.serverless || r.resources.wiki,
    logs: r => [
      ['info', 'Activation des services managés…'],
      ...(r.resources.serverless ? [['', `Namespace serverless « ${r.name} » provisionné · image ${r.resources.serverlessImage || 'harbor.exemple.fr/' + r.name + ':latest'} · autoscaling activé`]] : []),
      ...(r.resources.wiki       ? [['', `Wiki « ${r.resources.wikiName || r.name + '-wiki'} » créé · base et stockage initialisés`]] : []),
      ['ok', 'Services complémentaires disponibles'],
    ],
  },
  {
    key: 'access', title: 'Configuration des accès',
    needs: () => true,
    logs: r => [
      ['info', `Création du groupe d'accès « ${r.team} »…`],
      ['', 'Propagation des rôles vers Rancher, Harbor et le bastion SSH'],
      ['ok', 'Secrets distribués · authentification unique active'],
    ],
  },
  {
    key: 'finalize', title: 'Finalisation du projet',
    needs: () => true,
    logs: r => [
      ['info', 'Enregistrement des entités dans le catalogue…'],
      ['', 'Génération de la documentation et des tableaux de bord'],
      ['ok', `Projet « ${r.name} » prêt à l'emploi 🎉`],
    ],
  },
]
/* Étapes de pipeline : rapatriement d\'image Harbor → cluster Rancher */
const HARBOR_PULL_STEPS = [
  {
    key: 'auth', title: 'Authentification Harbor',
    needs: () => true,
    logs: r => [
      ['info', `Connexion au registre Harbor (projet : ${r.harborProject || 'n/a'})…`],
      ['ok', 'Token JWT obtenu · session établie'],
    ],
  },
  {
    key: 'scan', title: 'Scan de vulnérabilités Trivy',
    needs: () => true,
    logs: r => [
      ['info', `Analyse de l\'image ${r.imageName || 'n/a'}:${r.imageTag || 'latest'}…`],
      ['', 'Trivy : 0 CVE critique · 2 CVE mineures (ignorées par policy)'],
      ['ok', 'Image approuvée par la politique de sécurité'],
    ],
  },
  {
    key: 'pull', title: 'Pull et re-tagging',
    needs: () => true,
    logs: r => [
      ['info', `docker pull harbor.internal/${r.harborProject || 'n/a'}/${r.imageName || 'n/a'}:${r.imageTag || 'latest'}…`],
      ['', 'Digest : sha256:a3f8' + Math.random().toString(16).slice(2, 10) + '…'],
      ['', `Re-tag → registry.${r.targetCluster || 'rancher-prod'}/${r.imageName || 'n/a'}:${r.imageTag || 'latest'}`],
      ['ok', 'Image disponible dans le registre cible'],
    ],
  },
  {
    key: 'deploy', title: 'Déploiement dans Rancher',
    needs: () => true,
    logs: r => [
      ['info', `Connexion au cluster « ${r.targetCluster || 'rancher-prod'} »…`],
      ['', `Namespace cible : ${r.targetNamespace || 'default'}`],
      ['', 'Mise à jour du tag dans les déploiements concernés…'],
      ['ok', 'Image déployée · Rolling Update complété'],
    ],
  },
  {
    key: 'notify', title: 'Notification et audit',
    needs: () => true,
    logs: r => [
      ['', 'Événement consigné dans le registre d\'audit Harbor…'],
      ['', `Notification envoyée à ${r.team} via Teams`],
      ['ok', 'Pull terminé — catalogue mis à jour'],
    ],
  },
];

/* Étapes de pipeline : push via diode unidirectionnelle */
const DIODE_PUSH_STEPS = [
  {
    key: 'preflight', title: 'Pré-vérification sécurité',
    needs: () => true,
    logs: r => [
      ['info', `Classification : ${r.securityLevel || 'sensible'} · Destination : ${r.diodeNetwork || 'diode-prod'}`],
      ['', 'Vérification de l\'habilitation du demandeur…'],
      ['ok', 'Habilitation confirmée · Autorisation de transfert accordée'],
    ],
  },
  {
    key: 'scan', title: 'Scan antiviral et Trivy',
    needs: () => true,
    logs: r => [
      ['info', `Analyse de l\'image ${r.imageName || 'n/a'}:${r.imageTag || 'latest'}…`],
      ['', 'Trivy : 0 CVE critique · signature vérifiée (Cosign)'],
      ['', 'Analyse antiviral (ClamAV) : aucune menace détectée'],
      ['ok', 'Image conforme aux exigences de sécurité'],
    ],
  },
  {
    key: 'export', title: 'Export et packaging',
    needs: () => true,
    logs: r => [
      ['info', 'Extraction de l\'image en archive OCI…'],
      ['', `docker save harbor.internal/${r.harborProject || 'n/a'}/${r.imageName || 'n/a'}:${r.imageTag || 'latest'} | gzip`],
      ['', 'Taille : ' + (Math.floor(Math.random() * 800 + 100)) + ' Mo · Hash SHA-256 calculé'],
      ['ok', 'Archive signée et chiffrée (AES-256-GCM)'],
    ],
  },
  {
    key: 'transfer', title: 'Transfert via la diode',
    needs: () => true,
    logs: r => [
      ['info', `Connexion à la diode ${r.diodeNetwork || 'diode-prod'} (flux unidirectionnel)…`],
      ['', `Chemin destination : ${r.targetPath || '/images'}`],
      ['', 'Transfert en cours (aucun flux retour possible)…'],
      ['ok', 'Archive reçue côté sécurisé · intégrité vérifiée (SHA-256)'],
    ],
  },
  {
    key: 'import', title: 'Import côté réseau sécurisé',
    needs: () => true,
    logs: r => [
      ['info', `Chargement de l\'archive sur le système « ${r.targetSystem || 'système-cible'} »…`],
      ['', 'docker load < image.tar.gz'],
      ['ok', 'Image disponible dans le registre isolé'],
    ],
  },
  {
    key: 'cleanup', title: 'Audit et nettoyage',
    needs: () => true,
    logs: r => [
      ['', 'Suppression des archives temporaires…'],
      ['', 'Enregistrement dans le registre de transferts (compliance)…'],
      ['', `Notification à ${r.team} — transfert terminé`],
      ['ok', 'Transfert complété · traçabilité enregistrée'],
    ],
  },
];

function getProvSteps(r) {
  if (r.requestType === 'harbor-pull') return HARBOR_PULL_STEPS;
  if (r.requestType === 'diode-push')  return DIODE_PUSH_STEPS;
  return PROV_STEPS;
}

;

/* ============================================================
   2. État global + persistance
   ============================================================ */

const STORAGE_KEY = 'helios-demo-state-v3';
const now = () => Date.now();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

/* État de départ : un catalogue déjà vivant + un historique crédible */
function defaultState() {
  const t0 = now();
  return {
    nextRequestNum: 1042,
    entities: [
      { name: 'portail-client', kind: 'Component', type: 'website', owner: 'équipe-web',
        lifecycle: 'production', system: 'expérience-client', tags: ['react', 'cdn'],
        description: 'Portail web destiné aux clients finaux.', createdAt: t0 - 90 * DAY },
      { name: 'facturation-api', kind: 'Component', type: 'service', owner: 'équipe-finance',
        lifecycle: 'production', system: 'facturation', tags: ['java', 'rest'],
        description: 'API de gestion des factures et des paiements.', createdAt: t0 - 120 * DAY },
      { name: 'auth-service', kind: 'Component', type: 'service', owner: 'équipe-plateforme',
        lifecycle: 'production', system: 'socle-technique', tags: ['go', 'oidc'],
        description: 'Service central d’authentification (OIDC).', createdAt: t0 - 200 * DAY },
      { name: 'notifications-worker', kind: 'Component', type: 'service', owner: 'équipe-web',
        lifecycle: 'experimental', system: 'expérience-client', tags: ['python', 'rabbitmq'],
        description: 'Traitement asynchrone des notifications clients.', createdAt: t0 - 20 * DAY },
      { name: 'data-warehouse', kind: 'Resource', type: 'database', owner: 'équipe-data',
        lifecycle: 'production', system: 'données', tags: ['postgresql'],
        description: 'Entrepôt de données analytique mutualisé.', createdAt: t0 - 150 * DAY },
      { name: 'cluster-rancher-prod', kind: 'Resource', type: 'rancher-project', owner: 'équipe-plateforme',
        lifecycle: 'production', system: 'socle-technique', tags: ['kubernetes'],
        description: 'Cluster Kubernetes de production managé par Rancher.', createdAt: t0 - 300 * DAY },
      { name: 'registry-harbor', kind: 'Resource', type: 'harbor-project', owner: 'équipe-plateforme',
        lifecycle: 'production', system: 'socle-technique', tags: ['harbor', 'docker'],
        description: 'Registre d’images central avec scan de vulnérabilités.', createdAt: t0 - 300 * DAY },
      { name: 'portail-rh', kind: 'Component', type: 'service', owner: 'équipe-web',
        lifecycle: 'staging', system: 'ressources-humaines', tags: ['recette', 'taille-m'],
        description: 'Projet provisionné via la demande REQ-1037.', createdAt: t0 - 3 * DAY, fromRequest: 'REQ-1037' },
      { name: 'portail-rh-postgresql', kind: 'Resource', type: 'database', owner: 'équipe-web',
        lifecycle: 'staging', system: 'ressources-humaines', tags: ['postgresql'],
        description: 'Base PostgreSQL managée du projet portail-rh.', createdAt: t0 - 3 * DAY, fromRequest: 'REQ-1037' },
    ],
    requests: [
      {
        id: 'REQ-1037', name: 'portail-rh', team: 'équipe-web', requester: 'Marie Lambert',
        description: 'Refonte du portail RH interne (congés, notes de frais).',
        env: 'staging', size: 'M',
        network: 'FR', hypervisor: 'vmware',
        resources: { rancher: true, harbor: false, vm: true, vmCount: 1, postgres: true, mongo: false },
        status: 'available', createdAt: t0 - 3 * DAY,
        comment: 'Validé pour la recette. Prévoir une demande dédiée pour la production.',
        history: [
          { ts: t0 - 3 * DAY, label: 'Demande envoyée par Marie Lambert' },
          { ts: t0 - 3 * DAY + 2 * HOUR, label: 'Approuvée par Antoine Durand' },
          { ts: t0 - 3 * DAY + 2 * HOUR + 4 * MIN, label: 'Provisionnement terminé — ressources disponibles' },
        ],
        prov: null,
      },
      {
        id: 'REQ-1039', name: 'sandbox-data', team: 'équipe-data', requester: 'Karim Benali',
        description: 'Bac à sable pour tests de modèles de scoring.',
        env: 'dev', size: 'L',
        network: 'IT', hypervisor: 'hyperv',
        resources: { rancher: true, harbor: true, vm: true, vmCount: 4, postgres: false, mongo: true },
        status: 'rejected', createdAt: t0 - DAY,
        comment: 'Dimensionnement trop important pour un bac à sable : merci de repasser en taille S et d’utiliser l’offre data mutualisée.',
        history: [
          { ts: t0 - DAY, label: 'Demande envoyée par Karim Benali' },
          { ts: t0 - DAY + 5 * HOUR, label: 'Refusée par Antoine Durand' },
        ],
        prov: null,
      },
    ],
    activity: [
      { ts: t0 - 3 * DAY, icon: '📨', text: 'Marie Lambert a soumis la demande REQ-1037 (portail-rh).' },
      { ts: t0 - 3 * DAY + 2 * HOUR, icon: '✅', text: 'Antoine Durand a approuvé la demande REQ-1037.' },
      { ts: t0 - 3 * DAY + 2 * HOUR + 4 * MIN, icon: '🚀', text: 'Provisionnement de portail-rh terminé : 4 ressources créées.' },
      { ts: t0 - DAY + 5 * HOUR, icon: '⛔', text: 'Antoine Durand a refusé la demande REQ-1039 (sandbox-data).' },
    ],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* stockage indisponible ou corrompu : on repart de zéro */ }
  return defaultState();
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* mode privé, etc. */ }
}

let state = loadState();

/* État d'interface (non persisté) : page courante de chaque volet + assistant */
const ui = {
  user:  { page: 'catalog', entity: null, request: null, filterKind: 'all', filterOwner: 'all', search: '', templateSearch: '', templateCategory: 'all' },
  admin: { page: 'inbox', request: null, filter: 'all' },
  wizard: null, // créé à l'ouverture du template
};

/* ============================================================
   3. Utilitaires
   ============================================================ */

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function euro(n) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(ts) {
  const d = now() - ts;
  if (d < MIN) return 'à l’instant';
  if (d < HOUR) return `il y a ${Math.floor(d / MIN)} min`;
  if (d < DAY) return `il y a ${Math.floor(d / HOUR)} h`;
  return `il y a ${Math.floor(d / DAY)} j`;
}

function clock() {
  return new Date().toLocaleTimeString('fr-FR', { hour12: false });
}

/* Notification éphémère (snackbar) dans l'un des deux volets */
function toast(pane, message, type = 'info') {
  const box = document.getElementById(pane + '-toasts');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = message;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

function logActivity(icon, text) {
  state.activity.unshift({ ts: now(), icon, text });
}

/* Spécification « sur mesure » par défaut, par ressource */
const DEFAULT_CUSTOM = { cpu: 2, ram: 4, storage: 20 };

/* Spécification sur mesure d'une ressource (clé : nom de ressource, ou « vm:<index> ») */
function specFor(req, key) {
  return (req.customSpecs && req.customSpecs[key]) || DEFAULT_CUSTOM;
}

/* Tarif « sur mesure » simulé à partir des ressources unitaires choisies */
function customPrice(c) {
  return Math.round((c?.cpu ?? 0) * 12 + (c?.ram ?? 0) * 6 + (c?.storage ?? 0) * 0.2);
}

/* Prix mensuel d'une ressource dimensionnée pour une taille donnée */
function sizePrice(def, sz, custom) {
  if (sz === 'custom') return customPrice(custom);
  return def.prices?.[sz] ?? def.base;
}

/* Libellé de gabarit/plan d'une ressource pour une taille donnée */
function sizePlan(def, sz) {
  if (sz === 'custom') return 'Sur mesure';
  return def.planLabels?.[sz] ?? sz;
}

/* Coût mensuel estimé d'une demande (tarifs réels HT) */
function computeCost(req) {
  if (req.requestType === 'harbor-pull' || req.requestType === 'diode-push') return { lines: [], total: 0 };
  const r = req.resources;
  const rs = req.resourceSizes ?? {};
  const globalSize = req.size ?? 'S';
  const getSize = key => rs[key] ?? globalSize;
  const lines = [];
  if (r.rancher) {
    lines.push(['Projet Rancher (K8s)', RESOURCE_DEFS.rancher.base]);
  }
  if (r.harbor) {
    const gb = r.registryGb ?? 10;
    lines.push([`Registry Harbor (${gb} Go)`, gb]);
  }
  if (r.vm) {
    const def = RESOURCE_DEFS.vm;
    const vmSizes = req.vmSizes ?? Array(r.vmCount).fill(getSize('vm'));
    vmSizes.forEach((sz, i) => {
      lines.push([`VM ${sizePlan(def, sz)}${vmSizes.length > 1 ? ` #${i + 1}` : ''}`, sizePrice(def, sz, specFor(req, 'vm:' + i))]);
    });
  }
  if (r.postgres) {
    const def = RESOURCE_DEFS.postgres; const sz = getSize('postgres');
    lines.push([`PostgreSQL — ${sizePlan(def, sz)}`, sizePrice(def, sz, specFor(req, 'postgres'))]);
  }
  if (r.mariadb) {
    const def = RESOURCE_DEFS.mariadb; const sz = getSize('mariadb');
    lines.push([`MariaDB — ${sizePlan(def, sz)}`, sizePrice(def, sz, specFor(req, 'mariadb'))]);
  }
  if (r.mongo) {
    const def = RESOURCE_DEFS.mongo; const sz = getSize('mongo');
    lines.push([`MongoDB — ${sizePlan(def, sz)}`, sizePrice(def, sz, specFor(req, 'mongo'))]);
  }
  if (r.redis) {
    const def = RESOURCE_DEFS.redis; const sz = getSize('redis');
    lines.push([`Redis — ${sizePlan(def, sz)}`, sizePrice(def, sz, specFor(req, 'redis'))]);
  }
  if (r.rabbitmq) {
    const def = RESOURCE_DEFS.rabbitmq; const sz = getSize('rabbitmq');
    lines.push([`RabbitMQ — ${sizePlan(def, sz)}`, sizePrice(def, sz, specFor(req, 'rabbitmq'))]);
  }
  if (r.serverless) lines.push(['Serverless Containers (min.)', RESOURCE_DEFS.serverless.base]);
  if (r.wiki)       lines.push(['Wiki as a Service', RESOURCE_DEFS.wiki.base]);
  const total = Math.round(lines.reduce((s, l) => s + l[1], 0));
  return { lines, total };
}

/* Liste lisible des ressources d'une demande */
function resourceSummary(req) {
  if (req.requestType === 'harbor-pull')
    return [`⚓ Pull: ${req.imageName || '?'}:${req.imageTag || 'latest'} → ${req.targetCluster || '?'}`];
  if (req.requestType === 'diode-push')
    return [`🔒 Diode: ${req.imageName || '?'}:${req.imageTag || 'latest'} → ${(DIODE_NETWORKS[req.diodeNetwork] || {}).label || req.diodeNetwork || '?'}`];
  const r = req.resources;
  const out = [];
  if (r.rancher)    out.push(`Projet Rancher${r.rancherName ? ` (${r.rancherName})` : ''}`);
  if (r.harbor)     out.push(`Registry Harbor (${r.registryGb ?? 10} Go)`);
  if (r.vm)         out.push(`${r.vmCount} VM`);
  if (r.postgres)   out.push('PostgreSQL');
  if (r.mariadb)    out.push('MariaDB');
  if (r.mongo)      out.push('MongoDB');
  if (r.redis)      out.push('Redis');
  if (r.rabbitmq)   out.push('RabbitMQ');
  if (r.serverless) out.push('Serverless');
  if (r.wiki)       out.push(`Wiki${r.wikiName ? ` (${r.wikiName})` : ''}`);
  return out;
}

/* ---- Capacité & faisabilité (logique du plugin de gouvernance Ops) ---- */

/* Empreinte d'un gabarit (ou spécification sur mesure) */
function footprintForSize(sz, custom) {
  if (sz === 'custom') {
    const c = custom || DEFAULT_CUSTOM;
    return { cpu: c.cpu || 0, ram: c.ram || 0, storage: c.storage || 0 };
  }
  return SIZE_FOOTPRINT[sz] || SIZE_FOOTPRINT.S;
}

/* Empreinte totale d'une demande : ressources compute (région) + sous-total VM (hyperviseur) */
function computeFootprint(req) {
  if (req.requestType === 'harbor-pull' || req.requestType === 'diode-push')
    return { total: { cpu: 0, ram: 0, storage: 0 }, vm: { cpu: 0, ram: 0, storage: 0 } };
  const r = req.resources || {};
  const rs = req.resourceSizes || {};
  const globalSize = req.size || 'S';
  const getSize = k => rs[k] || globalSize;
  const total = { cpu: 0, ram: 0, storage: 0 };
  const vm = { cpu: 0, ram: 0, storage: 0 };
  const add = (dst, f) => { dst.cpu += f.cpu; dst.ram += f.ram; dst.storage += f.storage; };
  if (r.vm) {
    const vmSizes = req.vmSizes || Array(r.vmCount || 1).fill(getSize('vm'));
    vmSizes.forEach((sz, i) => { const f = footprintForSize(sz, specFor(req, 'vm:' + i)); add(total, f); add(vm, f); });
  }
  ['postgres', 'mariadb', 'mongo', 'redis', 'rabbitmq'].forEach(k => {
    if (r[k]) add(total, footprintForSize(getSize(k), specFor(req, k)));
  });
  return { total, vm };
}

/* Faut-il afficher le bloc faisabilité ? (au moins une ressource « compute ») */
function feasShouldShow(req) {
  const f = computeFootprint(req).total;
  return !!(f.cpu || f.ram || f.storage);
}

/* Charge déjà engagée sur une région (référence + demandes actives), hors demande courante */
function regionUsage(networkKey, excludeId) {
  const cap = CAPACITY[networkKey] || CAPACITY.FR;
  const used = { ...cap.used };
  const hvUsed = {};
  Object.keys(cap.hypervisors).forEach(h => { hvUsed[h] = { ...cap.hypervisors[h].used }; });
  state.requests.forEach(rq => {
    if (rq.id === excludeId) return;
    if ((rq.network || 'FR') !== networkKey) return;
    if (!['approved', 'provisioning', 'available'].includes(rq.status)) return;
    const fp = computeFootprint(rq);
    used.cpu += fp.total.cpu; used.ram += fp.total.ram; used.storage += fp.total.storage;
    if (fp.vm.cpu || fp.vm.ram || fp.vm.storage) {
      const hv = rq.hypervisor && rq.hypervisor !== 'auto' ? rq.hypervisor : 'vmware';
      if (hvUsed[hv]) { hvUsed[hv].cpu += fp.vm.cpu; hvUsed[hv].ram += fp.vm.ram; hvUsed[hv].storage += fp.vm.storage; }
    }
  });
  return { used, hvUsed };
}

const DIMS = ['cpu', 'ram', 'storage'];
function fits(pool, used, req) { return DIMS.every(d => used[d] + req[d] <= pool[d]); }
function tightness(pool, used, req) { return Math.max(...DIMS.map(d => (used[d] + req[d]) / pool[d])); }

/* Évalue la faisabilité d'une demande au regard de la capacité disponible */
function assessFeasibility(req) {
  const net = req.network || 'FR';
  const cap = CAPACITY[net] || CAPACITY.FR;
  const { used, hvUsed } = regionUsage(net, req.id);
  const fp = computeFootprint(req);

  const region = { pool: cap.pool, used, req: fp.total };
  const regionFits = fits(cap.pool, used, fp.total);

  const wantsVm = !!(req.resources && req.resources.vm) && (fp.vm.cpu || fp.vm.ram || fp.vm.storage);
  let hv = null, hvFits = true;
  if (wantsVm) {
    const key = req.hypervisor && req.hypervisor !== 'auto' ? req.hypervisor : 'auto';
    if (key === 'auto') {
      const pool = { cpu: 0, ram: 0, storage: 0 }, u = { cpu: 0, ram: 0, storage: 0 };
      Object.keys(cap.hypervisors).forEach(h => {
        DIMS.forEach(d => { pool[d] += cap.hypervisors[h].pool[d]; u[d] += hvUsed[h][d]; });
      });
      hv = { key: 'auto', pool, used: u, req: fp.vm };
      hvFits = fits(pool, u, fp.vm);
    } else {
      hv = { key, pool: cap.hypervisors[key].pool, used: hvUsed[key], req: fp.vm };
      hvFits = fits(hv.pool, hv.used, fp.vm);
    }
  }

  const feasible = regionFits && hvFits;
  let level = 'ok';
  if (!feasible) level = 'no';
  else {
    const t = Math.max(tightness(cap.pool, used, fp.total), hv ? tightness(hv.pool, hv.used, fp.vm) : 0);
    if (t > 0.9) level = 'tight';
  }
  return { net, fp, region, regionFits, hv, hvFits, feasible, level };
}

/* ============================================================
   4. Petits composants HTML réutilisables
   ============================================================ */

function statusChip(key) {
  const s = STATUSES[key] || STATUSES.draft;
  return `<span class="status ${s.cls}">${s.label}</span>`;
}

function chips(tags, cls = '') {
  return (tags || []).map(t => `<span class="chip ${cls}">${esc(t)}</span>`).join('');
}


/* Header de page façon Backstage : breadcrumbs + titre + métadonnées */
function pageHeader(theme, { crumbs, title, subtitle, meta = [], actions = '' }) {
  const bc = crumbs && crumbs.length
    ? `<div class="breadcrumbs">${crumbs.map((c, i) =>
        c.action
          ? `<a data-action="${c.action}" data-arg="${esc(c.arg || '')}">${esc(c.label)}</a>`
          : `<span>${esc(c.label)}</span>`
      ).join('<span class="sep">›</span>')}</div>`
    : '';
  const metaHtml = meta.length
    ? `<div class="page-header__meta">${meta.map(m =>
        `<div class="page-header__meta-item"><span class="label">${esc(m[0])}</span><span class="value">${m[1]}</span></div>`
      ).join('')}</div>` : '';
  return `
    <header class="page-header page-header--${theme}">
      ${bc}
      <div class="page-header__row">
        <div>
          <h1>${esc(title)}</h1>
          ${subtitle ? `<div class="page-header__subtitle">${subtitle}</div>` : ''}
        </div>
        ${metaHtml}${actions}
      </div>
    </header>`;
}

function emptyState(icon, title, text) {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">${icon}</div>
      <div class="empty-state__title">${esc(title)}</div>
      <p>${esc(text)}</p>
    </div>`;
}

/* Nombre formaté (séparateur de milliers) */
function fmtNum(n) { return Math.round(n).toLocaleString('fr-FR'); }

/* Une barre de capacité : charge existante + demande, sur la capacité totale */
function capRow(label, unit, pool, used, req) {
  const over = used + req > pool;
  const usedW = Math.min(100, used / pool * 100);
  const reqW = Math.max(0, Math.min(100 - usedW, req / pool * 100));
  const free = Math.max(0, pool - used);
  return `
    <div class="cap-row">
      <div class="cap-row__label">
        <span>${label}</span>
        <span>demande <strong style="color:${over ? 'var(--bs-error)' : 'var(--bs-text)'}">${fmtNum(req)} ${unit}</strong>
          · libre ${fmtNum(free)} / ${fmtNum(pool)} ${unit}</span>
      </div>
      <div class="cap-bar" title="${fmtNum(used)} ${unit} utilisés · ${fmtNum(req)} ${unit} demandés · ${fmtNum(pool)} ${unit} au total">
        <div class="cap-bar__seg cap-bar__used" style="width:${usedW}%"></div>
        <div class="cap-bar__seg cap-bar__req ${over ? 'cap-bar__req--over' : ''}" style="width:${reqW}%"></div>
      </div>
      ${over ? `<div class="cap-over">⛔ Dépassement de ${fmtNum(used + req - pool)} ${unit}</div>` : ''}
    </div>`;
}

function capPool(name, pool, used, req) {
  return `
    <div class="cap-pool">
      <div class="cap-pool__name">${name}</div>
      ${capRow('vCPU', 'vCPU', pool.cpu, used.cpu, req.cpu)}
      ${capRow('Mémoire', 'Go', pool.ram, used.ram, req.ram)}
      ${capRow('Stockage', 'Go', pool.storage, used.storage, req.storage)}
    </div>`;
}

/* Carte « Capacité & faisabilité » (vue Ops) ou aperçu compact (assistant) */
function feasibilityCard(req, opts = {}) {
  const a = assessFeasibility(req);
  const netLabel = `${NETWORKS[a.net].flag} ${NETWORKS[a.net].label}`;
  const v = {
    ok:    ['cap-verdict--ok',    '✅ Réalisable'],
    tight: ['cap-verdict--tight', '⚠️ Capacité tendue'],
    no:    ['cap-verdict--no',    '⛔ Insuffisant'],
  }[a.level];
  const hvName = a.hv
    ? (a.hv.key === 'auto' ? 'Tous hyperviseurs (placement auto)' : `${HYPERVISORS[a.hv.key].icon} ${HYPERVISORS[a.hv.key].label}`)
    : null;
  const meta = `
    <div class="cap-head">
      <div class="muted">Cible : <strong style="color:var(--bs-text)">${netLabel}</strong>${hvName ? ` · ${hvName}` : ''}</div>
      <div class="muted" style="margin-top:4px;">Empreinte : <strong style="color:var(--bs-text)">${fmtNum(a.fp.total.cpu)} vCPU</strong> · <strong style="color:var(--bs-text)">${fmtNum(a.fp.total.ram)} Go RAM</strong> · <strong style="color:var(--bs-text)">${fmtNum(a.fp.total.storage)} Go stockage</strong></div>
    </div>`;
  const bars = `
    <div class="cap-legend">
      <span class="lg-used">Charge existante</span>
      <span class="lg-req">Cette demande</span>
      <span class="lg-free">Disponible</span>
    </div>
    <div class="cap">
      ${capPool(`Pool région — ${NETWORKS[a.net].label}`, a.region.pool, a.region.used, a.region.req)}
      ${a.hv ? capPool(`Pool hyperviseur — ${a.hv.key === 'auto' ? 'agrégé' : HYPERVISORS[a.hv.key].label}`, a.hv.pool, a.hv.used, a.hv.req) : ''}
    </div>
    ${a.level === 'no' ? `<div class="banner banner--error" style="margin:14px 0 0;">⛔ <span>Capacité insuffisante sur <strong>${netLabel}</strong>. Réduisez le dimensionnement ou le nombre de VM, ou changez de région / d’hyperviseur.</span></div>` : ''}
    ${a.level === 'tight' ? `<div class="banner banner--warning" style="margin:14px 0 0;">⚠️ <span>Réalisable, mais consomme une large part de la capacité restante.</span></div>` : ''}`;

  if (opts.compact) {
    return `
      <div class="cap-card cap-card--inline">
        <div class="cap-card__bar"><span class="card__title" style="font-size:14px;">Faisabilité</span><span class="cap-verdict ${v[0]}">${v[1]}</span></div>
        ${meta}${bars}
      </div>`;
  }
  return `
    <div class="card">
      <div class="card__header">
        <div><span class="card__title">Capacité &amp; faisabilité</span>
          <div class="card__subtitle">Plugin Ops — inventaire infrastructure (simulé)</div></div>
        <span class="cap-verdict ${v[0]}">${v[1]}</span>
      </div>
      <div class="card__body">${meta}${bars}</div>
    </div>`;
}

/* ============================================================
   5. Vue utilisateur
   ============================================================ */

function renderUser() {
  const main = $('#user-main');
  const pages = {
    catalog: userCatalogPage,
    entity: userEntityPage,
    create: userTemplatesPage,
    wizard: userWizardPage,
    requests: userRequestsPage,
    requestDetail: userRequestDetailPage,
  };
  main.innerHTML = (pages[ui.user.page] || userCatalogPage)();
  syncSidebar('user');
}

/* ---- 5.1 Catalogue ---- */
function userCatalogPage() {
  const f = ui.user;
  const owners = [...new Set(state.entities.map(e => e.owner))].sort();

  let list = state.entities.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (f.filterKind !== 'all') list = list.filter(e => e.kind === f.filterKind);
  if (f.filterOwner !== 'all') list = list.filter(e => e.owner === f.filterOwner);
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(e => (e.name + e.description + (e.tags || []).join(' ')).toLowerCase().includes(q));
  }

  const countBy = kind => state.entities.filter(e => kind === 'all' || e.kind === kind).length;

  const rows = list.map(e => `
    <tr class="is-clickable" data-action="open-entity" data-arg="${esc(e.name)}">
      <td><span class="cell-name">${esc(e.name)}</span>
          ${e.fromRequest && isRecent(e) ? '<span class="chip chip--new">Nouveau</span>' : ''}</td>
      <td class="cell-secondary">${esc(e.system || '—')}</td>
      <td><a>${esc(e.owner)}</a></td>
      <td class="cell-secondary">${esc(e.type)}</td>
      <td class="cell-secondary">${esc(e.lifecycle)}</td>
      <td class="cell-secondary">${esc(e.description)}</td>
      <td>${chips(e.tags)}</td>
    </tr>`).join('');

  return `
    ${pageHeader('user', {
      title: 'Catalogue Internal Cloud Factory',
      subtitle: 'Software Catalog · composants, ressources et APIs de l’entreprise',
      meta: [['Mode', 'maquette'], ['Entités', String(state.entities.length)]],
    })}
    <div class="content content--with-filters">
      <aside class="filters card" style="padding:14px;">
        <div class="filter-group">
          <span class="label">Type d'entité</span>
          ${[['all', 'Toutes'], ['Component', 'Components'], ['Resource', 'Resources']].map(([k, lbl]) => `
            <div class="filter-option ${f.filterKind === k ? 'is-active' : ''}" data-action="filter-kind" data-arg="${k}">
              <span>${lbl}</span><span class="count">${countBy(k)}</span>
            </div>`).join('')}
        </div>
        <div class="filter-group">
          <span class="label">Propriétaire</span>
          <div class="filter-option ${f.filterOwner === 'all' ? 'is-active' : ''}" data-action="filter-owner" data-arg="all"><span>Tous</span></div>
          ${owners.map(o => `
            <div class="filter-option ${f.filterOwner === o ? 'is-active' : ''}" data-action="filter-owner" data-arg="${esc(o)}">
              <span>${esc(o)}</span>
            </div>`).join('')}
        </div>
      </aside>

      <div class="card">
        <div class="table-toolbar">
          <span class="table-toolbar__count">${list.length} entité${list.length > 1 ? 's' : ''}</span>
          <span class="table-toolbar__spacer"></span>
          <label class="search-field">
            <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
            <input type="text" id="catalog-search" placeholder="Filtrer" value="${esc(f.search)}" data-input="catalog-search">
          </label>
          <button class="btn btn--primary" data-action="goto-create">+ Créer</button>
        </div>
        <div class="table-wrap">
          ${list.length ? `
          <table class="bs-table">
            <thead><tr>
              <th>Nom</th><th>Système</th><th>Propriétaire</th><th>Type</th>
              <th>Cycle de vie</th><th>Description</th><th>Tags</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>` : emptyState('🔭', 'Aucune entité trouvée', 'Modifiez vos filtres ou créez un nouveau composant depuis un template.')}
        </div>
      </div>
    </div>`;
}

function isRecent(e) { return now() - e.createdAt < 2 * HOUR; }

/* ---- 5.2 Page d'une entité ---- */
function userEntityPage() {
  const e = state.entities.find(x => x.name === ui.user.entity);
  if (!e) { ui.user.page = 'catalog'; return userCatalogPage(); }
  const req = e.fromRequest ? state.requests.find(r => r.id === e.fromRequest) : null;
  const related = e.fromRequest ? state.entities.filter(x => x.fromRequest === e.fromRequest && x.name !== e.name) : [];

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'Catalogue', action: 'goto-catalog' }, { label: e.name }],
      title: e.name,
      subtitle: `${e.kind} — ${esc(e.type)}`,
      meta: [['Propriétaire', esc(e.owner)], ['Cycle de vie', esc(e.lifecycle)]],
    })}
    <div class="tabs">
      <button class="tab is-active">Aperçu</button>
      <button class="tab" data-action="not-included">CI/CD</button>
      <button class="tab" data-action="not-included">Dépendances</button>
      <button class="tab" data-action="not-included">Docs</button>
    </div>
    <div class="content">
      <div class="card">
        <div class="card__header"><span class="card__title">À propos</span>
          <button class="btn btn--text" data-action="not-included">Modifier</button></div>
        <div class="card__body">
          <div class="kv-grid">
            <div class="kv--full"><span class="label">Description</span><span class="value">${esc(e.description)}</span></div>
            <div><span class="label">Propriétaire</span><span class="value"><a>${esc(e.owner)}</a></span></div>
            <div><span class="label">Système</span><span class="value">${esc(e.system || '—')}</span></div>
            <div><span class="label">Type</span><span class="value">${esc(e.type)}</span></div>
            <div><span class="label">Cycle de vie</span><span class="value">${esc(e.lifecycle)}</span></div>
            <div class="kv--full"><span class="label">Tags</span><span class="value">${chips(e.tags) || '—'}</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__header"><span class="card__title">État du service</span></div>
        <div class="card__body">
          <div class="kv-grid">
            <div><span class="label">Disponibilité (30 j)</span><span class="value" style="color:#14632f;font-weight:700;">99,95 %</span></div>
            <div><span class="label">Statut</span><span class="value"><span class="status status--available">Opérationnel</span></span></div>
            <div><span class="label">Incidents ouverts</span><span class="value">0</span></div>
            ${req ? `<div><span class="label">Demande d'origine</span><span class="value"><a data-action="open-request" data-arg="${esc(req.id)}">${esc(req.id)}</a></span></div>` : ''}
          </div>
        </div>
      </div>

      ${related.length ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Ressources du même projet</span></div>
        <div class="card__body--flush table-wrap">
          <table class="bs-table">
            <thead><tr><th>Nom</th><th>Type</th><th>Cycle de vie</th><th>Description</th></tr></thead>
            <tbody>
              ${related.map(x => `
                <tr class="is-clickable" data-action="open-entity" data-arg="${esc(x.name)}">
                  <td><span class="cell-name">${esc(x.name)}</span></td>
                  <td class="cell-secondary">${esc(x.type)}</td>
                  <td class="cell-secondary">${esc(x.lifecycle)}</td>
                  <td class="cell-secondary">${esc(x.description)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
}

/* ---- 5.3 Page « Créer… » : galerie de templates ---- */
function userTemplatesPage() {
  const search = ui.user.templateSearch || '';
  const cat = ui.user.templateCategory || 'all';
  const CAT_COLORS = { infra: '#134a7c', app: '#1a6b3a', data: '#7b3a0e', docs: '#4a1a7c' };
  const TPL_CATS = [
    ['all', 'Tous'], ['infra', 'Infrastructure'], ['app', 'Application'],
    ['data', 'Data'], ['docs', 'Documentation'],
  ];
  let filtered = TEMPLATES;
  if (cat !== 'all') filtered = filtered.filter(t => t.category === cat);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t =>
      (t.title + ' ' + t.desc + ' ' + (t.tags || []).join(' ')).toLowerCase().includes(q));
  }
  const card = t => {
    const hColor = CAT_COLORS[t.category] || '#2a3d54';
    return `
      <article class="tpl-card">
        <div class="tpl-card__head" style="background:${hColor};">
          <div>
            <div class="tpl-card__type">${esc(t.type)}</div>
            <div class="tpl-card__title">${esc(t.title)}</div>
          </div>
          ${t.isNew ? '<span class="tpl-card__badge">Nouveau</span>' : ''}
        </div>
        <div class="tpl-card__body">
          <p class="tpl-card__desc">${esc(t.desc)}</p>
          <div class="tpl-card__tags">${chips(t.tags, 'chip--outline')}</div>
        </div>
        <div class="tpl-card__meta">
          <span class="tpl-card__meta-item">👤 ${esc(t.owner)}</span>
          <span class="tpl-card__meta-item">${esc(t.version)}</span>
          <span class="tpl-card__meta-item">🔧 ${t.usageCount} util.</span>
          ${t.duration ? `<span class="tpl-card__meta-item">⏱ ${esc(t.duration)}</span>` : ''}
        </div>
        <div class="tpl-card__foot">
          <button class="btn ${t.enabled ? 'btn--primary' : 'btn--outline'}"
                  data-action="${t.enabled ? (t.action || 'open-wizard') : 'not-included'}"
                  data-arg="${t.enabled ? (t.wizardType || t.resourceKey || '') : ''}">
            ${t.enabled ? 'Choisir' : 'Bientôt disponible'}
          </button>
        </div>
      </article>`;
  };
  return `
    ${pageHeader('user', {
      title: 'Créer un nouveau composant',
      subtitle: 'Software Templates · démarrez un projet à partir d’un modèle approuvé par l’équipe plateforme',
    })}
    <div class="tabs">
      <button class="tab is-active">Templates</button>
      <button class="tab" data-action="not-included">Tâches</button>
    </div>
    <div class="tpl-toolbar">
      <div class="tpl-cats">
        ${TPL_CATS.map(([k, lbl]) => `
          <button class="tpl-cat-btn ${cat === k ? 'is-active' : ''}" data-action="tpl-category" data-arg="${k}">${lbl}</button>`).join('')}
      </div>
      <label class="search-field">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
        <input type="text" placeholder="Rechercher un template…" value="${esc(search)}" data-input="tpl-search">
      </label>
    </div>
    <div class="content">
      ${filtered.length ? '<div class="banner banner--info">ℹ️ <span>Les templates appliquent automatiquement les standards de sécurité, de nommage et de supervision de l’entreprise.</span></div>' : ''}
      ${filtered.length
        ? `<div class="cards-grid">${filtered.map(card).join('')}</div>`
        : emptyState('🔍', 'Aucun template trouvé', 'Modifiez votre recherche ou sélectionnez une autre catégorie.')}
    </div>`;
}

/* ---- 5.4 Assistant multi-étapes (Software Template) ---- */

const WIZARD_STEPS = ['Informations', 'Environnement', 'Ressources', 'Dimensionnement', 'Résumé', 'Envoi'];

function newWizard(resourceKey) {
  const isBundle = !resourceKey;
  const def = resourceKey ? RESOURCE_DEFS[resourceKey] : null;
  return {
    step: 0,
    error: '',
    sentRequestId: null,
    resourceKey:      resourceKey || null,
    templateTitle:    isBundle ? 'Bundle' : (def.icon + ' ' + def.label),
    templateSubtitle: isBundle
      ? 'Template géré par équipe-plateforme · v2.4'
      : 'Provisionnement individuel · équipe-plateforme · v1.0',
    data: {
      name: '', team: TEAMS[0], description: '',
      env: 'dev', size: 'S',
      network: 'FR', hypervisor: 'auto',
      customSpecs: {},
      resourceSizes: { vm: 'S', postgres: 'S', mariadb: 'S', mongo: 'S', redis: 'S', rabbitmq: 'S' },
      vmSizes: resourceKey === 'vm' ? ['S'] : ['S', 'S'],
      resources: {
        rancher:         isBundle || resourceKey === 'rancher',
        rancherName:     '',
        harbor:          resourceKey === 'harbor',
        registryGb:      10,
        vm:              resourceKey === 'vm',
        vmCount:         resourceKey === 'vm' ? 1 : 2,
        postgres:        resourceKey === 'postgres',
        mariadb:         resourceKey === 'mariadb',
        mongo:           resourceKey === 'mongo',
        redis:           resourceKey === 'redis',
        rabbitmq:        resourceKey === 'rabbitmq',
        serverless:      resourceKey === 'serverless',
        serverlessImage: '',
        wiki:            resourceKey === 'wiki',
        wikiName:        '',
      },
    },
  };
}

const IMAGE_WIZARD_STEPS = {
  'harbor-pull': ['Identification', 'Image source', 'Destination', 'Résumé', 'Envoi'],
  'diode-push':  ['Identification', 'Image source', 'Destination', 'Classification', 'Résumé', 'Envoi'],
};

function newImageWizard(type) {
  const meta = {
    'harbor-pull': { title: '⚓ Pull image Harbor',       subtitle: 'Rapatriement d\'image · équipe-plateforme · v1.2' },
    'diode-push':  { title: '🔒 Push vers réseau sous diode', subtitle: 'Transfert sécurisé sous diode · équipe-plateforme · v1.0' },
  };
  const m = meta[type] || meta['harbor-pull'];
  return {
    step: 0, error: '', sentRequestId: null,
    wizardType: type, resourceKey: null,
    templateTitle: m.title, templateSubtitle: m.subtitle,
    data: {
      team: TEAMS[0], justification: '',
      harborProject: '', imageName: '', imageTag: 'latest',
      targetCluster: 'cluster-rancher-prod', targetNamespace: '',
      diodeNetwork: 'diode-prod', targetSystem: '', targetPath: '/images',
      securityLevel: 'sensible',
    },
  };
}

function imageWizardPage() {
  const w = ui.wizard;
  const steps = IMAGE_WIZARD_STEPS[w.wizardType] || [];
  const lastStep = steps.length - 1;
  const summaryStep = steps.length - 2;
  const isConfirm = w.step === lastStep;
  const isSummary = w.step === summaryStep;

  const stepper = `
    <div class="stepper">
      ${steps.map((label, i) => `
        <div class="stepper__step ${i === w.step ? 'is-active' : ''} ${i < w.step ? 'is-done' : ''}"
             ${i < w.step ? `data-action="img-wiz-goto-step" data-arg="${i}"` : ''}>
          <div class="stepper__num">${i < w.step ? '✓' : i + 1}</div>
          <div class="stepper__label">${label}</div>
        </div>`).join('')}
    </div>`;

  const pullFns = [imgWizStepId, imgWizStepImage, imgWizStepCluster, imgWizSummaryPull, imgWizConfirm];
  const pushFns = [imgWizStepId, imgWizStepImage, imgWizStepDiode, imgWizStepSecurity, imgWizSummaryPush, imgWizConfirm];
  const bodyFns = w.wizardType === 'harbor-pull' ? pullFns : pushFns;
  const body = (bodyFns[w.step] || (() => ''))();

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'Créer…', action: 'goto-create' }, { label: w.templateTitle }],
      title: w.templateTitle,
      subtitle: w.templateSubtitle,
    })}
    <div class="content">
      <div class="card">
        <div class="card__body">
          ${stepper}
          ${w.error ? `<div class="banner banner--error">⚠️ <span>${esc(w.error)}</span></div>` : ''}
          ${body}
          ${isConfirm ? '' : `
          <div class="wizard-actions">
            <div>
              ${w.step > 0
                ? '<button class="btn btn--text" data-action="img-wiz-prev">Précédent</button>'
                : '<button class="btn btn--text" data-action="goto-create">Annuler</button>'}
            </div>
            <div>
              ${isSummary
                ? '<button class="btn btn--success" data-action="img-wiz-submit">📨 Envoyer la demande</button>'
                : '<button class="btn btn--primary" data-action="img-wiz-next">Suivant</button>'}
            </div>
          </div>`}
        </div>
      </div>
    </div>`;
}

/* ---- Étapes de l'assistant image ---- */

function imgWizStepId() {
  const d = ui.wizard.data;
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Identification de la demande</h3>
      <div class="form-row">
        <label class="field-label">Équipe demandeuse</label>
        <select class="field-select" data-input="img-wiz-team">
          ${TEAMS.map(t => `<option value="${esc(t)}" ${d.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label class="field-label">Justification / ticket de référence <span style="color:var(--bs-danger)">*</span></label>
        <textarea rows="3" class="field-textarea" style="font-family:inherit;font-size:14px;padding:8px;border:1px solid var(--bs-border);border-radius:6px;width:100%;resize:vertical;"
                  placeholder="Décrivez le besoin et joignez un numéro de ticket si disponible…"
                  data-input="img-wiz-justification">${esc(d.justification)}</textarea>
      </div>
    </div>`;
}

function imgWizStepImage() {
  const d = ui.wizard.data;
  const harbProjects = [...new Set(
    state.entities.filter(e => e.type === 'harbor-project').map(e => e.name)
  )];
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Image source (registre Harbor)</h3>
      <div class="form-row">
        <label class="field-label">Projet Harbor <span style="color:var(--bs-danger)">*</span></label>
        ${harbProjects.length ? `
        <select class="field-select" data-input="img-wiz-project">
          <option value="">— Sélectionner un projet —</option>
          ${harbProjects.map(p => `<option value="${esc(p)}" ${d.harborProject === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
          <option value="__custom__" ${!harbProjects.includes(d.harborProject) && d.harborProject && d.harborProject !== '__custom__' ? 'selected' : ''}>Autre projet (saisir manuellement)</option>
        </select>
        ${(!harbProjects.includes(d.harborProject) && d.harborProject && d.harborProject !== '__custom__') || d.harborProject === '__custom__' ? `
        <input type="text" class="field-input" style="margin-top:6px;" placeholder="nom-du-projet"
               data-input="img-wiz-project-custom" value="${esc(d.harborProject === '__custom__' ? '' : d.harborProject)}">` : ''}` : `
        <input type="text" class="field-input" placeholder="ex. équipe-web/portail-client"
               data-input="img-wiz-project" value="${esc(d.harborProject)}">`}
      </div>
      <div class="form-row">
        <label class="field-label">Nom de l\'image <span style="color:var(--bs-danger)">*</span></label>
        <input type="text" class="field-input" placeholder="ex. mon-app-backend"
               data-input="img-wiz-image" value="${esc(d.imageName)}">
      </div>
      <div class="form-row">
        <label class="field-label">Tag <span style="color:var(--bs-danger)">*</span></label>
        <input type="text" class="field-input" placeholder="ex. v1.4.2 ou latest"
               data-input="img-wiz-tag" value="${esc(d.imageTag)}">
        <div class="field-hint muted" style="margin-top:4px;font-size:12px;">Référence complète : harbor.internal/${esc(d.harborProject || '<projet>')}/${esc(d.imageName || '<image>')}:${esc(d.imageTag || 'latest')}</div>
      </div>
    </div>`;
}

function imgWizStepCluster() {
  const d = ui.wizard.data;
  const clusters = [...new Set(
    state.entities.filter(e => e.type === 'rancher-project').map(e => e.name)
  )];
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Destination (cluster Rancher)</h3>
      <div class="form-row">
        <label class="field-label">Cluster cible <span style="color:var(--bs-danger)">*</span></label>
        ${clusters.length ? `
        <select class="field-select" data-input="img-wiz-cluster">
          <option value="">— Sélectionner un cluster —</option>
          ${clusters.map(c => `<option value="${esc(c)}" ${d.targetCluster === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          <option value="__custom__" ${!clusters.includes(d.targetCluster) && d.targetCluster ? 'selected' : ''}>Autre cluster</option>
        </select>
        ${(!clusters.includes(d.targetCluster) && d.targetCluster) ? `
        <input type="text" class="field-input" style="margin-top:6px;" placeholder="nom-du-cluster"
               data-input="img-wiz-cluster-custom" value="${esc(d.targetCluster)}">` : ''}` : `
        <input type="text" class="field-input" placeholder="ex. cluster-rancher-prod"
               data-input="img-wiz-cluster" value="${esc(d.targetCluster)}">`}
      </div>
      <div class="form-row">
        <label class="field-label">Namespace cible</label>
        <input type="text" class="field-input" placeholder="ex. production (vide = namespace par défaut)"
               data-input="img-wiz-namespace" value="${esc(d.targetNamespace)}">
      </div>
    </div>`;
}

function imgWizStepDiode() {
  const d = ui.wizard.data;
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Destination (réseau sous diode)</h3>
      <div class="banner banner--warning" style="margin-bottom:16px;">⚡ <span>Le transfert est <strong>unidirectionnel</strong> : aucun flux de retour n'est possible une fois l\'image transférée.</span></div>
      <div class="form-row">
        <label class="field-label">Zone de destination <span style="color:var(--bs-danger)">*</span></label>
        <div class="pick-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:6px;">
          ${Object.entries(DIODE_NETWORKS).map(([key, net]) => `
            <div class="pick-card ${d.diodeNetwork === key ? 'is-selected' : ''}"
                 data-action="img-wiz-diode" data-arg="${esc(key)}" style="cursor:pointer;padding:12px;border:2px solid ${d.diodeNetwork === key ? 'var(--bs-primary)' : 'var(--bs-border)'};border-radius:8px;">
              <div style="font-size:22px;margin-bottom:4px;">${net.icon}</div>
              <div style="font-weight:600;font-size:14px;">${esc(net.label)}</div>
              <div class="muted" style="font-size:12px;margin-top:2px;">${esc(net.desc)}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="form-row">
        <label class="field-label">Système cible <span style="color:var(--bs-danger)">*</span></label>
        <input type="text" class="field-input" placeholder="ex. serveur-isolé-prod"
               data-input="img-wiz-system" value="${esc(d.targetSystem)}">
      </div>
      <div class="form-row">
        <label class="field-label">Chemin de dépôt sur le système cible</label>
        <input type="text" class="field-input" placeholder="ex. /images/applicatifs"
               data-input="img-wiz-path" value="${esc(d.targetPath)}">
      </div>
    </div>`;
}

function imgWizStepSecurity() {
  const d = ui.wizard.data;
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Classification et sécurité</h3>
      <div class="banner banner--error" style="margin-bottom:16px;">🔒 <span>Le transfert via diode est soumis à la politique de <strong>sécurité des systèmes d'information sensibles</strong>. Toute erreur de classification engage la responsabilité du demandeur.</span></div>
      <div class="form-row">
        <label class="field-label">Niveau de classification du contenu transféré <span style="color:var(--bs-danger)">*</span></label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">
          ${Object.entries(SECURITY_LEVELS).map(([key, lvl]) => `
            <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid ${d.securityLevel === key ? lvl.color : 'var(--bs-border)'};border-radius:8px;cursor:pointer;background:${d.securityLevel === key ? lvl.color + '18' : 'transparent'};">
              <input type="radio" name="seclevel" data-action="img-wiz-seclevel" data-arg="${esc(key)}" ${d.securityLevel === key ? 'checked' : ''} style="accent-color:${lvl.color};">
              <span style="font-size:18px;">${lvl.icon}</span>
              <span style="font-weight:600;">${esc(lvl.label)}</span>
            </label>`).join('')}
        </div>
      </div>
      <div class="form-row" style="margin-top:12px;">
        <label class="field-label" style="color:var(--bs-text-muted);font-size:12px;">En soumettant cette demande, vous certifiez que l\'image à transférer ne contient aucun code malveillant et que sa classification est correcte.</label>
      </div>
    </div>`;
}

function imgWizSummaryPull() {
  const d = ui.wizard.data;
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Résumé de la demande</h3>
      <div class="kv-grid" style="margin-top:12px;">
        <div><span class="label">Type</span><span class="value">⚓ Pull image Harbor</span></div>
        <div><span class="label">Équipe</span><span class="value">${esc(d.team)}</span></div>
        <div><span class="label">Image</span><span class="value mono">harbor.internal/${esc(d.harborProject)}/${esc(d.imageName)}:${esc(d.imageTag)}</span></div>
        <div><span class="label">Cluster cible</span><span class="value">${esc(d.targetCluster)}</span></div>
        <div><span class="label">Namespace</span><span class="value">${esc(d.targetNamespace) || 'default'}</span></div>
        <div class="kv--full"><span class="label">Justification</span><span class="value">${esc(d.justification)}</span></div>
      </div>
      <div class="banner banner--info" style="margin-top:16px;">ℹ️ <span>L'équipe plateforme vérifiera la demande et lancera le pipeline de scan Trivy + déploiement Rancher.</span></div>
    </div>`;
}

function imgWizSummaryPush() {
  const d = ui.wizard.data;
  const net = DIODE_NETWORKS[d.diodeNetwork];
  const lvl = SECURITY_LEVELS[d.securityLevel];
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Résumé de la demande</h3>
      <div class="kv-grid" style="margin-top:12px;">
        <div><span class="label">Type</span><span class="value">🔒 Push vers réseau sous diode</span></div>
        <div><span class="label">Équipe</span><span class="value">${esc(d.team)}</span></div>
        <div><span class="label">Image</span><span class="value mono">harbor.internal/${esc(d.harborProject)}/${esc(d.imageName)}:${esc(d.imageTag)}</span></div>
        <div><span class="label">Zone diode</span><span class="value">${net ? net.icon + ' ' + net.label : esc(d.diodeNetwork)}</span></div>
        <div><span class="label">Système cible</span><span class="value">${esc(d.targetSystem)}</span></div>
        <div><span class="label">Chemin</span><span class="value mono">${esc(d.targetPath)}</span></div>
        <div><span class="label">Classification</span><span class="value" style="color:${lvl ? lvl.color : 'inherit'}">${lvl ? lvl.icon + ' ' + lvl.label : esc(d.securityLevel)}</span></div>
        <div class="kv--full"><span class="label">Justification</span><span class="value">${esc(d.justification)}</span></div>
      </div>
      <div class="banner banner--warning" style="margin-top:16px;">⚡ <span>Ce transfert est soumis à une <strong>validation renforcée</strong>. Le pipeline inclut scan AV, Trivy, chiffrement AES-256 et traçabilité complète.</span></div>
    </div>`;
}

function imgWizConfirm() {
  const w = ui.wizard;
  const id = w.sentRequestId;
  return `
    <div style="text-align:center;padding:32px 16px;">
      <div style="font-size:48px;margin-bottom:16px;">📨</div>
      <h3 style="margin-bottom:8px;">Demande envoyée !</h3>
      <p class="muted">Votre demande <strong>${esc(id)}</strong> est en attente de validation par l'équipe plateforme.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:24px;">
        <button class="btn btn--outline" data-action="open-request" data-arg="${esc(id)}">Suivre ma demande</button>
        <button class="btn btn--primary" data-action="goto-catalog">Retour au catalogue</button>
      </div>
    </div>`;
}

function validateImageWizardStep() {
  const w = ui.wizard;
  const d = w.data;
  const steps = IMAGE_WIZARD_STEPS[w.wizardType] || [];
  const summaryStep = steps.length - 2;

  if (w.step === 0 && !d.justification.trim()) return 'La justification est obligatoire.';
  if (w.step === 1) {
    if (!d.imageName.trim()) return 'Le nom de l\'image est obligatoire.';
    if (!d.imageTag.trim()) return 'Le tag de l\'image est obligatoire.';
  }
  if (w.wizardType === 'harbor-pull' && w.step === 2 && !d.targetCluster.trim()) return 'Le cluster cible est obligatoire.';
  if (w.wizardType === 'diode-push' && w.step === 2 && !d.targetSystem.trim()) return 'Le système cible est obligatoire.';
  return '';
}

function submitImageWizard() {
  const w = ui.wizard;
  const d = w.data;
  const id = `REQ-${state.nextRequestNum++}`;
  const label = w.wizardType === 'harbor-pull' ? 'Pull image Harbor' : 'Push vers réseau sous diode';
  const req = {
    id, requestType: w.wizardType,
    name: `${w.wizardType === 'harbor-pull' ? 'pull' : 'push'}-${d.imageName.trim() || 'image'}-${id.toLowerCase()}`,
    team: d.team, requester: 'Marie Lambert',
    description: d.justification.trim(),
    env: 'prod', size: 'S', network: 'FR', hypervisor: 'auto',
    resources: {}, customSpecs: {}, resourceSizes: {}, vmSizes: [],
    /* champs spécifiques image */
    harborProject: d.harborProject.trim(),
    imageName: d.imageName.trim(),
    imageTag: d.imageTag.trim(),
    targetCluster: d.targetCluster.trim(),
    targetNamespace: d.targetNamespace.trim(),
    diodeNetwork: d.diodeNetwork,
    targetSystem: d.targetSystem.trim(),
    targetPath: d.targetPath.trim(),
    securityLevel: d.securityLevel,
    status: 'pending', createdAt: now(),
    comment: '', prov: null,
    history: [{ ts: now(), label: `Demande de ${label} envoyée par Marie Lambert` }],
  };
  state.requests.unshift(req);
  logActivity('📨', `Marie Lambert a soumis la demande ${id} (${label} — ${d.imageName}:${d.imageTag}).`);
  saveState();

  w.sentRequestId = id;
  w.step = (IMAGE_WIZARD_STEPS[w.wizardType] || []).length - 1;
  renderUser();
  renderAdmin();
  renderBadges();
  toast('user', `Demande <strong>${id}</strong> envoyée pour validation`, 'success');
  toast('admin', `🔔 Nouvelle demande <strong>${id}</strong> à valider`, 'info');
}

function userWizardPage() {
  const w = ui.wizard;
  if (!w) { ui.user.page = 'create'; return userTemplatesPage(); }
  if (w.wizardType === 'harbor-pull' || w.wizardType === 'diode-push') return imageWizardPage();

  const activeSteps = WIZARD_STEPS.map((label, i) => ({ label, i }))
    .filter(({ i }) => !(w.resourceKey && i === 2));
  const stepper = `
    <div class="stepper">
      ${activeSteps.map(({ label, i }, di) => `
        <div class="stepper__step ${i === w.step ? 'is-active' : ''} ${i < w.step ? 'is-done' : ''}"
             ${i < w.step ? `data-action="wiz-goto-step" data-arg="${i}"` : ''}>
          <div class="stepper__num">${i < w.step ? '✓' : di + 1}</div>
          <div class="stepper__label">${label}</div>
        </div>`).join('')}
    </div>`;

  const bodies = [wizStep1, wizStep2, wizStep3, wizStep4, wizStep5, wizStep6];
  const isLastInfo = w.step === 5;
  const resCount = RES_ORDER.filter(k => w.data.resources[k]).length;
  const costStrip = (w.step >= 2 && w.step <= 4)
    ? `<div class="wizard-cost-strip">
        <span><strong>${resCount}</strong> ressource${resCount !== 1 ? 's' : ''} sélectionnée${resCount !== 1 ? 's' : ''}</span>
        <span>Estimation mensuelle : <strong>${euro(computeCost(w.data).total)}</strong> <small>HT</small></span>
       </div>`
    : '';

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'Créer…', action: 'goto-create' }, { label: w.templateTitle || 'Bundle' }],
      title: w.templateTitle || 'Bundle',
      subtitle: w.templateSubtitle || 'Template géré par équipe-plateforme · v2.4',
    })}
    <div class="content">
      <div class="card">
        <div class="card__body">
          ${stepper}
          ${w.error ? `<div class="banner banner--error">⚠️ <span>${esc(w.error)}</span></div>` : ''}
          ${bodies[w.step]()}
          ${costStrip}
          ${isLastInfo ? '' : `
          <div class="wizard-actions">
            <div>
              ${w.step > 0 ? '<button class="btn btn--text" data-action="wiz-prev">Précédent</button>' : '<button class="btn btn--text" data-action="goto-create">Annuler</button>'}
            </div>
            <div>
              ${w.step < 4
                ? '<button class="btn btn--primary" data-action="wiz-next">Suivant</button>'
                : '<button class="btn btn--success" data-action="wiz-submit">📨 Envoyer la demande</button>'}
            </div>
          </div>`}
        </div>
      </div>
    </div>`;
}

/* Étape 1 : informations générales */
function wizStep1() {
  const d = ui.wizard.data;
  const name = d.name.trim();
  const slugOk = name && /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(name);
  const slugTaken = name && (
    state.entities.some(e => e.name === name) ||
    state.requests.some(r => r.name === name && r.status !== 'rejected')
  );
  const slugValid = slugOk && !slugTaken;
  const indicator = name
    ? `<span class="slug-indicator ${slugValid ? 'slug-ok' : 'slug-err'}">${slugValid ? '✓' : slugTaken ? 'Déjà utilisé' : '✗ Format invalide'}</span>`
    : '';
  return `
    <div class="form-grid-2">
      <div class="form-row">
        <label class="field-label">Nom du projet <span class="required">*</span></label>
        <div class="slug-input-wrap">
          <input type="text" placeholder="ex. portail-fournisseurs" value="${esc(d.name)}" data-input="wiz-name">
          ${indicator}
        </div>
        <div class="hint">Minuscules, chiffres et tirets uniquement — utilisé pour nommer toutes les ressources.</div>
        ${name.length >= 3 ? `
        <div class="slug-preview">
          <span class="slug-preview__label">Aperçu du nommage :</span>
          <div class="slug-preview__items">
            <span class="slug-chip slug-chip--main">${esc(name)}</span>
            <span class="slug-chip">${esc(name)}-rancher</span>
            <span class="slug-chip">${esc(name)}-postgresql</span>
            <span class="slug-chip">${esc(name)}-redis</span>
            <span class="slug-chip">…</span>
          </div>
        </div>` : ''}
      </div>
      <div class="form-row">
        <label class="field-label">Propriétaire / équipe responsable <span class="required">*</span></label>
        <select data-input="wiz-team">
          ${TEAMS.map(t => `<option ${t === d.team ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <label class="field-label">Description</label>
      <textarea rows="3" placeholder="À quoi servira ce projet ?" data-input="wiz-desc">${esc(d.description)}</textarea>
    </div>
  `;
}

/* Étape 2 : environnement cible */
function wizStep2() {
  const d = ui.wizard.data;
  return `
    <div class="form-row">
      <label class="field-label">Environnement cible <span class="required">*</span></label>
      <div class="pick-grid">
        ${Object.entries(ENVIRONMENTS).map(([k, e]) => `
          <div class="pick-card ${d.env === k ? 'is-selected' : ''}" data-action="wiz-env" data-arg="${k}">
            <div class="pick-card__icon">${e.icon}</div>
            <div class="pick-card__title">${e.label}</div>
            <div class="pick-card__desc">${e.desc}</div>
          </div>`).join('')}
      </div>
      ${d.env === 'prod' ? '<div class="banner banner--warning" style="margin-top:14px;">⚠️ <span>Un environnement de production nécessite une validation renforcée de l’équipe plateforme.</span></div>' : ''}
    </div>
    <div class="form-row">
      <label class="field-label">Réseau / région cible <span class="required">*</span></label>
      <div class="pick-grid">
        ${Object.entries(NETWORKS).map(([k, n]) => `
          <div class="pick-card ${d.network === k ? 'is-selected' : ''}" data-action="wiz-network" data-arg="${k}">
            <div class="pick-card__icon">${n.flag}</div>
            <div class="pick-card__title">${n.label}</div>
            <div class="pick-card__desc">${n.desc}</div>
          </div>`).join('')}
      </div>
      <div class="hint">Détermine le datacenter d’hébergement et le pool de capacité utilisé. L’hyperviseur des VM se choisit à l’étape « Dimensionnement ».</div>
    </div>`;
}

/* Ordre d'affichage des ressources (sélection à l'étape 3, configuration à l'étape 4) */
const RES_ORDER = ['rancher', 'harbor', 'vm', 'postgres', 'mariadb', 'mongo', 'redis', 'rabbitmq', 'serverless', 'wiki'];

/* Étape 3 : sélection des ressources (choix seul, configuration à l'étape suivante) */
const RES_GROUPS = [
  { label: 'Orchestration & Registres', keys: ['rancher', 'harbor'] },
  { label: 'Machines virtuelles', keys: ['vm'] },
  { label: 'Bases de données', keys: ['postgres', 'mariadb', 'mongo'] },
  { label: 'Cache & Messagerie', keys: ['redis', 'rabbitmq'] },
  { label: 'Services managés', keys: ['serverless', 'wiki'] },
];

function wizStep3() {
  const r = ui.wizard.data.resources;
  const card = key => {
    const def = RESOURCE_DEFS[key];
    const priceStr = key === 'harbor' ? '1 € / Go / mois' : `dès ${euro(def.base)} / mois`;
    return `
      <div class="pick-card ${r[key] ? 'is-selected' : ''}" data-action="wiz-res" data-arg="${key}">
        <div class="pick-card__icon">${def.icon}</div>
        <div class="pick-card__title">${def.label}</div>
        <div class="pick-card__desc">${def.desc}</div>
        <div class="pick-card__price">${priceStr}</div>
      </div>`;
  };
  const depHint = (r.serverless && !r.rancher)
    ? `<div class="dep-hint">⚠️ <strong>Dépendance :</strong> Serverless Containers nécessite un projet Rancher — sélectionnez-le également.</div>`
    : '';
  return `
    <div class="form-row">
      <label class="field-label">Ressources souhaitées <span class="required">*</span> <span class="muted">(au moins une — cliquez pour sélectionner)</span></label>
      <div class="banner banner--info">ℹ️ <span>Choisissez les ressources à provisionner. Les détails (nom, volume, dimensionnement…) se configurent à l’étape <strong>Dimensionnement</strong>.</span></div>
      ${RES_GROUPS.map(g => `
        <div class="res-group">
          <div class="res-group__header">${g.label}</div>
          <div class="pick-grid">${g.keys.map(card).join('')}</div>
        </div>`).join('')}
      ${depHint}
    </div>`;
}


/* Étape 4 : configuration et dimensionnement de chaque ressource + estimation de coût */
function wizStep4() {
  const d = ui.wizard.data;
  const r = d.resources;
  const rs = d.resourceSizes;
  const cost = computeCost(d);
  const selected = RES_ORDER.filter(k => r[k]);
  const selectedSized = SIZED_KEYS.filter(k => r[k]);

  if (!selected.length) {
    return emptyState('🧩', 'Aucune ressource à configurer',
      'Revenez à l’étape « Ressources » pour sélectionner au moins une ressource à provisionner.');
  }

  /* Texte de spec pour une taille donnée (ex. "PG-M · 4 vCPU · 16 Go RAM · 100 Go") */
  const sizeSpecsText = (key, sz) => {
    if (sz === 'custom') return 'Spécification libre';
    const def = RESOURCE_DEFS[key];
    const plan = def.planLabels?.[sz];
    const fp = SIZE_FOOTPRINT[sz];
    const parts = [];
    if (plan) parts.push(plan);
    if (fp) parts.push(`${fp.cpu} vCPU · ${fp.ram} Go RAM · ${fp.storage} Go stockage`);
    return parts.join(' · ');
  };

  /* Groupe de pills S/M/L/XL/⚙ pour une ressource donnée */
  const pillGroup = (currentSize, actionArg, resourceKey) => {
    const pills = Object.keys(SIZES).map(sz => `
      <button class="dim-pill ${currentSize === sz ? 'dim-pill--active' : ''}"
              data-action="wiz-ressize" data-arg="${actionArg}:${sz}"
              title="${SIZES[sz].label}">${sz === 'custom' ? '⚙' : sz}</button>`).join('');
    const specTxt = sizeSpecsText(resourceKey, currentSize);
    const def = RESOURCE_DEFS[resourceKey];
    const priceStr = currentSize === 'custom' ? '' : ` · <span class="dim-specs__price">${euro(sizePrice(def, currentSize, specFor(d, actionArg)))}/mois</span>`;
    return `
      <div class="dim-pills">${pills}</div>
      <div class="dim-specs">${specTxt}${priceStr}</div>`;
  };

  /* Éditeur sur mesure (affiché seulement si sz === 'custom') */
  const customEditor = specKey => {
    const c = d.customSpecs[specKey] || DEFAULT_CUSTOM;
    return `
      <div class="dim-custom-editor">
        <div class="dim-custom-fields">
          <label class="dim-custom-field"><span>vCPU</span>
            <input type="number" min="1" max="64" value="${c.cpu}" data-input="wiz-rescustom" data-ckey="${specKey}" data-cfield="cpu">
          </label>
          <label class="dim-custom-field"><span>RAM (Go)</span>
            <input type="number" min="1" max="256" value="${c.ram}" data-input="wiz-rescustom" data-ckey="${specKey}" data-cfield="ram">
          </label>
          <label class="dim-custom-field"><span>Stockage (Go)</span>
            <input type="number" min="1" max="2000" value="${c.storage}" data-input="wiz-rescustom" data-ckey="${specKey}" data-cfield="storage">
          </label>
        </div>
        <div class="dim-custom-hint">12 €/vCPU + 6 €/Go RAM + 0,20 €/Go stockage = <strong>${euro(customPrice(c))}/mois</strong></div>
      </div>`;
  };

  /* Carte pour une ressource */
  const resCard = key => {
    const def = RESOURCE_DEFS[key];
    const sz = rs[key] ?? d.size;

    switch (key) {
      case 'rancher':
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(def.base)}<small>/mois</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-field-row">
              <label>Nom du projet Rancher</label>
              <input type="text" class="dim-input" value="${esc(r.rancherName)}" placeholder="${esc(d.name || 'mon-projet')}" data-input="wiz-ranchername">
            </div>
          </div>
        </div>`;

      case 'harbor':
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(r.registryGb ?? 10)}<small>/mois</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-field-row">
              <label>Capacité</label>
              <input type="number" min="1" max="500" value="${r.registryGb}" data-input="wiz-registrygb" style="width:72px;">
              <span class="muted">Go (1 €/Go/mois)</span>
            </div>
          </div>
        </div>`;

      case 'serverless':
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(def.base)}<small>/mois min.</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-field-row">
              <label>Image conteneur</label>
              <input type="text" class="dim-input" value="${esc(r.serverlessImage)}" placeholder="harbor.exemple.fr/projet/image:tag" data-input="wiz-serverlessimage">
            </div>
          </div>
        </div>`;

      case 'wiki':
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(def.base)}<small>/mois</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-field-row">
              <label>Nom du wiki</label>
              <input type="text" class="dim-input" value="${esc(r.wikiName)}" placeholder="${esc((d.name || 'mon-projet') + '-wiki')}" data-input="wiz-wikiname">
            </div>
          </div>
        </div>`;

      case 'vm': {
        const totalVmCost = d.vmSizes.reduce((s, vmSz, i) => s + sizePrice(def, vmSz, specFor(d, 'vm:' + i)), 0);
        const vmItems = d.vmSizes.map((vmSz, i) => `
          <div class="dim-vm-item">
            <span class="dim-vm-item__label">VM #${i + 1}</span>
            <div class="dim-vm-item__sizing">
              ${pillGroup(vmSz, `vm:${i}`, 'vm')}
              ${vmSz === 'custom' ? customEditor(`vm:${i}`) : ''}
            </div>
          </div>`).join('');
        return `<div class="dim-card dim-card--vm">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(totalVmCost)}<small>/mois</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-vm-meta">
              <div class="dim-field-row">
                <label>Nombre de VMs</label>
                <input type="number" min="1" max="6" value="${r.vmCount}" data-input="wiz-vmcount" style="width:60px;">
              </div>
              <div class="dim-field-row">
                <label>Hyperviseur</label>
                <select data-input="wiz-hypervisor" class="dim-select">
                  ${Object.entries(HYPERVISORS).map(([k, h]) => `<option value="${k}" ${d.hypervisor === k ? 'selected' : ''}>${h.icon} ${h.label}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="dim-vm-list">${vmItems}</div>
          </div>
        </div>`;
      }

      default: {
        const isCustom = sz === 'custom';
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(sizePrice(def, sz, specFor(d, key)))}<small>/mois</small></span>
          </div>
          <div class="dim-card__body">
            ${pillGroup(sz, key, key)}
            ${isCustom ? customEditor(key) : ''}
          </div>
        </div>`;
      }
    }
  };

  return `
    <div class="dim-layout">
      <div class="dim-main">
        <div class="dim-grid">${selected.map(resCard).join('')}</div>
      </div>
      <aside class="dim-cost-aside">
        <div class="cost-box">
          <span class="muted">Estimation mensuelle</span>
          <div class="cost-box__total">${euro(cost.total)} <small>/ mois HT</small></div>
          <div class="dim-cost-annual">${euro(cost.total * 12)} <small>/ an HT</small></div>
          <ul class="cost-box__lines">
            ${cost.lines.map(l => `<li><span>${esc(l[0])}</span><span>${euro(Math.round(l[1]))}</span></li>`).join('')
              || '<li><span class="muted">Aucune ressource sélectionnée</span></li>'}
          </ul>
          <div class="dim-cost-note">Tarifs simulés · soumis à validation par l\u2019équipe plateforme.</div>
        </div>
      </aside>
    </div>`;
}


/* Vérifie si des tailles per-ressource diffèrent du gabarit global */
function isCustomSized(d) {
  const rs = d.resourceSizes ?? {};
  if (Object.values(rs).some(sz => sz !== d.size)) return true;
  if ((d.vmSizes ?? []).some(sz => sz !== d.size)) return true;
  return false;
}

/* Taille effectivement appliquée aux ressources dimensionnées :
   - une clé de taille (S/M/L/XL) si toutes partagent la même,
   - null si les tailles sont hétérogènes (personnalisation),
   - le gabarit global si aucune ressource dimensionnée n'est sélectionnée. */
const SIZED_KEYS = ['vm', 'postgres', 'mariadb', 'mongo', 'redis', 'rabbitmq'];
function effectiveSizeOf(d) {
  const rs = d.resourceSizes ?? {};
  const applied = SIZED_KEYS.filter(k => d.resources[k])
    .flatMap(k => k === 'vm' ? (d.vmSizes ?? []) : [rs[k] ?? d.size]);
  if (!applied.length) return d.size;
  return applied.every(s => s === applied[0]) ? applied[0] : null;
}

/* Étape 5 : résumé avant envoi */
function wizStep5() {
  const d = ui.wizard.data;
  const cost = computeCost(d);
  return `
    <div class="banner banner--info">📋 <span>Vérifiez le récapitulatif : la demande sera transmise à l’équipe plateforme pour validation.</span></div>
    <div class="kv-grid" style="margin-bottom:18px;">
      <div><span class="label">Nom du projet</span><span class="value mono">${esc(d.name)}</span></div>
      <div><span class="label">Équipe</span><span class="value">${esc(d.team)}</span></div>
      <div><span class="label">Environnement</span><span class="value">${ENVIRONMENTS[d.env].icon} ${ENVIRONMENTS[d.env].label}</span></div>
      <div><span class="label">Réseau</span><span class="value">${NETWORKS[d.network].flag} ${NETWORKS[d.network].label}</span></div>
      ${d.resources.vm ? `<div><span class="label">Hyperviseur</span><span class="value">${d.hypervisor === 'auto' ? 'Indifférent' : `${HYPERVISORS[d.hypervisor].icon} ${HYPERVISORS[d.hypervisor].label}`}</span></div>` : ''}
      <div><span class="label">Gabarit</span><span class="value">${effectiveSizeOf(d)
        ? `${SIZES[effectiveSizeOf(d)].label}${isCustomSized(d) ? ' <span class="chip chip--info">personnalisé</span>' : ''}`
        : '<span class="chip chip--info">Tailles personnalisées</span>'}</span></div>
      <div class="kv--full"><span class="label">Description</span><span class="value">${esc(d.description) || '—'}</span></div>
      <div class="kv--full"><span class="label">Ressources</span>
        <span class="value">${resourceSummary(d).map(x => `<span class="chip">${esc(x)}</span>`).join('') || '—'}</span></div>
    </div>
    <div class="cost-box">
      <span class="muted">Coût mensuel estimé</span>
      <div class="cost-box__total">${euro(cost.total)} <small>/ mois (HT, simulé)</small></div>
    </div>`;
}

/* Étape 6 : confirmation d'envoi */
function wizStep6() {
  const id = ui.wizard.sentRequestId;
  return `
    <div class="empty-state">
      <div class="empty-state__icon">✅</div>
      <div class="empty-state__title">Demande ${esc(id)} envoyée</div>
      <p>Votre demande est <strong>en attente de validation</strong> par l’équipe plateforme.
         Elle apparaît dès maintenant dans la file de validation de l’interface administrateur (volet de droite).</p>
      <div style="margin-top:18px; display:flex; gap:10px; justify-content:center;">
        <button class="btn btn--primary" data-action="open-request" data-arg="${esc(id)}">Suivre ma demande</button>
        <button class="btn btn--text" data-action="goto-catalog">Retour au catalogue</button>
      </div>
    </div>`;
}

/* Validation de l'étape courante ; renvoie un message d'erreur ou '' */
function validateWizardStep() {
  const w = ui.wizard, d = w.data;
  if (w.step === 0) {
    if (!d.name.trim()) return 'Le nom du projet est obligatoire.';
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(d.name.trim()))
      return 'Nom invalide : minuscules, chiffres et tirets uniquement (3 à 40 caractères).';
    if (state.entities.some(e => e.name === d.name.trim()) || state.requests.some(r => r.name === d.name.trim() && r.status !== 'rejected'))
      return `Le nom « ${d.name.trim()} » est déjà utilisé dans le catalogue.`;
  }
  if (w.step === 2) {
    const r = d.resources;
    if (!r.rancher && !r.harbor && !r.vm && !r.postgres && !r.mariadb && !r.mongo && !r.redis && !r.rabbitmq && !r.serverless && !r.wiki)
      return 'Sélectionnez au moins une ressource.';
  }
  return '';
}

/* Création de la demande à partir de l'assistant */
function submitWizard() {
  const d = ui.wizard.data;
  const id = `REQ-${state.nextRequestNum++}`;
  const req = {
    id, name: d.name.trim(), team: d.team, requester: 'Marie Lambert',
    description: d.description.trim(),
    env: d.env, size: d.size,
    network: d.network, hypervisor: d.hypervisor,
    customSpecs: JSON.parse(JSON.stringify(d.customSpecs || {})),
    resourceSizes: { ...d.resourceSizes },
    vmSizes: [...d.vmSizes],
    resources: { ...d.resources },
    status: 'pending', createdAt: now(),
    comment: '', prov: null,
    history: [{ ts: now(), label: 'Demande envoyée par Marie Lambert' }],
  };
  state.requests.unshift(req);
  logActivity('📨', `Marie Lambert a soumis la demande ${id} (${req.name}).`);
  saveState();

  ui.wizard.sentRequestId = id;
  ui.wizard.step = 5;
  renderUser();
  renderAdmin();
  renderBadges();
  toast('user', `Demande <strong>${id}</strong> envoyée pour validation`, 'success');
  toast('admin', `🔔 Nouvelle demande <strong>${id}</strong> à valider`, 'info');
}

/* ---- 5.5 Mes demandes ---- */
function userRequestsPage() {
  const mine = state.requests.slice().sort((a, b) => b.createdAt - a.createdAt);
  return `
    ${pageHeader('user', {
      title: 'Mes demandes',
      subtitle: 'Suivi des demandes de ressources soumises à l’équipe plateforme',
      meta: [['Demandes', String(mine.length)]],
    })}
    <div class="content">
      <div class="card">
        <div class="table-wrap">
          ${mine.length ? `
          <table class="bs-table">
            <thead><tr>
              <th>Réf.</th><th>Projet</th><th>Environnement</th><th>Ressources</th>
              <th>Coût estimé</th><th>Statut</th><th>Créée</th>
            </tr></thead>
            <tbody>
              ${mine.map(r => `
                <tr class="is-clickable" data-action="open-request" data-arg="${esc(r.id)}">
                  <td class="mono">${esc(r.id)}</td>
                  <td><span class="cell-name">${esc(r.name)}</span></td>
                  <td class="cell-secondary">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</td>
                  <td class="cell-secondary">${resourceSummary(r).join(' · ')}</td>
                  <td>${r.requestType === 'harbor-pull' || r.requestType === 'diode-push' ? '<span class="muted">—</span>' : euro(computeCost(r).total) + '<span class="muted">/mois</span>'}</td>
                  <td>${statusChip(r.status)}</td>
                  <td class="cell-secondary">${timeAgo(r.createdAt)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : emptyState('📭', 'Aucune demande', 'Créez votre première demande depuis la page « Créer… ».')}
        </div>
      </div>
    </div>`;
}

/* ---- 5.6 Détail d'une demande (côté utilisateur) ---- */
function userRequestDetailPage() {
  const r = state.requests.find(x => x.id === ui.user.request);
  if (!r) { ui.user.page = 'requests'; return userRequestsPage(); }
  const cost = computeCost(r);
  const createdEntities = state.entities.filter(e => e.fromRequest === r.id);

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'Mes demandes', action: 'goto-requests' }, { label: r.id }],
      title: `${r.id} — ${r.name}`,
      subtitle: `Demandée par ${esc(r.requester)} · ${esc(r.team)}`,
      meta: [['Statut', statusChip(r.status)], ['Coût estimé', euro(cost.total) + '/mois']],
    })}
    <div class="content">
      ${r.status === 'rejected' ? `
        <div class="banner banner--error">⛔ <span><strong>Demande refusée.</strong> ${esc(r.comment)}</span></div>` : ''}
      ${r.status === 'available' ? `
        <div class="banner banner--success">🎉 <span><strong>Ressources disponibles !</strong> Les entités créées sont visibles dans le catalogue.</span></div>` : ''}
      ${r.status === 'pending' ? `
        <div class="banner banner--info">⏳ <span>Demande en cours d’examen par l’équipe plateforme.</span></div>` : ''}
      ${r.status === 'provisioning' ? `
        <div class="banner banner--info">⚙️ <span>Provisionnement en cours… suivez l’avancement dans le volet administrateur.</span></div>` : ''}

      <div class="card">
        <div class="card__header"><span class="card__title">Récapitulatif</span></div>
        <div class="card__body">
          <div class="kv-grid">
            ${r.requestType === 'harbor-pull' || r.requestType === 'diode-push' ? `
            <div><span class="label">Type</span><span class="value">${r.requestType === 'harbor-pull' ? '⚓ Pull image Harbor' : '🔒 Push vers réseau sous diode'}</span></div>
            <div><span class="label">Image</span><span class="value mono">harbor.internal/${esc(r.harborProject || '?')}/${esc(r.imageName || '?')}:${esc(r.imageTag || 'latest')}</span></div>
            ${r.requestType === 'harbor-pull' ? `
            <div><span class="label">Cluster cible</span><span class="value">${esc(r.targetCluster || '—')}</span></div>
            <div><span class="label">Namespace</span><span class="value">${esc(r.targetNamespace) || 'default'}</span></div>` : `
            <div><span class="label">Zone diode</span><span class="value">${(DIODE_NETWORKS[r.diodeNetwork] || {}).icon || ''} ${esc((DIODE_NETWORKS[r.diodeNetwork] || {}).label || r.diodeNetwork || '—')}</span></div>
            <div><span class="label">Système cible</span><span class="value">${esc(r.targetSystem || '—')}</span></div>
            <div><span class="label">Classification</span><span class="value">${(SECURITY_LEVELS[r.securityLevel] || {}).icon || ''} ${esc((SECURITY_LEVELS[r.securityLevel] || {}).label || r.securityLevel || '—')}</span></div>`}
            <div class="kv--full"><span class="label">Justification</span><span class="value">${esc(r.description) || '—'}</span></div>` : `
            <div><span class="label">Environnement</span><span class="value">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</span></div>
            <div><span class="label">Réseau</span><span class="value">${NETWORKS[r.network || 'FR'].flag} ${NETWORKS[r.network || 'FR'].label}</span></div>
            ${r.resources.vm ? `<div><span class="label">Hyperviseur</span><span class="value">${(r.hypervisor && r.hypervisor !== 'auto') ? `${HYPERVISORS[r.hypervisor].icon} ${HYPERVISORS[r.hypervisor].label}` : 'Indifférent'}</span></div>` : ''}
            <div><span class="label">Taille</span><span class="value">${SIZES[r.size].label}</span></div>
            <div><span class="label">Coût mensuel estimé</span><span class="value">${euro(cost.total)}</span></div>
            <div class="kv--full"><span class="label">Description</span><span class="value">${esc(r.description) || '—'}</span></div>
            <div class="kv--full"><span class="label">Ressources demandées</span>
              <span class="value">${resourceSummary(r).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</span></div>`}
            ${r.comment && r.status !== 'rejected' ? `
              <div class="kv--full"><span class="label">Commentaire de l'équipe plateforme</span>
                <span class="value">💬 ${esc(r.comment)}</span></div>` : ''}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__header"><span class="card__title">Historique</span></div>
        <div class="card__body">
          <ul class="timeline">
            ${r.history.map(h => `<li>${esc(h.label)}<span class="time">${fmtDate(h.ts)}</span></li>`).join('')}
          </ul>
        </div>
      </div>

      ${createdEntities.length ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Ressources créées</span>
          <span class="muted">${createdEntities.length} entité(s) au catalogue</span></div>
        <div class="card__body--flush table-wrap">
          <table class="bs-table">
            <thead><tr><th>Nom</th><th>Type</th><th>Statut</th></tr></thead>
            <tbody>
              ${createdEntities.map(e => `
                <tr class="is-clickable" data-action="open-entity" data-arg="${esc(e.name)}">
                  <td><span class="cell-name">${esc(e.name)}</span></td>
                  <td class="cell-secondary">${esc(e.type)}</td>
                  <td><span class="status status--available">Opérationnel</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
}

/* ============================================================
   6. Vue administrateur
   ============================================================ */

function renderAdmin() {
  const main = $('#admin-main');
  const pages = {
    inbox: adminInboxPage,
    request: adminRequestPage,
    activity: adminActivityPage,
  };
  main.innerHTML = (pages[ui.admin.page] || adminInboxPage)();
  syncSidebar('admin');

  // Le journal d'exécution défile automatiquement vers le bas
  const consoleEl = $('#prov-console');
  if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
}

/* ---- 6.1 File de validation ---- */
function adminInboxPage() {
  const filters = [
    ['all', 'Toutes'], ['pending', 'En attente'], ['provisioning', 'En cours'],
    ['available', 'Disponibles'], ['rejected', 'Refusées'],
  ];
  const f = ui.admin.filter;
  let list = state.requests.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (f !== 'all') list = list.filter(r => f === 'provisioning' ? (r.status === 'provisioning' || r.status === 'approved') : r.status === f);
  const pending = state.requests.filter(r => r.status === 'pending').length;

  return `
    ${pageHeader('admin', {
      title: 'Validations',
      subtitle: 'Plugin de gouvernance · demandes de ressources d’infrastructure',
      meta: [['En attente', String(pending)], ['Total', String(state.requests.length)]],
    })}
    <div class="tabs">
      ${filters.map(([k, lbl]) => `
        <button class="tab ${f === k ? 'is-active' : ''}" data-action="admin-filter" data-arg="${k}">${lbl}</button>`).join('')}
    </div>
    <div class="content">
      ${pending ? `<div class="banner banner--warning">🔔 <span><strong>${pending} demande${pending > 1 ? 's' : ''}</strong> en attente de votre validation.</span></div>` : ''}
      <div class="card">
        <div class="table-wrap">
          ${list.length ? `
          <table class="bs-table">
            <thead><tr>
              <th>Réf.</th><th>Projet</th><th>Demandeur</th><th>Env.</th>
              <th>Coût/mois</th><th>Statut</th><th>Créée</th>
            </tr></thead>
            <tbody>
              ${list.map(r => `
                <tr class="is-clickable" data-action="admin-open" data-arg="${esc(r.id)}">
                  <td class="mono">${esc(r.id)}</td>
                  <td><span class="cell-name">${esc(r.name)}</span></td>
                  <td class="cell-secondary">${esc(r.requester)}<br><span class="muted">${esc(r.team)}</span></td>
                  <td class="cell-secondary">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</td>
                  <td>${r.requestType === 'harbor-pull' || r.requestType === 'diode-push' ? '<span class="muted">—</span>' : euro(computeCost(r).total)}</td>
                  <td>${statusChip(r.status)}</td>
                  <td class="cell-secondary">${timeAgo(r.createdAt)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : emptyState('🗂️', 'Aucune demande', 'Aucune demande ne correspond à ce filtre pour le moment.')}
        </div>
      </div>
    </div>`;
}

/* ---- 6.2 Détail d'une demande + provisionnement ---- */
function adminRequestPage() {
  const r = state.requests.find(x => x.id === ui.admin.request);
  if (!r) { ui.admin.page = 'inbox'; return adminInboxPage(); }
  if (r.requestType === 'harbor-pull' || r.requestType === 'diode-push') return adminImageRequestPage(r);
  const cost = computeCost(r);
  const canDecide = r.status === 'pending';

  /* Lignes du tableau des ressources demandées */
  const res = r.resources;
  const rs = r.resourceSizes ?? {};
  const globalSz = r.size ?? 'S';
  const getSize = key => rs[key] ?? globalSz;
  const resRows = [];
  if (res.rancher) resRows.push(['🐮 Projet Rancher (K8s)', esc(res.rancherName || '—'), euro(RESOURCE_DEFS.rancher.base)]);
  if (res.harbor) {
    const gb = res.registryGb ?? 10;
    resRows.push(['⚓ Registry Harbor', `${gb} Go`, euro(gb)]);
  }
  if (res.vm) {
    const def = RESOURCE_DEFS.vm;
    const vmSizes = r.vmSizes ?? Array(res.vmCount).fill(getSize('vm'));
    vmSizes.forEach((sz, i) => {
      const plan = sizePlan(def, sz);
      resRows.push([`🖥️ VM ${plan}${vmSizes.length > 1 ? ` #${i + 1}` : ''}`, '1', euro(sizePrice(def, sz, specFor(r, 'vm:' + i)))]);
    });
  }
  if (res.postgres) {
    const def = RESOURCE_DEFS.postgres; const sz = getSize('postgres');
    resRows.push([`🐘 PostgreSQL — ${sizePlan(def, sz)}`, '1', euro(sizePrice(def, sz, specFor(r, 'postgres')))]);
  }
  if (res.mariadb) {
    const def = RESOURCE_DEFS.mariadb; const sz = getSize('mariadb');
    resRows.push([`🗃️ MariaDB — ${sizePlan(def, sz)}`, '1', euro(sizePrice(def, sz, specFor(r, 'mariadb')))]);
  }
  if (res.mongo) {
    const def = RESOURCE_DEFS.mongo; const sz = getSize('mongo');
    resRows.push([`🍃 MongoDB — ${sizePlan(def, sz)}`, '1', euro(sizePrice(def, sz, specFor(r, 'mongo')))]);
  }
  if (res.redis) {
    const def = RESOURCE_DEFS.redis; const sz = getSize('redis');
    resRows.push([`🔴 Redis — ${sizePlan(def, sz)}`, '1', euro(sizePrice(def, sz, specFor(r, 'redis')))]);
  }
  if (res.rabbitmq) {
    const def = RESOURCE_DEFS.rabbitmq; const sz = getSize('rabbitmq');
    resRows.push([`🐰 RabbitMQ — ${sizePlan(def, sz)}`, '1', euro(sizePrice(def, sz, specFor(r, 'rabbitmq')))]);
  }
  if (res.serverless) resRows.push(['⚡ Serverless Containers', esc(res.serverlessImage || '1 service'), euro(RESOURCE_DEFS.serverless.base)]);
  if (res.wiki)       resRows.push(['📖 Wiki as a Service', esc(res.wikiName || '—'), euro(RESOURCE_DEFS.wiki.base)]);

  return `
    ${pageHeader('admin', {
      crumbs: [{ label: 'Validations', action: 'admin-goto-inbox' }, { label: r.id }],
      title: `${r.id} — ${r.name}`,
      subtitle: `Soumise par ${esc(r.requester)} (${esc(r.team)}) · ${timeAgo(r.createdAt)}`,
      meta: [['Statut', statusChip(r.status)]],
    })}
    <div class="content">

      <div class="card">
        <div class="card__header"><span class="card__title">Détail de la demande</span></div>
        <div class="card__body">
          <div class="kv-grid">
            <div><span class="label">Projet</span><span class="value mono">${esc(r.name)}</span></div>
            <div><span class="label">Environnement</span><span class="value">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</span></div>
            <div><span class="label">Réseau</span><span class="value">${NETWORKS[r.network || 'FR'].flag} ${NETWORKS[r.network || 'FR'].label}</span></div>
            ${r.resources.vm ? `<div><span class="label">Hyperviseur</span><span class="value">${(r.hypervisor && r.hypervisor !== 'auto') ? `${HYPERVISORS[r.hypervisor].icon} ${HYPERVISORS[r.hypervisor].label}` : 'Indifférent'}</span></div>` : ''}
            <div><span class="label">Gabarit</span><span class="value">${SIZES[r.size].label}${isCustomSized(r) ? ' <span class="chip chip--info">personnalisé</span>' : ''}</span></div>
            <div><span class="label">Demandeur</span><span class="value">${esc(r.requester)}</span></div>
            <div class="kv--full"><span class="label">Description</span><span class="value">${esc(r.description) || '—'}</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__header"><span class="card__title">Ressources demandées</span>
          <span class="muted">estimation : <strong>${euro(cost.total)}/mois</strong></span></div>
        <div class="card__body--flush table-wrap">
          <table class="bs-table">
            <thead><tr><th>Ressource</th><th>Quantité</th><th>Coût mensuel</th></tr></thead>
            <tbody>
              ${resRows.map(row => `<tr><td>${row[0]}</td><td class="cell-secondary">${row[1]}</td><td>${row[2]}</td></tr>`).join('')}
              <tr><td style="font-weight:700;">Total estimé</td><td></td><td style="font-weight:700;color:var(--bs-primary);">${euro(cost.total)}/mois</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      ${feasShouldShow(r) ? feasibilityCard(r) : ''}

      ${canDecide ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Décision</span></div>
        <div class="card__body">
          ${r.env === 'prod' ? '<div class="banner banner--warning">⚠️ <span>Demande en <strong>production</strong> : vérifiez le dimensionnement avant validation.</span></div>' : ''}
          ${feasShouldShow(r) && !assessFeasibility(r).feasible ? '<div class="banner banner--error">⛔ <span><strong>Capacité insuffisante</strong> sur la cible demandée (voir ci-dessus). Vous pouvez approuver malgré tout (dérogation) ou refuser en demandant un redimensionnement.</span></div>' : ''}
          <div class="form-row">
            <label class="field-label">Commentaire (visible par le demandeur)</label>
            <textarea rows="2" id="admin-comment" placeholder="ex. Validé — pensez à activer les sauvegardes."></textarea>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button class="btn btn--danger" data-action="admin-reject" data-arg="${esc(r.id)}">Refuser</button>
            <button class="btn btn--success" data-action="admin-approve" data-arg="${esc(r.id)}">✓ Approuver et provisionner</button>
          </div>
        </div>
      </div>` : ''}

      ${r.comment && !canDecide ? `
        <div class="banner ${r.status === 'rejected' ? 'banner--error' : 'banner--info'}">💬 <span><strong>Commentaire :</strong> ${esc(r.comment)}</span></div>` : ''}

      ${r.prov ? adminProvisioningCard(r) : ''}

      <div class="card">
        <div class="card__header"><span class="card__title">Historique de la demande</span></div>
        <div class="card__body">
          <ul class="timeline">
            ${r.history.map(h => `<li>${esc(h.label)}<span class="time">${fmtDate(h.ts)}</span></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>`;
}

/* ---- Détail d'une demande image (harbor-pull / diode-push) ---- */
function adminImageRequestPage(r) {
  const canDecide = r.status === 'pending';
  const isPull = r.requestType === 'harbor-pull';
  const net = isPull ? null : (DIODE_NETWORKS[r.diodeNetwork] || {});
  const lvl = isPull ? null : (SECURITY_LEVELS[r.securityLevel] || {});
  const typeLabel = isPull ? '⚓ Pull image Harbor' : '🔒 Push vers réseau sous diode';

  return `
    ${pageHeader('admin', {
      crumbs: [{ label: 'Validations', action: 'admin-goto-inbox' }, { label: r.id }],
      title: `${r.id} — ${typeLabel}`,
      subtitle: `Soumise par ${esc(r.requester)} (${esc(r.team)}) · ${timeAgo(r.createdAt)}`,
      meta: [['Statut', statusChip(r.status)]],
    })}
    <div class="content">

      <div class="card">
        <div class="card__header"><span class="card__title">Détail de la demande</span></div>
        <div class="card__body">
          <div class="kv-grid">
            <div><span class="label">Type</span><span class="value">${typeLabel}</span></div>
            <div><span class="label">Équipe</span><span class="value">${esc(r.team)}</span></div>
            <div><span class="label">Demandeur</span><span class="value">${esc(r.requester)}</span></div>
            <div><span class="label">Image</span><span class="value mono">harbor.internal/${esc(r.harborProject || '?')}/${esc(r.imageName || '?')}:${esc(r.imageTag || 'latest')}</span></div>
            ${isPull ? `
            <div><span class="label">Cluster cible</span><span class="value">${esc(r.targetCluster || '—')}</span></div>
            <div><span class="label">Namespace</span><span class="value">${esc(r.targetNamespace) || 'default'}</span></div>` : `
            <div><span class="label">Zone diode</span><span class="value">${net.icon || ''} ${esc(net.label || r.diodeNetwork || '—')}</span></div>
            <div><span class="label">Système cible</span><span class="value">${esc(r.targetSystem || '—')}</span></div>
            <div><span class="label">Chemin</span><span class="value mono">${esc(r.targetPath || '/images')}</span></div>
            <div><span class="label">Classification</span><span class="value" style="color:${lvl.color || 'inherit'}">${lvl.icon || ''} ${esc(lvl.label || r.securityLevel || '—')}</span></div>`}
            <div class="kv--full"><span class="label">Justification</span><span class="value">${esc(r.description) || '—'}</span></div>
          </div>
        </div>
      </div>

      ${!isPull ? `
      <div class="banner banner--warning">⚡ <span>Transfert via <strong>diode unidirectionnelle</strong> : validez la classification et l\'habilitation avant d'approuver.</span></div>` : ''}

      ${canDecide ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Décision</span></div>
        <div class="card__body">
          <div class="form-row">
            <label class="field-label">Commentaire (visible par le demandeur)</label>
            <textarea rows="2" id="admin-comment" placeholder="ex. Approuvé — scan Trivy validé."></textarea>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button class="btn btn--danger" data-action="admin-reject" data-arg="${esc(r.id)}">Refuser</button>
            <button class="btn btn--success" data-action="admin-approve" data-arg="${esc(r.id)}">✓ Approuver et lancer le pipeline</button>
          </div>
        </div>
      </div>` : ''}

      ${r.comment && !canDecide ? `
        <div class="banner ${r.status === 'rejected' ? 'banner--error' : 'banner--info'}">💬 <span><strong>Commentaire :</strong> ${esc(r.comment)}</span></div>` : ''}

      ${r.prov ? adminProvisioningCard(r) : ''}

      <div class="card">
        <div class="card__header"><span class="card__title">Historique de la demande</span></div>
        <div class="card__body">
          <ul class="timeline">
            ${r.history.map(h => `<li>${esc(h.label)}<span class="time">${fmtDate(h.ts)}</span></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>`;
}

/* Carte « provisionnement » : stepper vertical + progression + console */
function adminProvisioningCard(r) {
  const p = r.prov;
  const total = p.steps.length;
  const doneCount = p.steps.filter(s => s === 'done' || s === 'skipped').length;
  const pct = Math.round((doneCount / total) * 100);
  const finished = r.status === 'available';

  return `
    <div class="card">
      <div class="card__header">
        <div>
          <span class="card__title">Provisionnement automatisé</span>
          <div class="card__subtitle">Pipeline simulé — aucun appel réel aux systèmes</div>
        </div>
        ${finished ? '<span class="status status--available">Terminé</span>' : '<span class="status status--running">En cours</span>'}
      </div>
      <div class="card__body">
        <div class="muted" style="display:flex;justify-content:space-between;">
          <span>Avancement global</span><span>${pct} %</span>
        </div>
        <div class="progress"><div class="progress__bar ${finished ? 'progress__bar--done' : ''}" style="width:${pct}%"></div></div>

        <ul class="vstepper" style="margin-top:18px;">
          ${getProvSteps(r).map((step, i) => {
            const st = p.steps[i];
            const cls = st === 'done' ? 'is-done' : st === 'active' ? 'is-active' : st === 'skipped' ? 'is-skipped' : '';
            const icon = st === 'done' ? '✓' : st === 'skipped' ? '–' : String(i + 1);
            const detail = st === 'skipped' ? 'Ignorée — ressource non demandée'
              : st === 'active' ? 'En cours d’exécution…'
              : st === 'done' ? 'Terminée' : 'En attente';
            return `
              <li class="vstepper__item ${cls}">
                <div class="vstepper__icon">${icon}</div>
                <div>
                  <div class="vstepper__title">${step.title}</div>
                  <div class="vstepper__detail">${detail}</div>
                </div>
              </li>`;
          }).join('')}
        </ul>

        <div class="muted" style="margin:4px 0 6px;">Journal d'exécution</div>
        <div class="console" id="prov-console">
          ${p.log.map(l => `<div><span class="ts">${l.ts}</span><span class="${l.cls}">${esc(l.text)}</span></div>`).join('')}
          ${!finished ? '<div><span class="ts">··</span><span class="info">▍</span></div>' : ''}
        </div>
      </div>
    </div>`;
}

/* ---- 6.3 Journal d'activité ---- */
function adminActivityPage() {
  return `
    ${pageHeader('admin', {
      title: 'Journal d’activité',
      subtitle: 'Trace auditable des actions de gouvernance et de provisionnement',
      meta: [['Événements', String(state.activity.length)]],
    })}
    <div class="content">
      <div class="card">
        ${state.activity.length ? state.activity.map(a => `
          <div class="activity-row">
            <div class="activity-row__icon">${a.icon}</div>
            <div>${esc(a.text)}</div>
            <div class="activity-row__time">${fmtDate(a.ts)} · ${timeAgo(a.ts)}</div>
          </div>`).join('')
        : emptyState('🗒️', 'Journal vide', 'Les actions de validation et de provisionnement apparaîtront ici.')}
      </div>
    </div>`;
}

/* ============================================================
   7. Simulation du provisionnement
   ============================================================ */

function approveRequest(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || r.status !== 'pending') return;
  const comment = ($('#admin-comment')?.value || '').trim();
  r.status = 'approved';
  r.comment = comment;
  r.history.push({ ts: now(), label: 'Approuvée par Antoine Durand' + (comment ? ` — « ${comment} »` : '') });
  logActivity('✅', `Antoine Durand a approuvé la demande ${id} (${r.name}).`);
  saveState();
  renderAdmin(); renderBadges();
  toast('admin', `Demande <strong>${id}</strong> approuvée — lancement du provisionnement`, 'success');
  notifyUser(r, `✅ Votre demande <strong>${id}</strong> a été approuvée`, 'success');

  // Petit délai avant le démarrage du pipeline, pour le rythme de la démo
  setTimeout(() => startProvisioning(id), 1200);
}

function rejectRequest(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || r.status !== 'pending') return;
  const comment = ($('#admin-comment')?.value || '').trim();
  r.status = 'rejected';
  r.comment = comment || 'Demande refusée par l’équipe plateforme.';
  r.history.push({ ts: now(), label: 'Refusée par Antoine Durand' + (comment ? ` — « ${comment} »` : '') });
  logActivity('⛔', `Antoine Durand a refusé la demande ${id} (${r.name}).`);
  saveState();
  renderAdmin(); renderBadges();
  toast('admin', `Demande <strong>${id}</strong> refusée`, 'error');
  notifyUser(r, `⛔ Votre demande <strong>${id}</strong> a été refusée`, 'error');
}

function startProvisioning(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || (r.status !== 'approved' && r.status !== 'provisioning')) return;
  r.status = 'provisioning';
  if (!r.prov) {
    r.prov = { steps: getProvSteps(r).map(() => 'pending'), log: [] };
    provLog(r, 'info', `Pipeline de provisionnement démarré pour « ${r.name} » (${ENVIRONMENTS[r.env].label})`);
    r.history.push({ ts: now(), label: 'Provisionnement démarré' });
  }
  saveState();
  renderAdmin(); renderBadges();
  notifyUser(r, `⚙️ Provisionnement de <strong>${esc(r.name)}</strong> en cours`, 'info');
  advanceProvisioning(id);
}

/* Exécute la prochaine étape non traitée, puis se replanifie */
function advanceProvisioning(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || r.status !== 'provisioning') return;
  const idx = r.prov.steps.findIndex(s => s === 'pending' || s === 'active');
  if (idx === -1) { finishProvisioning(r); return; }

  const step = getProvSteps(r)[idx];

  // Étape non concernée par la demande : marquée « ignorée », on enchaîne
  if (!step.needs(r)) {
    r.prov.steps[idx] = 'skipped';
    provLog(r, '', `· ${step.title} — ignorée (ressource non demandée)`);
    saveState(); renderAdmin();
    setTimeout(() => advanceProvisioning(id), 450);
    return;
  }

  // Étape active : on déroule ses lignes de journal puis on la clôt
  r.prov.steps[idx] = 'active';
  provLog(r, 'info', `▶ ${step.title}…`);
  saveState(); renderAdmin();

  const lines = step.logs(r);
  lines.forEach((l, i) => {
    setTimeout(() => {
      const cur = state.requests.find(x => x.id === id);
      if (!cur || cur.status !== 'provisioning') return;
      provLog(cur, l[0], '  ' + l[1]);
      saveState(); renderAdmin();
    }, 550 * (i + 1));
  });

  setTimeout(() => {
    const cur = state.requests.find(x => x.id === id);
    if (!cur || cur.status !== 'provisioning') return;
    cur.prov.steps[idx] = 'done';
    saveState(); renderAdmin();
    setTimeout(() => advanceProvisioning(id), 350);
  }, 550 * (lines.length + 1));
}

function finishProvisioning(r) {
  r.status = 'available';
  r.history.push({ ts: now(), label: 'Provisionnement terminé — ressources disponibles' });
  const created = createEntitiesFromRequest(r);
  logActivity('🚀', `Provisionnement de ${r.name} terminé : ${created} ressource(s) créée(s) au catalogue.`);
  provLog(r, 'ok', `✔ Provisionnement terminé — ${created} entité(s) publiée(s) au catalogue`);
  saveState();
  renderAdmin(); renderBadges();
  toast('admin', `🚀 Provisionnement de <strong>${esc(r.name)}</strong> terminé`, 'success');
  notifyUser(r, `🎉 <strong>${esc(r.name)}</strong> est disponible — ressources visibles au catalogue`, 'success');
  // On rafraîchit le volet utilisateur pour faire apparaître les entités
  refreshUserSafely();
}

/* Publie les entités correspondant aux ressources de la demande */
function createEntitiesFromRequest(r) {
  if (r.requestType === 'harbor-pull' || r.requestType === 'diode-push') return 0;
  const env = ENVIRONMENTS[r.env].lifecycle;
  const base = {
    owner: r.team, lifecycle: env, system: r.name,
    createdAt: now(), fromRequest: r.id,
  };
  const add = e => state.entities.unshift({ ...base, ...e });
  let count = 0;

  add({ name: r.name, kind: 'Component', type: 'service',
        tags: [ENVIRONMENTS[r.env].label.toLowerCase(), 'taille-' + r.size.toLowerCase()],
        description: r.description || `Projet provisionné via la demande ${r.id}.` }); count++;
  if (r.resources.rancher) { add({ name: `${r.name}-rancher`, kind: 'Resource', type: 'rancher-project', tags: ['kubernetes'],
        description: `Projet Rancher « ${r.resources.rancherName || r.name} » (namespaces et quotas) du projet ${r.name}.` }); count++; }
  if (r.resources.harbor) { add({ name: `${r.name}-registry`, kind: 'Resource', type: 'harbor-project', tags: ['harbor', 'docker'],
        description: `Registre d\'images Harbor du projet ${r.name} (${r.resources.registryGb ?? 10} Go).` }); count++; }
  if (r.resources.vm) { add({ name: `${r.name}-vms`, kind: 'Resource', type: 'virtual-machine',
        tags: [`x${r.resources.vmCount}`, r.size.toLowerCase(), (r.network || 'fr').toLowerCase(), ...((r.hypervisor && r.hypervisor !== 'auto') ? [r.hypervisor] : [])],
        description: `${r.resources.vmCount} machine(s) virtuelle(s) plan ${sizePlan(RESOURCE_DEFS.vm, r.size)}${(r.hypervisor && r.hypervisor !== 'auto') ? ` sur ${HYPERVISORS[r.hypervisor].label}` : ''} · région ${NETWORKS[r.network || 'FR'].label}.` }); count++; }
  if (r.resources.postgres) { add({ name: `${r.name}-postgresql`, kind: 'Resource', type: 'database', tags: ['postgresql', sizePlan(RESOURCE_DEFS.postgres, r.size).toLowerCase()],
        description: `Base PostgreSQL managée du projet ${r.name}.` }); count++; }
  if (r.resources.mariadb) { add({ name: `${r.name}-mariadb`, kind: 'Resource', type: 'database', tags: ['mariadb', sizePlan(RESOURCE_DEFS.mariadb, r.size).toLowerCase()],
        description: `Base MariaDB managée du projet ${r.name}.` }); count++; }
  if (r.resources.mongo) { add({ name: `${r.name}-mongodb`, kind: 'Resource', type: 'database', tags: ['mongodb', sizePlan(RESOURCE_DEFS.mongo, r.size).toLowerCase()],
        description: `Base MongoDB managée du projet ${r.name}.` }); count++; }
  if (r.resources.redis) { add({ name: `${r.name}-redis`, kind: 'Resource', type: 'cache', tags: ['redis', sizePlan(RESOURCE_DEFS.redis, r.size).toLowerCase()],
        description: `Cache Redis managé du projet ${r.name}.` }); count++; }
  if (r.resources.rabbitmq) { add({ name: `${r.name}-rabbitmq`, kind: 'Resource', type: 'message-broker', tags: ['rabbitmq', sizePlan(RESOURCE_DEFS.rabbitmq, r.size).toLowerCase()],
        description: `Broker RabbitMQ managé du projet ${r.name}.` }); count++; }
  if (r.resources.serverless) { add({ name: `${r.name}-serverless`, kind: 'Resource', type: 'serverless', tags: ['serverless', 'containers'],
        description: `Namespace serverless Containers du projet ${r.name}${r.resources.serverlessImage ? ` (image ${r.resources.serverlessImage})` : ''}.` }); count++; }
  if (r.resources.wiki) { add({ name: `${r.name}-wiki`, kind: 'Resource', type: 'wiki', tags: ['wiki'],
        description: `Wiki as a Service « ${r.resources.wikiName || r.name + '-wiki'} » du projet ${r.name}.` }); count++; }
  return count;
}

function provLog(r, cls, text) {
  r.prov.log.push({ ts: clock(), cls, text });
}

/* Notifie le volet utilisateur et rafraîchit ses pages « passives ».
   On ne re-rend jamais l'assistant en cours de saisie. */
function notifyUser(r, message, type) {
  toast('user', message, type);
  refreshUserSafely();
}

function refreshUserSafely() {
  if (ui.user.page !== 'wizard') renderUser();
  renderBadges();
}

/* ============================================================
   8. Gestion des événements
   ============================================================ */

/* Met à jour l'élément actif de la sidebar selon la page courante */
function syncSidebar(pane) {
  const map = pane === 'user'
    ? { catalog: 'catalog', entity: 'catalog', create: 'create', wizard: 'create', requests: 'requests', requestDetail: 'requests' }
    : { inbox: 'inbox', request: 'inbox', activity: 'activity' };
  const active = map[ui[pane].page];
  document.querySelectorAll(`#${pane}-sidebar .sidebar__item`).forEach(el => {
    el.classList.toggle('is-active', el.dataset.nav === active);
  });
}

function renderBadges() {
  const pending = state.requests.filter(r => r.status === 'pending').length;
  const adminBadge = $('#admin-badge-pending');
  adminBadge.hidden = pending === 0;
  adminBadge.textContent = pending;

  const active = state.requests.filter(r => ['pending', 'approved', 'provisioning'].includes(r.status)).length;
  const userBadge = $('#user-badge-requests');
  userBadge.hidden = active === 0;
  userBadge.textContent = active;

  updateSplitMode();
}

/* Plein écran côté utilisateur tant qu'aucune demande n'a été créée */
function updateSplitMode() {
  const split = document.querySelector('.split');
  if (!split) return;
  const userFocus = state.nextRequestNum <= 1042;
  split.classList.toggle('split--user-focus', userFocus);
}

/* --- Navigation des sidebars --- */
$('#user-sidebar').addEventListener('click', e => {
  const item = e.target.closest('[data-nav]');
  if (!item) return;
  const nav = item.dataset.nav;
  if (nav === 'catalog') { ui.user.page = 'catalog'; renderUser(); }
  else if (nav === 'create') { ui.user.page = 'create'; renderUser(); }
  else if (nav === 'requests') { ui.user.page = 'requests'; renderUser(); }
  else toast('user', 'Section non incluse dans la maquette', 'warning');
});

$('#admin-sidebar').addEventListener('click', e => {
  const item = e.target.closest('[data-nav]');
  if (!item) return;
  const nav = item.dataset.nav;
  if (nav === 'inbox') { ui.admin.page = 'inbox'; renderAdmin(); }
  else if (nav === 'activity') { ui.admin.page = 'activity'; renderAdmin(); }
  else toast('admin', 'Section non incluse dans la maquette', 'warning');
});

/* --- Actions du volet utilisateur (délégation) --- */
$('#user-main').addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, arg } = el.dataset;
  const w = ui.wizard;

  switch (action) {
    case 'goto-catalog': ui.user.page = 'catalog'; renderUser(); break;
    case 'goto-create': ui.user.page = 'create'; renderUser(); break;
    case 'goto-requests': ui.user.page = 'requests'; renderUser(); break;
    case 'open-entity': ui.user.page = 'entity'; ui.user.entity = arg; renderUser(); break;
    case 'open-request': ui.user.page = 'requestDetail'; ui.user.request = arg; ui.wizard = null; renderUser(); break;
    case 'filter-kind': ui.user.filterKind = arg; renderUser(); break;
    case 'filter-owner': ui.user.filterOwner = arg; renderUser(); break;
    case 'open-wizard': ui.wizard = newWizard(arg || null); ui.user.page = 'wizard'; renderUser(); break;
    case 'open-image-wizard': ui.wizard = newImageWizard(arg); ui.user.page = 'wizard'; renderUser(); break;
    case 'not-included': toast('user', 'Fonctionnalité non incluse dans la maquette', 'warning'); break;

    /* Assistant image (harbor-pull / diode-push) */
    case 'img-wiz-prev':
      if (w) { w.step = Math.max(0, w.step - 1); w.error = ''; renderUser(); } break;
    case 'img-wiz-next':
      if (!w) break;
      w.error = validateImageWizardStep();
      if (!w.error) w.step++;
      renderUser();
      break;
    case 'img-wiz-submit':
      if (!w) break;
      w.error = validateImageWizardStep();
      if (!w.error) submitImageWizard();
      else renderUser();
      break;
    case 'img-wiz-goto-step':
      if (w) { const s = parseInt(arg, 10); if (s < w.step) { w.step = s; w.error = ''; renderUser(); } } break;
    case 'img-wiz-diode':
      if (w) { w.data.diodeNetwork = arg; renderUser(); } break;
    case 'img-wiz-seclevel':
      if (w) { w.data.securityLevel = arg; renderUser(); } break;

    /* Assistant infra */
    case 'wiz-prev': if (w) { w.step = Math.max(0, w.step - 1); if (w.resourceKey && w.step === 2) w.step = Math.max(0, w.step - 1); w.error = ''; renderUser(); } break;
    case 'wiz-next':
      if (!w) break;
      w.error = validateWizardStep();
      if (!w.error) { w.step++; if (w.resourceKey && w.step === 2) w.step++; }
      renderUser();
      break;
    case 'wiz-submit':
      if (!w) break;
      w.error = '';
      submitWizard();
      break;
    case 'wiz-env': if (w) { w.data.env = arg; renderUser(); } break;
    case 'wiz-network': if (w) { w.data.network = arg; renderUser(); } break;
    case 'wiz-ressize': {
      if (!w) break;
      const parts = arg.split(':');
      if (parts[0] === 'vm') {
        const idx = parseInt(parts[1], 10);
        w.data.vmSizes[idx] = parts[2];
      } else {
        w.data.resourceSizes[parts[0]] = parts[1];
      }
      renderUser();
      break;
    }
    case 'tpl-category': ui.user.templateCategory = arg; renderUser(); break;
    case 'wiz-goto-step': if (w) { const s = parseInt(arg, 10); if (s < w.step && !(w.resourceKey && s === 2)) { w.step = s; w.error = ''; renderUser(); } } break;
    case 'wiz-res':
      if (w && e.target.tagName !== 'INPUT' && !e.target.closest('.pick-card__qty')) {
        w.data.resources[arg] = !w.data.resources[arg];
        w.error = '';
        renderUser();
      }
      break;
  }
});

/* Re-rend le volet utilisateur puis redonne le focus (et le curseur) au champ saisi.
   Utilisé pour les champs dont la modification change l'affichage (prix, lignes VM…). */
function rerenderKeepFocus(selector, srcInput) {
  const pos = srcInput.selectionStart;
  renderUser();
  const again = document.querySelector(selector);
  if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (_) {} }
}

/* Saisie dans les champs (sans re-rendu, pour ne pas perdre le focus) */
$('#user-main').addEventListener('input', e => {
  const key = e.target.dataset.input;
  if (!key) return;
  const w = ui.wizard;
  switch (key) {
    /* Saisie dans l'assistant image */
    case 'img-wiz-team': if (w) w.data.team = e.target.value; break;
    case 'img-wiz-justification': if (w) w.data.justification = e.target.value; break;
    case 'img-wiz-project':
      if (w) { w.data.harborProject = e.target.value === '__custom__' ? '__custom__' : e.target.value; renderUser(); } break;
    case 'img-wiz-project-custom':
      if (w) { w.data.harborProject = e.target.value; } break;
    case 'img-wiz-image':
      if (w) { w.data.imageName = e.target.value; rerenderKeepFocus('[data-input="img-wiz-image"]', e.target); } break;
    case 'img-wiz-tag':
      if (w) { w.data.imageTag = e.target.value; rerenderKeepFocus('[data-input="img-wiz-tag"]', e.target); } break;
    case 'img-wiz-cluster':
      if (w) { w.data.targetCluster = e.target.value === '__custom__' ? '__custom__' : e.target.value; renderUser(); } break;
    case 'img-wiz-cluster-custom':
      if (w) { w.data.targetCluster = e.target.value; } break;
    case 'img-wiz-namespace': if (w) w.data.targetNamespace = e.target.value; break;
    case 'img-wiz-system': if (w) w.data.targetSystem = e.target.value; break;
    case 'img-wiz-path': if (w) w.data.targetPath = e.target.value; break;
    /* Saisie dans l'assistant infra */
    case 'wiz-name': if (w) { w.data.name = e.target.value; rerenderKeepFocus('[data-input="wiz-name"]', e.target); } break;
    case 'wiz-team': if (w) w.data.team = e.target.value; break;
    case 'wiz-hypervisor': if (w) { w.data.hypervisor = e.target.value; renderUser(); } break;
    case 'wiz-desc': if (w) w.data.description = e.target.value; break;
    case 'wiz-ranchername':    if (w) w.data.resources.rancherName = e.target.value; break;
    case 'wiz-serverlessimage': if (w) w.data.resources.serverlessImage = e.target.value; break;
    case 'wiz-wikiname':       if (w) w.data.resources.wikiName = e.target.value; break;
    case 'wiz-vmcount': {
      if (!w) break;
      const count = Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 1));
      w.data.resources.vmCount = count;
      const fillSize = w.data.vmSizes[0] ?? w.data.size;
      while (w.data.vmSizes.length < count) w.data.vmSizes.push(fillSize);
      w.data.vmSizes = w.data.vmSizes.slice(0, count);
      rerenderKeepFocus(`[data-input="${key}"]`, e.target);
      break;
    }
    case 'wiz-registrygb': {
      if (!w) break;
      w.data.resources.registryGb = Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 10));
      rerenderKeepFocus(`[data-input="${key}"]`, e.target);
      break;
    }
    case 'wiz-rescustom': {
      if (!w) break;
      const ck = e.target.dataset.ckey, cf = e.target.dataset.cfield;
      const max = cf === 'cpu' ? 64 : cf === 'ram' ? 256 : 2000;
      const specs = w.data.customSpecs;
      if (!specs[ck]) specs[ck] = { ...DEFAULT_CUSTOM };
      specs[ck][cf] = Math.max(1, Math.min(max, parseInt(e.target.value, 10) || 1));
      rerenderKeepFocus(`[data-input="wiz-rescustom"][data-ckey="${ck}"][data-cfield="${cf}"]`, e.target);
      break;
    }
    case 'catalog-search': {
      // Re-rendu du tableau filtré + restauration du focus dans le champ
      ui.user.search = e.target.value;
      const pos = e.target.selectionStart;
      renderUser();
      const input = $('#catalog-search');
      if (input) { input.focus(); input.setSelectionRange(pos, pos); }
      break;
    }
    case 'tpl-search': {
      ui.user.templateSearch = e.target.value;
      const pos = e.target.selectionStart;
      renderUser();
      const inp = document.querySelector('[data-input="tpl-search"]');
      if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
      break;
    }
  }
});

/* --- Actions du volet administrateur --- */
$('#admin-main').addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, arg } = el.dataset;
  switch (action) {
    case 'admin-goto-inbox': ui.admin.page = 'inbox'; renderAdmin(); break;
    case 'admin-filter': ui.admin.filter = arg; renderAdmin(); break;
    case 'admin-open': ui.admin.page = 'request'; ui.admin.request = arg; renderAdmin(); break;
    case 'admin-approve': approveRequest(arg); break;
    case 'admin-reject': rejectRequest(arg); break;
    case 'not-included': toast('admin', 'Fonctionnalité non incluse dans la maquette', 'warning'); break;
  }
});

/* --- Réinitialisation de la démo --- */
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Réinitialiser la démonstration ? Toutes les demandes créées seront effacées.')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

/* ============================================================
   9. Initialisation
   ============================================================ */

renderUser();
renderAdmin();
renderBadges();

/* Si la page a été rechargée pendant un provisionnement, on le reprend */
state.requests
  .filter(r => r.status === 'provisioning' || r.status === 'approved')
  .forEach(r => setTimeout(() => startProvisioning(r.id), 800));
