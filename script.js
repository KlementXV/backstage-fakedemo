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
  storage:    { icon: '🗄️', label: 'Stockage objet (S3)',     base: 0.10, sized: false, qty: 'storageGb',
                desc: 'Stockage compatible S3, facturé 0,10 €/Go/mois.' },
};

/* Catalogue de templates (page « Créer… ») */
const TEMPLATES = [
  {
    id: 'platform-project', enabled: true, type: 'Infrastructure',
    title: 'Provisionnement de projet plateforme',
    desc: 'Crée un projet complet : Rancher, Harbor, machines virtuelles, bases de données et stockage, avec workflow de validation.',
    tags: ['rancher', 'harbor', 'vm', 'postgresql', 'mongodb'],
  },

];

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
      ['', `Création du projet « ${r.name} » et des namespaces associés`],
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
        ['info', `Clonage du modèle ubuntu-22.04 (${r.resources.vmCount} instance(s))…`],
        ...vmSizes.map((sz, i) => ['', `VM #${i + 1} : gabarit ${def.planLabels[sz] ?? sz}`]),
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
      ...(r.resources.serverless ? [['', `Namespace serverless « ${r.name} » provisionné · autoscaling activé`]] : []),
      ...(r.resources.wiki       ? [['', `Wiki « ${r.name}-wiki » créé · base et stockage initialisés`]] : []),
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
];

/* ============================================================
   2. État global + persistance
   ============================================================ */

const STORAGE_KEY = 'helios-demo-state-v1';
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
        resources: { rancher: true, harbor: false, vm: true, vmCount: 1, postgres: true, mongo: false, storage: true, storageGb: 50 },
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
        resources: { rancher: true, harbor: true, vm: true, vmCount: 4, postgres: false, mongo: true, storage: true, storageGb: 500 },
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
  user:  { page: 'catalog', entity: null, request: null, filterKind: 'all', filterOwner: 'all', search: '' },
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

/* Coût mensuel estimé d'une demande (tarifs réels HT) */
function computeCost(req) {
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
      const plan = def.planLabels[sz] ?? 'VM-XS';
      lines.push([`VM ${plan}${vmSizes.length > 1 ? ` #${i + 1}` : ''}`, def.prices[sz] ?? def.base]);
    });
  }
  if (r.postgres) {
    const def = RESOURCE_DEFS.postgres; const sz = getSize('postgres');
    lines.push([`PostgreSQL — ${def.planLabels[sz] ?? 'PG-Dev'}`, def.prices[sz] ?? def.base]);
  }
  if (r.mariadb) {
    const def = RESOURCE_DEFS.mariadb; const sz = getSize('mariadb');
    lines.push([`MariaDB — ${def.planLabels[sz] ?? 'Maria-Dev'}`, def.prices[sz] ?? def.base]);
  }
  if (r.mongo) {
    const def = RESOURCE_DEFS.mongo; const sz = getSize('mongo');
    lines.push([`MongoDB — ${def.planLabels[sz] ?? 'Mongo-Dev'}`, def.prices[sz] ?? def.base]);
  }
  if (r.redis) {
    const def = RESOURCE_DEFS.redis; const sz = getSize('redis');
    lines.push([`Redis — ${def.planLabels[sz] ?? 'Redis-Dev'}`, def.prices[sz] ?? def.base]);
  }
  if (r.rabbitmq) {
    const def = RESOURCE_DEFS.rabbitmq; const sz = getSize('rabbitmq');
    lines.push([`RabbitMQ — ${def.planLabels[sz] ?? 'Rabbit-Dev'}`, def.prices[sz] ?? def.base]);
  }
  if (r.serverless) lines.push(['Serverless Containers (min.)', RESOURCE_DEFS.serverless.base]);
  if (r.wiki)       lines.push(['Wiki as a Service', RESOURCE_DEFS.wiki.base]);
  if (r.storage)    lines.push([`Stockage objet (${r.storageGb} Go)`, RESOURCE_DEFS.storage.base * r.storageGb]);
  const total = Math.round(lines.reduce((s, l) => s + l[1], 0));
  return { lines, total };
}

/* Liste lisible des ressources d'une demande */
function resourceSummary(req) {
  const r = req.resources;
  const out = [];
  if (r.rancher)    out.push('Projet Rancher');
  if (r.harbor)     out.push(`Registry Harbor (${r.registryGb ?? 10} Go)`);
  if (r.vm)         out.push(`${r.vmCount} VM`);
  if (r.postgres)   out.push('PostgreSQL');
  if (r.mariadb)    out.push('MariaDB');
  if (r.mongo)      out.push('MongoDB');
  if (r.redis)      out.push('Redis');
  if (r.rabbitmq)   out.push('RabbitMQ');
  if (r.serverless) out.push('Serverless');
  if (r.wiki)       out.push('Wiki');
  if (r.storage)    out.push(`Stockage ${r.storageGb} Go`);
  return out;
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
      title: 'Catalogue Helios',
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
  return `
    ${pageHeader('user', {
      title: 'Créer un nouveau composant',
      subtitle: 'Software Templates · démarrez un projet à partir d’un modèle approuvé par l’équipe plateforme',
    })}
    <div class="tabs">
      <button class="tab is-active">Templates</button>
      <button class="tab" data-action="not-included">Tâches</button>
    </div>
    <div class="content">
      <div class="banner banner--info">ℹ️ <span>Les templates appliquent automatiquement les standards de sécurité,
        de nommage et de supervision de l’entreprise.</span></div>
      <div class="cards-grid">
        ${TEMPLATES.map(t => `
          <article class="tpl-card">
            <div class="tpl-card__head">
              <div>
                <div class="tpl-card__type">${esc(t.type)}</div>
                <div class="tpl-card__title">${esc(t.title)}</div>
              </div>
            </div>
            <div class="tpl-card__body">
              <p class="tpl-card__desc">${esc(t.desc)}</p>
              <div class="tpl-card__tags">${chips(t.tags, 'chip--outline')}</div>
            </div>
            <div class="tpl-card__foot">
              <button class="btn ${t.enabled ? 'btn--primary' : 'btn--text'}"
                      data-action="${t.enabled ? 'open-wizard' : 'not-included'}">Choisir</button>
            </div>
          </article>`).join('')}
      </div>
    </div>`;
}

/* ---- 5.4 Assistant multi-étapes (Software Template) ---- */

const WIZARD_STEPS = ['Informations', 'Environnement', 'Ressources', 'Dimensionnement', 'Résumé', 'Envoi'];

function newWizard() {
  return {
    step: 0,
    error: '',
    sentRequestId: null,
    data: {
      name: '', team: TEAMS[0], description: '',
      env: 'dev', size: 'M',
      resourceSizes: { vm: 'M', postgres: 'M', mariadb: 'M', mongo: 'M', redis: 'M', rabbitmq: 'M' },
      vmSizes: ['M', 'M'],
      resources: {
        rancher: true, harbor: false, registryGb: 10,
        vm: false, vmCount: 2,
        postgres: false, mariadb: false, mongo: false,
        redis: false, rabbitmq: false,
        serverless: false, wiki: false,
        storage: false, storageGb: 100,
      },
    },
  };
}

function userWizardPage() {
  const w = ui.wizard;
  if (!w) { ui.user.page = 'create'; return userTemplatesPage(); }

  const stepper = `
    <div class="stepper">
      ${WIZARD_STEPS.map((label, i) => `
        <div class="stepper__step ${i === w.step ? 'is-active' : ''} ${i < w.step ? 'is-done' : ''}">
          <div class="stepper__num">${i < w.step ? '✓' : i + 1}</div>
          <div class="stepper__label">${label}</div>
        </div>`).join('')}
    </div>`;

  const bodies = [wizStep1, wizStep2, wizStep3, wizStep4, wizStep5, wizStep6];
  const isLastInfo = w.step === 5;

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'Créer…', action: 'goto-create' }, { label: 'Provisionnement de projet plateforme' }],
      title: 'Provisionnement de projet plateforme',
      subtitle: 'Template géré par équipe-plateforme · v2.4',
    })}
    <div class="content">
      <div class="card">
        <div class="card__body">
          ${stepper}
          ${w.error ? `<div class="banner banner--error">⚠️ <span>${esc(w.error)}</span></div>` : ''}
          ${bodies[w.step]()}
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
  return `
    <div class="form-grid-2">
      <div class="form-row">
        <label class="field-label">Nom du projet <span class="required">*</span></label>
        <input type="text" placeholder="ex. portail-fournisseurs" value="${esc(d.name)}" data-input="wiz-name">
        <div class="hint">Minuscules, chiffres et tirets uniquement — utilisé pour nommer toutes les ressources.</div>
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
    </div>`;
}

/* Étape 3 : sélection des ressources */
function wizStep3() {
  const r = ui.wizard.data.resources;
  const card = (key, extra = '') => {
    const def = RESOURCE_DEFS[key];
    let priceStr;
    if (key === 'storage')    priceStr = '0,10 € / Go / mois';
    else if (key === 'harbor') priceStr = '1 € / Go / mois';
    else                       priceStr = `dès ${euro(def.base)} / mois`;
    return `
      <div class="pick-card ${r[key] ? 'is-selected' : ''}" data-action="wiz-res" data-arg="${key}">
        <div class="pick-card__icon">${def.icon}</div>
        <div class="pick-card__title">${def.label}</div>
        <div class="pick-card__desc">${def.desc}</div>
        <div class="pick-card__price">${priceStr}</div>
        ${extra}
      </div>`;
  };
  return `
    <div class="form-row">
      <label class="field-label">Ressources souhaitées <span class="required">*</span> <span class="muted">(au moins une)</span></label>
      <div class="pick-grid">
        ${card('rancher')}
        ${card('harbor', `
          <div class="pick-card__qty" data-stop>
            <span>Volume (Go) :</span>
            <input type="number" min="1" max="500" value="${r.registryGb}" data-input="wiz-registrygb">
          </div>`)}
        ${card('vm', `
          <div class="pick-card__qty" data-stop>
            <span>Nombre :</span>
            <input type="number" min="1" max="6" value="${r.vmCount}" data-input="wiz-vmcount">
          </div>`)}
        ${card('postgres')}
        ${card('mariadb')}
        ${card('mongo')}
        ${card('redis')}
        ${card('rabbitmq')}
        ${card('serverless')}
        ${card('wiki')}
        ${card('storage', `
          <div class="pick-card__qty" data-stop>
            <span>Volume (Go) :</span>
            <input type="number" min="10" max="2000" step="10" value="${r.storageGb}" data-input="wiz-storagegb">
          </div>`)}
      </div>
    </div>`;
}

/* Étape 4 : dimensionnement + estimation de coût */
function wizStep4() {
  const d = ui.wizard.data;
  const r = d.resources;
  const rs = d.resourceSizes;
  const cost = computeCost(d);

  const SIZED_KEYS = ['vm', 'postgres', 'mariadb', 'mongo', 'redis', 'rabbitmq'];
  const selectedSized = SIZED_KEYS.filter(k => r[k]);

  const sizeBtns = (currentSize, actionArg) =>
    Object.keys(SIZES).map(sz =>
      `<button class="size-btn ${currentSize === sz ? 'size-btn--active' : ''}" data-action="wiz-ressize" data-arg="${actionArg}:${sz}">${sz}</button>`
    ).join('');

  const customRows = selectedSized.map(key => {
    const def = RESOURCE_DEFS[key];
    if (key === 'vm') {
      return d.vmSizes.map((sz, i) => `
        <div class="res-size-row">
          <div class="res-size-label">${def.icon} ${def.label} <span class="chip chip--sm">#${i + 1}</span></div>
          <div class="res-size-btns">${sizeBtns(sz, `vm:${i}`)}</div>
          <div class="res-size-price">${euro(def.prices[sz] ?? def.base)} <small>/mois</small></div>
        </div>`).join('');
    }
    const sz = rs[key] ?? d.size;
    return `
      <div class="res-size-row">
        <div class="res-size-label">${def.icon} ${def.label}</div>
        <div class="res-size-btns">${sizeBtns(sz, key)}</div>
        <div class="res-size-price">${euro(def.prices[sz] ?? def.base)} <small>/mois</small></div>
      </div>`;
  }).join('');

  return `
    <div class="form-row">
      <label class="field-label">Gabarit de base <span class="muted">— appliqué à toutes les ressources simultanément</span></label>
      <div class="pick-grid">
        ${Object.entries(SIZES).map(([k, s]) => `
          <div class="pick-card ${d.size === k ? 'is-selected' : ''}" data-action="wiz-size" data-arg="${k}">
            <div class="pick-card__title">${s.label}</div>
            <div class="pick-card__desc">${s.specs}</div>
          </div>`).join('')}
      </div>
    </div>

    ${selectedSized.length ? `
    <div class="form-row">
      <label class="field-label">Personnalisation par ressource <span class="muted">— affinez chaque ressource indépendamment</span></label>
      <div class="res-size-grid">${customRows}</div>
    </div>` : ''}

    <div class="cost-box">
      <span class="muted">Estimation du coût mensuel</span>
      <div class="cost-box__total">${euro(cost.total)} <small>/ mois (HT, simulé)</small></div>
      <ul class="cost-box__lines">
        ${cost.lines.map(l => `<li><span>${esc(l[0])}</span><span>${euro(Math.round(l[1]))}</span></li>`).join('')
          || '<li><span class="muted">Aucune ressource sélectionnée</span></li>'}
      </ul>
    </div>`;
}

/* Vérifie si des tailles per-ressource diffèrent du gabarit global */
function isCustomSized(d) {
  const rs = d.resourceSizes ?? {};
  if (Object.values(rs).some(sz => sz !== d.size)) return true;
  if ((d.vmSizes ?? []).some(sz => sz !== d.size)) return true;
  return false;
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
      <div><span class="label">Gabarit</span><span class="value">${SIZES[d.size].label}${isCustomSized(d) ? ' <span class="chip chip--info">personnalisé</span>' : ''}</span></div>
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
    if (!r.rancher && !r.harbor && !r.vm && !r.postgres && !r.mariadb && !r.mongo && !r.redis && !r.rabbitmq && !r.serverless && !r.wiki && !r.storage)
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
                  <td>${euro(computeCost(r).total)}<span class="muted">/mois</span></td>
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
            <div><span class="label">Environnement</span><span class="value">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</span></div>
            <div><span class="label">Taille</span><span class="value">${SIZES[r.size].label}</span></div>
            <div><span class="label">Coût mensuel estimé</span><span class="value">${euro(cost.total)}</span></div>
            <div class="kv--full"><span class="label">Description</span><span class="value">${esc(r.description) || '—'}</span></div>
            <div class="kv--full"><span class="label">Ressources demandées</span>
              <span class="value">${resourceSummary(r).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</span></div>
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
                  <td>${euro(computeCost(r).total)}</td>
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
  const cost = computeCost(r);
  const canDecide = r.status === 'pending';

  /* Lignes du tableau des ressources demandées */
  const res = r.resources;
  const rs = r.resourceSizes ?? {};
  const globalSz = r.size ?? 'S';
  const getSize = key => rs[key] ?? globalSz;
  const resRows = [];
  if (res.rancher) resRows.push(['🐮 Projet Rancher (K8s)', '1', euro(RESOURCE_DEFS.rancher.base)]);
  if (res.harbor) {
    const gb = res.registryGb ?? 10;
    resRows.push(['⚓ Registry Harbor', `${gb} Go`, euro(gb)]);
  }
  if (res.vm) {
    const def = RESOURCE_DEFS.vm;
    const vmSizes = r.vmSizes ?? Array(res.vmCount).fill(getSize('vm'));
    vmSizes.forEach((sz, i) => {
      const plan = def.planLabels[sz] ?? 'VM-XS';
      resRows.push([`🖥️ VM ${plan}${vmSizes.length > 1 ? ` #${i + 1}` : ''}`, '1', euro(def.prices[sz] ?? def.base)]);
    });
  }
  if (res.postgres) {
    const def = RESOURCE_DEFS.postgres; const sz = getSize('postgres');
    resRows.push([`🐘 PostgreSQL — ${def.planLabels[sz] ?? 'PG-Dev'}`, '1', euro(def.prices[sz] ?? def.base)]);
  }
  if (res.mariadb) {
    const def = RESOURCE_DEFS.mariadb; const sz = getSize('mariadb');
    resRows.push([`🗃️ MariaDB — ${def.planLabels[sz] ?? 'Maria-Dev'}`, '1', euro(def.prices[sz] ?? def.base)]);
  }
  if (res.mongo) {
    const def = RESOURCE_DEFS.mongo; const sz = getSize('mongo');
    resRows.push([`🍃 MongoDB — ${def.planLabels[sz] ?? 'Mongo-Dev'}`, '1', euro(def.prices[sz] ?? def.base)]);
  }
  if (res.redis) {
    const def = RESOURCE_DEFS.redis; const sz = getSize('redis');
    resRows.push([`🔴 Redis — ${def.planLabels[sz] ?? 'Redis-Dev'}`, '1', euro(def.prices[sz] ?? def.base)]);
  }
  if (res.rabbitmq) {
    const def = RESOURCE_DEFS.rabbitmq; const sz = getSize('rabbitmq');
    resRows.push([`🐰 RabbitMQ — ${def.planLabels[sz] ?? 'Rabbit-Dev'}`, '1', euro(def.prices[sz] ?? def.base)]);
  }
  if (res.serverless) resRows.push(['⚡ Serverless Containers', '1 service', euro(RESOURCE_DEFS.serverless.base)]);
  if (res.wiki)       resRows.push(['📖 Wiki as a Service', '1', euro(RESOURCE_DEFS.wiki.base)]);
  if (res.storage)    resRows.push([`🗄️ Stockage objet`, `${res.storageGb} Go`, euro(Math.round(RESOURCE_DEFS.storage.base * res.storageGb))]);

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

      ${canDecide ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Décision</span></div>
        <div class="card__body">
          ${r.env === 'prod' ? '<div class="banner banner--warning">⚠️ <span>Demande en <strong>production</strong> : vérifiez le dimensionnement avant validation.</span></div>' : ''}
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
          ${PROV_STEPS.map((step, i) => {
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
    r.prov = { steps: PROV_STEPS.map(() => 'pending'), log: [] };
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

  const step = PROV_STEPS[idx];

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
        description: `Projet Rancher (namespaces et quotas) du projet ${r.name}.` }); count++; }
  if (r.resources.harbor) { add({ name: `${r.name}-registry`, kind: 'Resource', type: 'harbor-project', tags: ['harbor', 'docker'],
        description: `Registre d'images Harbor du projet ${r.name} (${r.resources.registryGb ?? 10} Go).` }); count++; }
  if (r.resources.vm) { add({ name: `${r.name}-vms`, kind: 'Resource', type: 'virtual-machine', tags: [`x${r.resources.vmCount}`, r.size.toLowerCase()],
        description: `${r.resources.vmCount} machine(s) virtuelle(s) plan ${RESOURCE_DEFS.vm.planLabels[r.size] ?? 'VM-XS'}.` }); count++; }
  if (r.resources.postgres) { add({ name: `${r.name}-postgresql`, kind: 'Resource', type: 'database', tags: ['postgresql', RESOURCE_DEFS.postgres.planLabels[r.size]?.toLowerCase() ?? 'pg-dev'],
        description: `Base PostgreSQL managée du projet ${r.name}.` }); count++; }
  if (r.resources.mariadb) { add({ name: `${r.name}-mariadb`, kind: 'Resource', type: 'database', tags: ['mariadb', RESOURCE_DEFS.mariadb.planLabels[r.size]?.toLowerCase() ?? 'maria-dev'],
        description: `Base MariaDB managée du projet ${r.name}.` }); count++; }
  if (r.resources.mongo) { add({ name: `${r.name}-mongodb`, kind: 'Resource', type: 'database', tags: ['mongodb', RESOURCE_DEFS.mongo.planLabels[r.size]?.toLowerCase() ?? 'mongo-dev'],
        description: `Base MongoDB managée du projet ${r.name}.` }); count++; }
  if (r.resources.redis) { add({ name: `${r.name}-redis`, kind: 'Resource', type: 'cache', tags: ['redis', RESOURCE_DEFS.redis.planLabels[r.size]?.toLowerCase() ?? 'redis-dev'],
        description: `Cache Redis managé du projet ${r.name}.` }); count++; }
  if (r.resources.rabbitmq) { add({ name: `${r.name}-rabbitmq`, kind: 'Resource', type: 'message-broker', tags: ['rabbitmq', RESOURCE_DEFS.rabbitmq.planLabels[r.size]?.toLowerCase() ?? 'rabbit-dev'],
        description: `Broker RabbitMQ managé du projet ${r.name}.` }); count++; }
  if (r.resources.serverless) { add({ name: `${r.name}-serverless`, kind: 'Resource', type: 'serverless', tags: ['serverless', 'containers'],
        description: `Namespace serverless Containers du projet ${r.name}.` }); count++; }
  if (r.resources.wiki) { add({ name: `${r.name}-wiki`, kind: 'Resource', type: 'wiki', tags: ['wiki'],
        description: `Wiki as a Service du projet ${r.name}.` }); count++; }
  if (r.resources.storage) { add({ name: `${r.name}-storage`, kind: 'Resource', type: 'object-store', tags: [`${r.resources.storageGb}-go`],
        description: `Stockage objet (${r.resources.storageGb} Go) du projet ${r.name}.` }); count++; }
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
    case 'open-wizard': ui.wizard = newWizard(); ui.user.page = 'wizard'; renderUser(); break;
    case 'not-included': toast('user', 'Fonctionnalité non incluse dans la maquette', 'warning'); break;

    /* Assistant */
    case 'wiz-prev': if (w) { w.step = Math.max(0, w.step - 1); w.error = ''; renderUser(); } break;
    case 'wiz-next':
      if (!w) break;
      w.error = validateWizardStep();
      if (!w.error) w.step++;
      renderUser();
      break;
    case 'wiz-submit':
      if (!w) break;
      w.error = '';
      submitWizard();
      break;
    case 'wiz-env': if (w) { w.data.env = arg; renderUser(); } break;
    case 'wiz-size':
      if (w) {
        w.data.size = arg;
        Object.keys(w.data.resourceSizes).forEach(k => { w.data.resourceSizes[k] = arg; });
        w.data.vmSizes = w.data.vmSizes.map(() => arg);
        renderUser();
      }
      break;
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
    case 'wiz-res':
      if (w && e.target.tagName !== 'INPUT' && !e.target.closest('.pick-card__qty')) {
        w.data.resources[arg] = !w.data.resources[arg];
        w.error = '';
        renderUser();
      }
      break;
  }
});

/* Saisie dans les champs (sans re-rendu, pour ne pas perdre le focus) */
$('#user-main').addEventListener('input', e => {
  const key = e.target.dataset.input;
  if (!key) return;
  const w = ui.wizard;
  switch (key) {
    case 'wiz-name': if (w) w.data.name = e.target.value; break;
    case 'wiz-team': if (w) w.data.team = e.target.value; break;
    case 'wiz-desc': if (w) w.data.description = e.target.value; break;
    case 'wiz-vmcount':
      if (w) {
        const count = Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 1));
        w.data.resources.vmCount = count;
        const fillSize = w.data.vmSizes[0] ?? w.data.size;
        while (w.data.vmSizes.length < count) w.data.vmSizes.push(fillSize);
        w.data.vmSizes = w.data.vmSizes.slice(0, count);
      }
      break;
    case 'wiz-registrygb': if (w) w.data.resources.registryGb = Math.max(1, Math.min(500,  parseInt(e.target.value, 10) || 10));  break;
    case 'wiz-storagegb':  if (w) w.data.resources.storageGb  = Math.max(10, Math.min(2000, parseInt(e.target.value, 10) || 10)); break;
    case 'catalog-search': {
      // Re-rendu du tableau filtré + restauration du focus dans le champ
      ui.user.search = e.target.value;
      const pos = e.target.selectionStart;
      renderUser();
      const input = $('#catalog-search');
      if (input) { input.focus(); input.setSelectionRange(pos, pos); }
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
