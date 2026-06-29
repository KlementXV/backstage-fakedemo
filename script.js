/* ============================================================
   Hybrid Demand Cloud — internal developer portal mockup inspired by Backstage
   ------------------------------------------------------------
   Everything is simulated in the browser: no backend, no real calls
   to Rancher / Harbor / VMware / PostgreSQL / MongoDB.

   File organization:
     1. Reference data (teams, environments, sizes, resources,
        templates, statuses)
     2. Global state + localStorage persistence
     3. Utilities (formatting, escaping, toasts)
     4. Small reusable HTML components
     5. User view (catalog, entity, templates, wizard,
        my requests)
     6. Admin view (approvals, detail, provisioning,
        activity log)
     7. Provisioning simulation
     8. Event handling (delegation)
     9. Initialization
   ============================================================ */

'use strict';

/* ============================================================
   1. Reference Data
   ============================================================ */

const TEAMS = [
  'web-team', 'finance-team', 'data-team', 'mobile-team', 'platform-team',
];

const ENVIRONMENTS = {
  dev:     { label: 'Development', icon: '🧪', lifecycle: 'experimental',
             desc: 'Sandbox for work in progress. No availability guarantee.' },
  staging: { label: 'Staging',     icon: '🔍', lifecycle: 'staging',
             desc: 'Functional validation environment, close to production but lighter.' },
  prod:    { label: 'Production',    icon: '🚀', lifecycle: 'production',
             desc: 'Production environment. High availability, backups and on-call support.' },
};

const SIZES = {
  S:  { label: 'S — Micro',       specs: 'VM-XS · PG-Dev · Redis-Dev · Rabbit-Dev' },
  M:  { label: 'M — Standard',    specs: 'VM-M  · PG-M  · Redis-M  · Rabbit-M' },
  L:  { label: 'L — Performance', specs: 'VM-L  · PG-L  · Redis-L  · Rabbit-L' },
  XL: { label: 'XL — Intensive',  specs: 'VM-XL · PG-XL · Redis-XL · Rabbit-XL' },
  custom: { label: 'Custom',      specs: 'custom vCPU, RAM and storage' },
};

/* Target networks / regions (datacenters) — Backstage Software Template parameter */
const NETWORKS = {
  FR:  { flag: '🇫🇷', label: 'France (Paris)',         desc: 'Primary datacenter — default hosting for France projects.' },
  IT:  { flag: '🇮🇹', label: 'Italy (Milan)',          desc: 'Regional Italy datacenter — reduced capacity.' },
  USA: { flag: '🇺🇸', label: 'United States (Ashburn)', desc: 'Americas datacenter — data subject to US location rules.' },
};

/* Available hypervisors (optional — applies to virtual machines) */
const HYPERVISORS = {
  auto:      { icon: '🎛️', label: 'Any — platform choice' },
  vmware:    { icon: '🟦', label: 'VMware vSphere' },
  hyperv:    { icon: '🪟', label: 'Microsoft Hyper-V' },
  harvester: { icon: '🐄', label: 'Harvester (SUSE / Rancher)' },
};

/* Technical footprint (vCPU / GB RAM / GB storage) per size, used for capacity calculation */
const SIZE_FOOTPRINT = {
  S:  { cpu: 2,  ram: 4,  storage: 40 },
  M:  { cpu: 4,  ram: 16, storage: 100 },
  L:  { cpu: 8,  ram: 32, storage: 250 },
  XL: { cpu: 16, ram: 64, storage: 500 },
};

/* Capacity inventory per region and hypervisor (simulated).
   pool = total capacity; used = existing baseline load.
   Already approved/provisioned requests are added dynamically. */
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


/* Resources available in the wizard (simulated prices, excl. tax) */
const RESOURCE_DEFS = {
  rancher:    { icon: '🐮', label: 'Rancher Project (K8s)', base: 75, sized: false,
                desc: 'Managed Kubernetes project: namespaces, quotas and RBAC. Flat fee 75 €/month.' },
  harbor:     { icon: '⚓', label: 'Harbor Registry',       base: 1,  sized: false, qty: 'registryGb',
                desc: 'Private image registry with vulnerability scanning. Billed at 1 €/GB/month.' },
  vm:         { icon: '🖥️', label: 'Virtual Machines',     base: 65, sized: true, qty: 'vmCount',
                prices: { S: 65, M: 220, L: 420, XL: 820 },
                planLabels: { S: 'VM-XS', M: 'VM-M', L: 'VM-L', XL: 'VM-XL' },
                desc: 'Managed Linux virtual machines (VMaaS). Optional lease timeout with auto-delete reminders.' },
  postgres:   { icon: '🐘', label: 'PostgreSQL', base: 60, sized: true,
                prices: { S: 60, M: 190, L: 340, XL: 650 },
                planLabels: { S: 'PG-Dev', M: 'PG-M', L: 'PG-L', XL: 'PG-XL' },
                desc: 'Managed relational database with daily backups. Replica multiplier ×2.7.' },
  mariadb:    { icon: '🗃️', label: 'MariaDB', base: 60, sized: true,
                prices: { S: 60, M: 190, L: 340, XL: 650 },
                planLabels: { S: 'Maria-Dev', M: 'Maria-M', L: 'Maria-L', XL: 'Maria-XL' },
                desc: 'Managed MariaDB database with backups. Same price grid as PostgreSQL.' },
  mongo:      { icon: '🍃', label: 'MongoDB', base: 90, sized: true,
                prices: { S: 90, M: 320, L: 620, XL: 1200 },
                planLabels: { S: 'Mongo-Dev', M: 'Mongo-M', L: 'Mongo-L', XL: 'Mongo-XL' },
                desc: 'Managed document database (replica set × 3). ×2.7 pricing included.' },
  redis:      { icon: '🔴', label: 'Redis', base: 35, sized: true,
                prices: { S: 35, M: 110, L: 190, XL: 350 },
                planLabels: { S: 'Redis-Dev', M: 'Redis-M', L: 'Redis-L', XL: 'Redis-XL' },
                desc: 'Managed Redis cache. Options: persistence +20 €, high availability ×2.5.' },
  rabbitmq:   { icon: '🐰', label: 'RabbitMQ', base: 60, sized: true,
                prices: { S: 60, M: 190, L: 340, XL: 620 },
                planLabels: { S: 'Rabbit-Dev', M: 'Rabbit-M', L: 'Rabbit-L', XL: 'Rabbit-XL' },
                desc: 'Managed message broker. Three-node cluster: ×2.5 pricing.' },
  wiki:       { icon: '📖', label: 'Wiki', base: 120, sized: false,
                desc: 'Managed collaborative wiki (application, database and storage included).' },
};

/* Template catalog ("Create..." page) */
const TEMPLATES = [
  {
    id: 'platform-project', enabled: true, type: 'Infrastructure', category: 'infra',
    title: 'Bundle',
    desc: 'Creates a complete project: Rancher, Harbor, virtual machines with optional lease timeout, and databases, with an approval workflow.',
    tags: ['rancher', 'harbor', 'vm', 'timeout', 'postgresql', 'mongodb'],
    owner: 'platform-team', version: 'v2.4', usageCount: 47, isNew: false,
  },
];

/* Individual template metadata (generated from RESOURCE_DEFS) */
const RES_TPL_META = {
  rancher:    { type: 'Infrastructure', category: 'infra', tags: ['rancher', 'kubernetes', 'k8s'],         usageCount: 38 },
  harbor:     { type: 'Infrastructure', category: 'infra', tags: ['harbor', 'docker', 'registry'],         usageCount: 29 },
  vm:         { type: 'Infrastructure', category: 'infra', tags: ['vm', 'linux', 'vmaas', 'timeout'],      usageCount: 52 },
  postgres:   { type: 'Data',           category: 'data',  tags: ['postgresql', 'database', 'sql'],        usageCount: 41 },
  mariadb:    { type: 'Data',           category: 'data',  tags: ['mariadb', 'database', 'sql'],           usageCount: 17 },
  mongo:      { type: 'Data',           category: 'data',  tags: ['mongodb', 'database', 'nosql'],         usageCount: 22 },
  redis:      { type: 'Infrastructure', category: 'infra', tags: ['redis', 'cache', 'in-memory'],          usageCount: 33 },
  rabbitmq:   { type: 'Infrastructure', category: 'infra', tags: ['rabbitmq', 'messaging', 'amqp'],        usageCount: 19 },
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
    owner: 'platform-team',
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
  owner: 'platform-team', version: 'v0.1', usageCount: 0, isNew: false,
  duration: '5 min',
});

/* Harbor Pull — pull an image from the registry to a Rancher cluster */
TEMPLATES.push({
  id: 'harbor-pull', enabled: true, type: 'Infrastructure', category: 'infra',
  title: '⚓ Pull image Harbor',
  desc: 'Request to pull an image from the Harbor registry to a Rancher cluster. Automatic Trivy scan and platform-team approval included.',
  tags: ['harbor', 'docker', 'image', 'pull', 'registry'],
  owner: 'platform-team', version: 'v1.2', usageCount: 8, isNew: true,
  action: 'open-image-wizard', wizardType: 'harbor-pull',
});

/* Diode Push — image transfer to an isolated network through a one-way diode */
TEMPLATES.push({
  id: 'diode-push', enabled: true, type: 'Infrastructure', category: 'infra',
  title: '🔒 Push to diode network',
  desc: 'Request a one-way transfer of a Harbor image to a secured diode-protected network. AV + Trivy scan, AES-256 encryption and automatic policy approval.',
  tags: ['harbor', 'docker', 'diode', 'security', 'push', 'isolated'],
  owner: 'platform-team', version: 'v1.0', usageCount: 3, isNew: true,
  action: 'open-image-wizard', wizardType: 'diode-push',
});

/* Request statuses */
const STATUSES = {
  draft:        { label: 'Draft',                  cls: 'status--draft' },
  pending:      { label: 'Pending approval',       cls: 'status--pending' },
  approved:     { label: 'Approved',               cls: 'status--approved' },
  provisioning: { label: 'Provisioning in progress', cls: 'status--running' },
  available:    { label: 'Available',              cls: 'status--available' },
  rejected:     { label: 'Rejected',               cls: 'status--rejected' },
};

const AUTO_APPROVAL_RESOURCE_KEYS = new Set(['postgres', 'mariadb', 'mongo', 'redis', 'rabbitmq']);
const AUTO_APPROVAL_REQUEST_TYPES = new Set(['diode-push']);

/* Simulated provisioning steps.
   `needs` indicates whether the step applies to the request,
   `logs` returns the execution log lines. */
const PROV_STEPS = [
  {
    key: 'rancher', title: 'Create Rancher project',
    needs: r => r.resources.rancher,
    logs: r => [
      ['info', `Connecting to the Rancher API (cluster ${r.env === 'prod' ? 'prod-01' : 'nonprod-02'})...`],
      ['', `Creating project "${r.resources.rancherName || r.name}" and associated namespaces`],
      ['ok', 'CPU/RAM quotas applied · RBAC synchronized'],
    ],
  },
  {
    key: 'harbor', title: 'Create Harbor project',
    needs: r => r.resources.harbor,
    logs: r => [
      ['info', 'Connecting to the Harbor registry...'],
      ['', `Project "${r.name}" created · retention policy: 10 tags`],
      ['ok', 'Vulnerability scanning enabled (Trivy)'],
    ],
  },
  {
    key: 'vm', title: 'Create virtual machines',
    needs: r => r.resources.vm,
    logs: r => {
      const vmSizes = r.vmSizes ?? Array(r.resources.vmCount).fill(r.size);
      const def = RESOURCE_DEFS.vm;
      return [
        ['info', `Provisioning on ${(r.hypervisor && r.hypervisor !== 'auto') ? HYPERVISORS[r.hypervisor].label : 'the automatically selected hypervisor'} · region ${NETWORKS[r.network || 'FR'].label}`],
        ['info', `Cloning ubuntu-22.04 template (${r.resources.vmCount} instance(s))...`],
        ...vmSizes.map((sz, i) => ['', `VM #${i + 1}: size ${sizePlan(def, sz)}`]),
        ['', 'Assigning IP addresses and DNS records'],
        ...vmTimeoutLogLines(r),
        ['ok', `${r.resources.vmCount} VM(s) started · monitoring agent installed`],
      ];
    },
  },
  {
    key: 'db', title: 'Create databases',
    needs: r => r.resources.postgres || r.resources.mariadb || r.resources.mongo,
    logs: r => [
      ['info', 'Provisioning managed instances...'],
      ...(r.resources.postgres ? [['', `PostgreSQL 16 "${r.name}-postgresql" created · daily backup`]] : []),
      ...(r.resources.mariadb  ? [['', `MariaDB 10 "${r.name}-mariadb" created · daily backup`]] : []),
      ...(r.resources.mongo    ? [['', `MongoDB 7 "${r.name}-mongodb" created (replica set × 3)`]] : []),
      ['ok', 'Application accounts generated and stored in the vault'],
    ],
  },
  {
    key: 'messaging', title: 'Deploy messaging and cache services',
    needs: r => r.resources.redis || r.resources.rabbitmq,
    logs: r => [
      ['info', 'Deploying brokers and caches...'],
      ...(r.resources.redis    ? [['', `Redis "${r.name}-redis" deployed · persistence configured`]] : []),
      ...(r.resources.rabbitmq ? [['', `RabbitMQ "${r.name}-rabbitmq" deployed · vhosts and policies applied`]] : []),
      ['ok', 'Messaging services operational'],
    ],
  },
  {
    key: 'services', title: 'Deploy additional services',
    needs: r => r.resources.wiki,
    logs: r => [
      ['info', 'Activating managed services...'],
      ...(r.resources.wiki ? [['', `Wiki "${r.resources.wikiName || r.name + '-wiki'}" created · database and storage initialized`]] : []),
      ['ok', 'Additional services available'],
    ],
  },
  {
    key: 'access', title: 'Configure access',
    needs: () => true,
    logs: r => [
      ['info', `Creating access group "${r.team}"...`],
      ['', 'Propagating roles to Rancher, Harbor and the SSH bastion'],
      ['ok', 'Secrets distributed · single sign-on active'],
    ],
  },
  {
    key: 'finalize', title: 'Finalize project',
    needs: () => true,
    logs: r => [
      ['info', 'Registering entities in the catalog...'],
      ['', 'Generating documentation and dashboards'],
      ['ok', `Project "${r.name}" ready to use 🎉`],
    ],
  },
]
/* Pipeline steps: Harbor image pull → Rancher cluster */
const HARBOR_PULL_STEPS = [
  {
    key: 'auth', title: 'Harbor authentication',
    needs: () => true,
    logs: r => [
      ['info', `Connecting to Harbor registry (project: ${r.harborProject || 'n/a'})...`],
      ['ok', 'JWT token obtained · session established'],
    ],
  },
  {
    key: 'scan', title: 'Trivy vulnerability scan',
    needs: () => true,
    logs: r => [
      ['info', `Analyzing image ${r.imageName || 'n/a'}:${r.imageTag || 'latest'}...`],
      ['', 'Trivy: 0 critical CVEs · 2 minor CVEs (ignored by policy)'],
      ['ok', 'Image approved by security policy'],
    ],
  },
  {
    key: 'pull', title: 'Pull and re-tag',
    needs: () => true,
    logs: r => [
      ['info', `docker pull harbor.internal/${r.harborProject || 'n/a'}/${r.imageName || 'n/a'}:${r.imageTag || 'latest'}...`],
      ['', 'Digest: sha256:a3f8' + Math.random().toString(16).slice(2, 10) + '…'],
      ['', `Re-tag → registry.${r.targetCluster || 'rancher-prod'}/${r.imageName || 'n/a'}:${r.imageTag || 'latest'}`],
      ['ok', 'Image available in the target registry'],
    ],
  },
  {
    key: 'deploy', title: 'Deploy in Rancher',
    needs: () => true,
    logs: r => [
      ['info', `Connecting to cluster "${r.targetCluster || 'rancher-prod'}"...`],
      ['', `Target namespace: ${r.targetNamespace || 'default'}`],
      ['', 'Updating tag in affected deployments...'],
      ['ok', 'Image deployed · rolling update completed'],
    ],
  },
  {
    key: 'notify', title: 'Notification and audit',
    needs: () => true,
    logs: r => [
      ['', 'Event recorded in the Harbor audit log...'],
      ['', `Notification sent to ${r.team} via Teams`],
      ['ok', 'Pull completed — catalog updated'],
    ],
  },
];

/* Pipeline steps: push through one-way diode */
const DIODE_PUSH_STEPS = [
  {
    key: 'preflight', title: 'Security pre-check',
    needs: () => true,
    logs: r => [
      ['info', `Preparing diode transfer for system "${r.targetSystem || 'target-system'}"...`],
      ['', 'Checking requester clearance and audit policy...'],
      ['ok', 'Transfer authorization granted'],
    ],
  },
  {
    key: 'scan', title: 'Antivirus and Trivy scan',
    needs: () => true,
    logs: r => [
      ['info', `Analyzing image ${r.imageName || 'n/a'}:${r.imageTag || 'latest'}...`],
      ['', 'Trivy: 0 critical CVEs · signature verified (Cosign)'],
      ['', 'Antivirus scan (ClamAV): no threat detected'],
      ['ok', 'Image compliant with security requirements'],
    ],
  },
  {
    key: 'export', title: 'Export and packaging',
    needs: () => true,
    logs: r => [
      ['info', 'Extracting image as OCI archive...'],
      ['', `docker save harbor.internal/${r.harborProject || 'n/a'}/${r.imageName || 'n/a'}:${r.imageTag || 'latest'} | gzip`],
      ['', 'Size: ' + (Math.floor(Math.random() * 800 + 100)) + ' MB · SHA-256 hash calculated'],
      ['ok', 'Archive signed and encrypted (AES-256-GCM)'],
    ],
  },
  {
    key: 'transfer', title: 'Transfer through diode',
    needs: () => true,
    logs: r => [
      ['info', 'Connecting to diode transfer gateway (one-way flow)...'],
      ['', `Destination path: ${r.targetPath || '/images'}`],
      ['', 'Transfer in progress (no return flow possible)...'],
      ['ok', 'Archive received on secure side · integrity verified (SHA-256)'],
    ],
  },
  {
    key: 'import', title: 'Import on secure network side',
    needs: () => true,
    logs: r => [
      ['info', `Loading archive on system "${r.targetSystem || 'target-system'}"...`],
      ['', 'docker load < image.tar.gz'],
      ['ok', 'Image available in the isolated registry'],
    ],
  },
  {
    key: 'cleanup', title: 'Audit and cleanup',
    needs: () => true,
    logs: r => [
      ['', 'Deleting temporary archives...'],
      ['', 'Recording entry in the transfer register (compliance)...'],
      ['', `Notification to ${r.team} — transfer completed`],
      ['ok', 'Transfer completed · traceability recorded'],
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
   2. Global State + Persistence
   ============================================================ */

const STORAGE_KEY = 'helios-demo-state-v4';
const now = () => Date.now();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const VM_TIMEOUT_REMINDERS = [45, 30, 15, 1];
const VM_TIMEOUT_DEFAULT_DAYS = 90;
const VM_TIMEOUT_MIN_DAYS = 45;
const VM_TIMEOUT_MAX_DAYS = 365;

/* Initial state: an already populated catalog + credible history */
function defaultState() {
  const t0 = now();
  const hrReadyAt = t0 - 3 * DAY + 2 * HOUR + 4 * MIN;
  const hrVmTimeout = {
    ...defaultVmTimeout(true, 90),
    startedAt: hrReadyAt,
    expiresAt: hrReadyAt + 90 * DAY,
  };
  return {
    nextRequestNum: 1042,
    entities: [
      { name: 'customer-portal', kind: 'Component', type: 'website', owner: 'web-team',
        lifecycle: 'production', system: 'customer-experience', tags: ['react', 'cdn'],
        description: 'Web portal for end customers.', createdAt: t0 - 90 * DAY },
      { name: 'billing-api', kind: 'Component', type: 'service', owner: 'finance-team',
        lifecycle: 'production', system: 'billing', tags: ['java', 'rest'],
        description: 'API for invoice and payment management.', createdAt: t0 - 120 * DAY },
      { name: 'auth-service', kind: 'Component', type: 'service', owner: 'platform-team',
        lifecycle: 'production', system: 'platform-core', tags: ['go', 'oidc'],
        description: 'Central authentication service (OIDC).', createdAt: t0 - 200 * DAY },
      { name: 'notifications-worker', kind: 'Component', type: 'service', owner: 'web-team',
        lifecycle: 'experimental', system: 'customer-experience', tags: ['python', 'rabbitmq'],
        description: 'Asynchronous processing for customer notifications.', createdAt: t0 - 20 * DAY },
      { name: 'data-warehouse', kind: 'Resource', type: 'database', owner: 'data-team',
        lifecycle: 'production', system: 'data', tags: ['postgresql'],
        description: 'Shared analytics data warehouse.', createdAt: t0 - 150 * DAY },
      { name: 'cluster-rancher-prod', kind: 'Resource', type: 'rancher-project', owner: 'platform-team',
        lifecycle: 'production', system: 'platform-core', tags: ['kubernetes'],
        description: 'Production Kubernetes cluster managed by Rancher.', createdAt: t0 - 300 * DAY },
      { name: 'registry-harbor', kind: 'Resource', type: 'harbor-project', owner: 'platform-team',
        lifecycle: 'production', system: 'platform-core', tags: ['harbor', 'docker'],
        description: 'Central image registry with vulnerability scanning.', createdAt: t0 - 300 * DAY },
      { name: 'hr-portal', kind: 'Component', type: 'service', owner: 'web-team',
        lifecycle: 'staging', system: 'human-resources', tags: ['staging', 'size-m'],
        description: 'Project provisioned through request REQ-1037.', createdAt: t0 - 3 * DAY, fromRequest: 'REQ-1037' },
      { name: 'hr-portal-rancher', kind: 'Resource', type: 'rancher-project', owner: 'web-team',
        lifecycle: 'staging', system: 'human-resources', tags: ['kubernetes'],
        description: 'Rancher project "hr-portal" (namespaces and quotas) for project hr-portal.',
        createdAt: hrReadyAt, fromRequest: 'REQ-1037' },
      { name: 'hr-portal-postgresql', kind: 'Resource', type: 'database', owner: 'web-team',
        lifecycle: 'staging', system: 'human-resources', tags: ['postgresql'],
        description: 'Managed PostgreSQL database for project hr-portal.', createdAt: t0 - 3 * DAY, fromRequest: 'REQ-1037' },
      { name: 'hr-portal-vms', kind: 'Resource', type: 'virtual-machine', owner: 'web-team',
        lifecycle: 'staging', system: 'human-resources', tags: ['x1', 'm', 'vmware', 'lease-90d', 'auto-delete'],
        description: '1 VMware virtual machine for hr-portal. Time-limited workload with auto-delete after 90 days.',
        createdAt: hrReadyAt, fromRequest: 'REQ-1037',
        expiresAt: hrVmTimeout.expiresAt,
        timeout: { resource: 'vm', durationDays: 90, reminderDays: [...VM_TIMEOUT_REMINDERS], autoDelete: true } },
    ],
    requests: [
      {
        id: 'REQ-1037', name: 'hr-portal', team: 'web-team', requester: 'Mary Lambert',
        description: 'Redesign of the internal HR portal (time off, expenses).',
        env: 'staging', size: 'M',
        network: 'FR', hypervisor: 'vmware',
        resources: { rancher: true, harbor: false, vm: true, vmCount: 1, postgres: true, mongo: false },
        timeouts: { vm: hrVmTimeout },
        status: 'available', createdAt: t0 - 3 * DAY,
        comment: 'Approved for staging. Plan a dedicated request for production.',
        history: [
          { ts: t0 - 3 * DAY, label: 'Request submitted by Mary Lambert' },
          { ts: t0 - 3 * DAY + 2 * HOUR, label: 'Approved by Anthony Durand' },
          { ts: hrReadyAt, label: 'Provisioning completed — resources available' },
          { ts: hrReadyAt, label: 'VM timeout scheduled — reminders at D-45, D-30, D-15 and D-1 before auto-delete' },
        ],
        prov: null,
      },
      {
        id: 'REQ-1039', name: 'data-sandbox', team: 'data-team', requester: 'Karim Benali',
        description: 'Sandbox for scoring model tests.',
        env: 'dev', size: 'L',
        network: 'IT', hypervisor: 'hyperv',
        resources: { rancher: true, harbor: true, vm: true, vmCount: 4, postgres: false, mongo: true },
        status: 'rejected', createdAt: t0 - DAY,
        comment: 'Sizing is too large for a sandbox: please switch to size S and use the shared data offer.',
        history: [
          { ts: t0 - DAY, label: 'Request submitted by Karim Benali' },
          { ts: t0 - DAY + 5 * HOUR, label: 'Rejected by Anthony Durand' },
        ],
        prov: null,
      },
    ],
    activity: [
      { ts: t0 - 3 * DAY, icon: '📨', text: 'Mary Lambert submitted request REQ-1037 (hr-portal).' },
      { ts: t0 - 3 * DAY + 2 * HOUR, icon: '✅', text: 'Anthony Durand approved request REQ-1037.' },
      { ts: hrReadyAt, icon: '🚀', text: 'Provisioning for hr-portal completed: 4 resources created.' },
      { ts: hrReadyAt, icon: '⏱', text: 'VM timeout for hr-portal scheduled: auto-delete after 90 days with reminders at D-45, D-30, D-15 and D-1.' },
      { ts: t0 - DAY + 5 * HOUR, icon: '⛔', text: 'Anthony Durand rejected request REQ-1039 (data-sandbox).' },
    ],
  };
}

function clampVmTimeoutDays(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return VM_TIMEOUT_DEFAULT_DAYS;
  return Math.max(VM_TIMEOUT_MIN_DAYS, Math.min(VM_TIMEOUT_MAX_DAYS, n));
}

function defaultVmTimeout(enabled = true, days = VM_TIMEOUT_DEFAULT_DAYS) {
  return {
    enabled,
    durationDays: clampVmTimeoutDays(days),
    reminderDays: [...VM_TIMEOUT_REMINDERS],
  };
}

function normalizeVmTimeout(timeout, enabledFallback = false) {
  const t = timeout || defaultVmTimeout(enabledFallback);
  t.enabled = !!t.enabled;
  t.durationDays = clampVmTimeoutDays(t.durationDays);
  t.reminderDays = [...VM_TIMEOUT_REMINDERS];
  if (t.startedAt) t.startedAt = Number(t.startedAt);
  if (t.expiresAt) t.expiresAt = Number(t.expiresAt);
  if (Array.isArray(t.scheduledReminders)) {
    t.scheduledReminders = t.scheduledReminders.map(x => ({
      daysBefore: Number(x.daysBefore),
      notifyAt: Number(x.notifyAt),
    }));
  }
  return t;
}

function ensureVmTimeout(req, enabledFallback = true) {
  if (!req.timeouts) req.timeouts = {};
  req.timeouts.vm = normalizeVmTimeout(req.timeouts.vm, enabledFallback);
  return req.timeouts.vm;
}

function migrateState(s) {
  if (!s || !Array.isArray(s.entities) || !Array.isArray(s.requests)) return defaultState();
  s.requests.forEach(r => {
    if (r.requestType === 'harbor-pull' || r.requestType === 'diode-push') return;
    if (r.resources?.vm) ensureVmTimeout(r, false);
  });
  migrateAutoApprovedRequests(s);
  migrateSeededHrPortal(s);
  s.entities.forEach(e => {
    if (e.expiresAt && !e.timeout && e.type === 'virtual-machine') {
      e.timeout = { resource: 'vm', durationDays: VM_TIMEOUT_DEFAULT_DAYS, reminderDays: [...VM_TIMEOUT_REMINDERS], autoDelete: true };
    }
  });
  return s;
}

function migrateAutoApprovedRequests(s) {
  const ts = now();
  s.requests.forEach(r => {
    if (r.status !== 'pending' || !isAutoApprovedRequest(r)) return;

    const policy = autoApprovalLabel(r);
    r.status = 'approved';
    if (!r.comment) r.comment = `${policy}: auto-approved.`;
    r.history = r.history || [];
    if (!r.history.some(h => String(h.label || '').includes('auto-approved'))) {
      r.history.push({ ts, label: `${policy}: auto-approved — no manual approval required` });
    }
    if (Array.isArray(s.activity) && !s.activity.some(a => String(a.text || '').includes(`auto-approved request ${r.id}`))) {
      s.activity.unshift({ ts, icon: '✅', text: `${policy} auto-approved request ${r.id} (${r.name}).` });
    }
  });
}

function migrateSeededHrPortal(s) {
  const req = s.requests.find(r => r.id === 'REQ-1037' && r.name === 'hr-portal' && r.status === 'available');
  if (!req?.resources?.vm) return;

  const readyAt = req.history?.find(h => String(h.label || '').includes('Provisioning completed'))?.ts
    || req.createdAt + 2 * HOUR + 4 * MIN;
  req.timeouts = req.timeouts || {};
  if (!req.timeouts.vm?.enabled) {
    req.timeouts.vm = {
      ...defaultVmTimeout(true, 90),
      startedAt: readyAt,
      expiresAt: readyAt + 90 * DAY,
    };
  }
  if (!req.history?.some(h => String(h.label || '').includes('VM timeout scheduled'))) {
    req.history = req.history || [];
    req.history.push({ ts: readyAt, label: 'VM timeout scheduled — reminders at D-45, D-30, D-15 and D-1 before auto-delete' });
  }
  if (Array.isArray(s.activity) && !s.activity.some(a => String(a.text || '').includes('VM timeout for hr-portal scheduled'))) {
    s.activity.push({
      ts: readyAt,
      icon: '⏱',
      text: 'VM timeout for hr-portal scheduled: auto-delete after 90 days with reminders at D-45, D-30, D-15 and D-1.',
    });
  }

  const hasEntity = name => s.entities.some(e => e.name === name);
  if (!hasEntity('hr-portal-rancher')) {
    s.entities.unshift({
      name: 'hr-portal-rancher', kind: 'Resource', type: 'rancher-project', owner: 'web-team',
      lifecycle: 'staging', system: 'human-resources', tags: ['kubernetes'],
      description: 'Rancher project "hr-portal" (namespaces and quotas) for project hr-portal.',
      createdAt: readyAt, fromRequest: 'REQ-1037',
    });
  }
  if (!hasEntity('hr-portal-vms')) {
    s.entities.unshift({
      name: 'hr-portal-vms', kind: 'Resource', type: 'virtual-machine', owner: 'web-team',
      lifecycle: 'staging', system: 'human-resources', tags: ['x1', 'm', 'vmware', 'lease-90d', 'auto-delete'],
      description: '1 VMware virtual machine for hr-portal. Time-limited workload with auto-delete after 90 days.',
      createdAt: readyAt, fromRequest: 'REQ-1037',
      expiresAt: req.timeouts.vm.expiresAt,
      timeout: { resource: 'vm', durationDays: 90, reminderDays: [...VM_TIMEOUT_REMINDERS], autoDelete: true },
    });
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateState(JSON.parse(raw));
  } catch (e) { /* unavailable or corrupted storage: restart from scratch */ }
  return migrateState(defaultState());
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode, etc. */ }
}

let state = loadState();

/* UI state (not persisted): current page for each pane + wizard */
const ui = {
  user:  { page: 'catalog', entity: null, request: null, filterKind: 'all', filterOwner: 'all', search: '', templateSearch: '', templateCategory: 'all' },
  admin: { page: 'inbox', request: null, filter: 'all' },
  wizard: null, // created when opening a template
};

/* ============================================================
   3. Utilities
   ============================================================ */

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function euro(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' €';
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(ts) {
  const d = now() - ts;
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  return `${Math.floor(d / DAY)} d ago`;
}

function clock() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function fmtDateOnly(ts) {
  return new Date(ts).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(ts) {
  return Math.ceil((ts - now()) / DAY);
}

function relativeExpiry(ts) {
  const d = daysUntil(ts);
  if (d < 0) return `expired ${Math.abs(d)} d ago`;
  if (d === 0) return 'expires today';
  if (d === 1) return 'expires tomorrow';
  return `expires in ${d} d`;
}

function vmReminderText() {
  return 'D-45, D-30, D-15 and D-1';
}

function vmReminderChips() {
  return VM_TIMEOUT_REMINDERS
    .map(d => `<span class="lease-reminder-chip">D-${d}</span>`)
    .join('');
}

function getVmTimeout(req) {
  return req?.timeouts?.vm || null;
}

function hasVmTimeout(req) {
  return !!(req?.resources?.vm && getVmTimeout(req)?.enabled);
}

function vmTimeoutDays(req) {
  return clampVmTimeoutDays(getVmTimeout(req)?.durationDays);
}

function vmTimeoutValueHtml(req) {
  if (!req?.resources?.vm) return '<span class="muted">—</span>';
  if (!hasVmTimeout(req)) return '<span class="muted">No timeout</span>';
  const timeout = getVmTimeout(req);
  const deleteLabel = timeout.expiresAt
    ? `auto-delete on <strong>${fmtDateOnly(timeout.expiresAt)}</strong>`
    : 'auto-delete after provisioning';
  return `${vmTimeoutDays(req)} days · ${deleteLabel}<br><span class="muted">Reminders: ${vmReminderText()} before deletion</span>`;
}

function vmTimeoutTableCell(req) {
  if (!req?.resources?.vm) return '<span class="muted">—</span>';
  if (!hasVmTimeout(req)) return '<span class="muted">No timeout</span>';
  const timeout = getVmTimeout(req);
  const detail = timeout.expiresAt ? relativeExpiry(timeout.expiresAt) : `${vmTimeoutDays(req)} d lease`;
  return `<span class="chip chip--warning">${esc(detail)}</span>`;
}

function entityLeaseChip(e) {
  if (!e.expiresAt) return '';
  const d = daysUntil(e.expiresAt);
  const cls = d <= 1 ? 'chip--danger' : d <= 15 ? 'chip--warning' : 'chip--info';
  return `<span class="chip ${cls}">${esc(relativeExpiry(e.expiresAt))}</span>`;
}

function entityTimeoutRows(e) {
  if (!e.expiresAt) return '';
  const reminders = e.timeout?.reminderDays?.length ? vmReminderText() : '—';
  return `
    <div><span class="label">Expiration</span><span class="value">${fmtDateOnly(e.expiresAt)} · ${esc(relativeExpiry(e.expiresAt))}</span></div>
    <div><span class="label">Auto-delete</span><span class="value">Enabled</span></div>
    <div class="kv--full"><span class="label">Reminder schedule</span><span class="value">${reminders} before deletion</span></div>`;
}

function vmTimeoutLogLines(req) {
  if (!hasVmTimeout(req)) return [];
  const timeout = getVmTimeout(req);
  const deleteLabel = timeout.expiresAt ? fmtDateOnly(timeout.expiresAt) : `${vmTimeoutDays(req)} days after availability`;
  return [
    ['info', `VM lease timeout enabled: ${vmTimeoutDays(req)} days · auto-delete ${deleteLabel}`],
    ['', `Reminder notifications scheduled for requester and team: ${vmReminderText()} before deletion`],
  ];
}

/* Temporary notification (snackbar) in one of the two panes */
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

/* Default custom specification per resource */
const DEFAULT_CUSTOM = { cpu: 2, ram: 4, storage: 20 };

/* Custom specification for a resource (key: resource name, or "vm:<index>") */
function specFor(req, key) {
  return (req.customSpecs && req.customSpecs[key]) || DEFAULT_CUSTOM;
}

/* Simulated custom price based on selected unit resources */
function customPrice(c) {
  return Math.round((c?.cpu ?? 0) * 12 + (c?.ram ?? 0) * 6 + (c?.storage ?? 0) * 0.2);
}

/* Monthly price of a sized resource for a given size */
function sizePrice(def, sz, custom) {
  if (sz === 'custom') return customPrice(custom);
  return def.prices?.[sz] ?? def.base;
}

/* Size/plan label for a resource at a given size */
function sizePlan(def, sz) {
  if (sz === 'custom') return 'Custom';
  return def.planLabels?.[sz] ?? sz;
}

/* Estimated monthly request cost (simulated prices, excl. tax) */
function computeCost(req) {
  if (req.requestType === 'harbor-pull' || req.requestType === 'diode-push') return { lines: [], total: 0 };
  const r = req.resources;
  const rs = req.resourceSizes ?? {};
  const globalSize = req.size ?? 'S';
  const getSize = key => rs[key] ?? globalSize;
  const lines = [];
  if (r.rancher) {
    lines.push(['Rancher Project (K8s)', RESOURCE_DEFS.rancher.base]);
  }
  if (r.harbor) {
    const gb = r.registryGb ?? 10;
    lines.push([`Harbor Registry (${gb} GB)`, gb]);
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
  if (r.wiki)       lines.push(['Wiki', RESOURCE_DEFS.wiki.base]);
  const total = Math.round(lines.reduce((s, l) => s + l[1], 0));
  return { lines, total };
}

/* Human-readable request resource list */
function resourceSummary(req) {
  if (req.requestType === 'harbor-pull')
    return [`⚓ Pull: ${req.imageName || '?'}:${req.imageTag || 'latest'} → ${req.targetCluster || '?'}`];
  if (req.requestType === 'diode-push')
    return [`🔒 Push: ${req.imageName || '?'}:${req.imageTag || 'latest'} → ${req.targetSystem || '?'}`];
  const r = req.resources;
  const out = [];
  if (r.rancher)    out.push(`Rancher Project${r.rancherName ? ` (${r.rancherName})` : ''}`);
  if (r.harbor)     out.push(`Harbor Registry (${r.registryGb ?? 10} GB)`);
  if (r.vm)         out.push(`${r.vmCount} VM${hasVmTimeout(req) ? ` (${vmTimeoutDays(req)} d lease)` : ''}`);
  if (r.postgres)   out.push('PostgreSQL');
  if (r.mariadb)    out.push('MariaDB');
  if (r.mongo)      out.push('MongoDB');
  if (r.redis)      out.push('Redis');
  if (r.rabbitmq)   out.push('RabbitMQ');
  if (r.wiki)       out.push(`Wiki${r.wikiName ? ` (${r.wikiName})` : ''}`);
  return out;
}

function requestedResourceKeys(req) {
  const resources = req.resources || {};
  return ['rancher', 'harbor', 'vm', 'postgres', 'mariadb', 'mongo', 'redis', 'rabbitmq', 'wiki']
    .filter(key => resources[key]);
}

function isAutoApprovedRequest(req) {
  if (AUTO_APPROVAL_REQUEST_TYPES.has(req.requestType)) return true;
  if (req.requestType) return false;

  const keys = requestedResourceKeys(req);
  return keys.length > 0 && keys.every(key => AUTO_APPROVAL_RESOURCE_KEYS.has(key));
}

function autoApprovalLabel(req) {
  if (req.requestType === 'diode-push') return 'Diode transfer policy';
  return 'Data/cache/messaging service policy';
}

function submitRequest(req, activityText) {
  const autoApproved = isAutoApprovedRequest(req);
  state.requests.unshift(req);
  logActivity('📨', activityText);

  if (autoApproved) {
    const policy = autoApprovalLabel(req);
    req.status = 'approved';
    req.comment = `${policy}: auto-approved.`;
    req.history.push({ ts: now(), label: `${policy}: auto-approved — no manual approval required` });
    logActivity('✅', `${policy} auto-approved request ${req.id} (${req.name}).`);
  }

  saveState();
  if (autoApproved) setTimeout(() => startProvisioning(req.id), 650);
  return autoApproved;
}

/* ---- Capacity & Feasibility (Ops governance plugin logic) ---- */

/* Footprint of a size (or custom specification) */
function footprintForSize(sz, custom) {
  if (sz === 'custom') {
    const c = custom || DEFAULT_CUSTOM;
    return { cpu: c.cpu || 0, ram: c.ram || 0, storage: c.storage || 0 };
  }
  return SIZE_FOOTPRINT[sz] || SIZE_FOOTPRINT.S;
}

/* Total footprint for a request: compute resources (region) + VM subtotal (hypervisor) */
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

/* Should the feasibility block be shown? (at least one compute resource) */
function feasShouldShow(req) {
  const f = computeFootprint(req).total;
  return !!(f.cpu || f.ram || f.storage);
}

/* Existing committed load in a region (baseline + active requests), excluding the current request */
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

/* Assess a request against available capacity */
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
   4. Small Reusable HTML Components
   ============================================================ */

function statusChip(key) {
  const s = STATUSES[key] || STATUSES.draft;
  return `<span class="status ${s.cls}">${s.label}</span>`;
}

function chips(tags, cls = '') {
  return (tags || []).map(t => `<span class="chip ${cls}">${esc(t)}</span>`).join('');
}


/* Backstage-style page header: breadcrumbs + title + metadata */
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

/* Formatted number (thousands separator) */
function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }

/* Capacity bar: existing load + request, against total capacity */
function capRow(label, unit, pool, used, req) {
  const over = used + req > pool;
  const usedW = Math.min(100, used / pool * 100);
  const reqW = Math.max(0, Math.min(100 - usedW, req / pool * 100));
  const free = Math.max(0, pool - used);
  return `
    <div class="cap-row">
      <div class="cap-row__label">
        <span>${label}</span>
        <span>request <strong style="color:${over ? 'var(--bs-error)' : 'var(--bs-text)'}">${fmtNum(req)} ${unit}</strong>
          · free ${fmtNum(free)} / ${fmtNum(pool)} ${unit}</span>
      </div>
      <div class="cap-bar" title="${fmtNum(used)} ${unit} used · ${fmtNum(req)} ${unit} requested · ${fmtNum(pool)} ${unit} total">
        <div class="cap-bar__seg cap-bar__used" style="width:${usedW}%"></div>
        <div class="cap-bar__seg cap-bar__req ${over ? 'cap-bar__req--over' : ''}" style="width:${reqW}%"></div>
      </div>
      ${over ? `<div class="cap-over">⛔ Over by ${fmtNum(used + req - pool)} ${unit}</div>` : ''}
    </div>`;
}

function capPool(name, pool, used, req) {
  return `
    <div class="cap-pool">
      <div class="cap-pool__name">${name}</div>
      ${capRow('vCPU', 'vCPU', pool.cpu, used.cpu, req.cpu)}
      ${capRow('Memory', 'GB', pool.ram, used.ram, req.ram)}
      ${capRow('Storage', 'GB', pool.storage, used.storage, req.storage)}
    </div>`;
}

/* "Capacity & feasibility" card (Ops view) or compact preview (wizard) */
function feasibilityCard(req, opts = {}) {
  const a = assessFeasibility(req);
  const netLabel = `${NETWORKS[a.net].flag} ${NETWORKS[a.net].label}`;
  const v = {
    ok:    ['cap-verdict--ok',    '✅ Feasible'],
    tight: ['cap-verdict--tight', '⚠️ Tight capacity'],
    no:    ['cap-verdict--no',    '⛔ Insufficient'],
  }[a.level];
  const hvName = a.hv
    ? (a.hv.key === 'auto' ? 'All hypervisors (auto placement)' : `${HYPERVISORS[a.hv.key].icon} ${HYPERVISORS[a.hv.key].label}`)
    : null;
  const meta = `
    <div class="cap-head">
      <div class="muted">Target: <strong style="color:var(--bs-text)">${netLabel}</strong>${hvName ? ` · ${hvName}` : ''}</div>
      <div class="muted" style="margin-top:4px;">Footprint: <strong style="color:var(--bs-text)">${fmtNum(a.fp.total.cpu)} vCPU</strong> · <strong style="color:var(--bs-text)">${fmtNum(a.fp.total.ram)} GB RAM</strong> · <strong style="color:var(--bs-text)">${fmtNum(a.fp.total.storage)} GB storage</strong></div>
    </div>`;
  const bars = `
    <div class="cap-legend">
      <span class="lg-used">Existing load</span>
      <span class="lg-req">This request</span>
      <span class="lg-free">Available</span>
    </div>
    <div class="cap">
      ${capPool(`Region pool — ${NETWORKS[a.net].label}`, a.region.pool, a.region.used, a.region.req)}
      ${a.hv ? capPool(`Hypervisor pool — ${a.hv.key === 'auto' ? 'aggregated' : HYPERVISORS[a.hv.key].label}`, a.hv.pool, a.hv.used, a.hv.req) : ''}
    </div>
    ${a.level === 'no' ? `<div class="banner banner--error" style="margin:14px 0 0;">⛔ <span>Insufficient capacity on <strong>${netLabel}</strong>. Reduce sizing or VM count, or change region / hypervisor.</span></div>` : ''}
    ${a.level === 'tight' ? `<div class="banner banner--warning" style="margin:14px 0 0;">⚠️ <span>Feasible, but consumes a large share of remaining capacity.</span></div>` : ''}`;

  if (opts.compact) {
    return `
      <div class="cap-card cap-card--inline">
        <div class="cap-card__bar"><span class="card__title" style="font-size:14px;">Feasibility</span><span class="cap-verdict ${v[0]}">${v[1]}</span></div>
        ${meta}${bars}
      </div>`;
  }
  return `
    <div class="card">
      <div class="card__header">
          <div><span class="card__title">Capacity &amp; feasibility</span>
          <div class="card__subtitle">Ops plugin — infrastructure inventory (simulated)</div></div>
        <span class="cap-verdict ${v[0]}">${v[1]}</span>
      </div>
      <div class="card__body">${meta}${bars}</div>
    </div>`;
}

/* ============================================================
   5. User View
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

/* ---- 5.1 Catalog ---- */
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
          ${e.fromRequest && isRecent(e) ? '<span class="chip chip--new">New</span>' : ''}
          ${entityLeaseChip(e)}</td>
      <td class="cell-secondary">${esc(e.system || '—')}</td>
      <td><a>${esc(e.owner)}</a></td>
      <td class="cell-secondary">${esc(e.type)}</td>
      <td class="cell-secondary">${esc(e.lifecycle)}</td>
      <td class="cell-secondary">${esc(e.description)}</td>
      <td>${chips(e.tags)}</td>
    </tr>`).join('');

  return `
    ${pageHeader('user', {
      title: 'Hybrid Demand Cloud',
      subtitle: 'Software Catalog · company components, resources and APIs',
      meta: [['Mode', 'mockup'], ['Entities', String(state.entities.length)]],
    })}
    <div class="content content--with-filters">
      <aside class="filters card" style="padding:14px;">
        <div class="filter-group">
          <span class="label">Entity type</span>
          ${[['all', 'All'], ['Component', 'Components'], ['Resource', 'Resources']].map(([k, lbl]) => `
            <div class="filter-option ${f.filterKind === k ? 'is-active' : ''}" data-action="filter-kind" data-arg="${k}">
              <span>${lbl}</span><span class="count">${countBy(k)}</span>
            </div>`).join('')}
        </div>
        <div class="filter-group">
          <span class="label">Owner</span>
          <div class="filter-option ${f.filterOwner === 'all' ? 'is-active' : ''}" data-action="filter-owner" data-arg="all"><span>All</span></div>
          ${owners.map(o => `
            <div class="filter-option ${f.filterOwner === o ? 'is-active' : ''}" data-action="filter-owner" data-arg="${esc(o)}">
              <span>${esc(o)}</span>
            </div>`).join('')}
        </div>
      </aside>

      <div class="card">
        <div class="table-toolbar">
          <span class="table-toolbar__count">${list.length} entit${list.length === 1 ? 'y' : 'ies'}</span>
          <span class="table-toolbar__spacer"></span>
          <label class="search-field">
            <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
            <input type="text" id="catalog-search" placeholder="Filter" value="${esc(f.search)}" data-input="catalog-search">
          </label>
          <button class="btn btn--primary" data-action="goto-create">+ Create</button>
        </div>
        <div class="table-wrap">
          ${list.length ? `
          <table class="bs-table">
            <thead><tr>
              <th>Name</th><th>System</th><th>Owner</th><th>Type</th>
              <th>Lifecycle</th><th>Description</th><th>Tags</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>` : emptyState('🔭', 'No entities found', 'Adjust your filters or create a new component from a template.')}
        </div>
      </div>
    </div>`;
}

function isRecent(e) { return now() - e.createdAt < 2 * HOUR; }

/* ---- 5.2 Entity page ---- */
function userEntityPage() {
  const e = state.entities.find(x => x.name === ui.user.entity);
  if (!e) { ui.user.page = 'catalog'; return userCatalogPage(); }
  const req = e.fromRequest ? state.requests.find(r => r.id === e.fromRequest) : null;
  const related = e.fromRequest ? state.entities.filter(x => x.fromRequest === e.fromRequest && x.name !== e.name) : [];

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'Catalog', action: 'goto-catalog' }, { label: e.name }],
      title: e.name,
      subtitle: `${e.kind} — ${esc(e.type)}`,
      meta: [['Owner', esc(e.owner)], ['Lifecycle', esc(e.lifecycle)]],
    })}
    <div class="tabs">
      <button class="tab is-active">Overview</button>
      <button class="tab" data-action="not-included">CI/CD</button>
      <button class="tab" data-action="not-included">Dependencies</button>
      <button class="tab" data-action="not-included">Docs</button>
    </div>
    <div class="content">
      <div class="card">
        <div class="card__header"><span class="card__title">About</span>
          <button class="btn btn--text" data-action="not-included">Edit</button></div>
        <div class="card__body">
          <div class="kv-grid">
            <div class="kv--full"><span class="label">Description</span><span class="value">${esc(e.description)}</span></div>
            <div><span class="label">Owner</span><span class="value"><a>${esc(e.owner)}</a></span></div>
            <div><span class="label">System</span><span class="value">${esc(e.system || '—')}</span></div>
            <div><span class="label">Type</span><span class="value">${esc(e.type)}</span></div>
            <div><span class="label">Lifecycle</span><span class="value">${esc(e.lifecycle)}</span></div>
            ${entityTimeoutRows(e)}
            <div class="kv--full"><span class="label">Tags</span><span class="value">${chips(e.tags) || '—'}</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__header"><span class="card__title">Service health</span></div>
        <div class="card__body">
          <div class="kv-grid">
            <div><span class="label">Availability (30 d)</span><span class="value" style="color:#14632f;font-weight:700;">99.95%</span></div>
            <div><span class="label">Status</span><span class="value"><span class="status status--available">Operational</span></span></div>
            <div><span class="label">Open incidents</span><span class="value">0</span></div>
            ${req ? `<div><span class="label">Source request</span><span class="value"><a data-action="open-request" data-arg="${esc(req.id)}">${esc(req.id)}</a></span></div>` : ''}
          </div>
        </div>
      </div>

      ${related.length ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Related project resources</span></div>
        <div class="card__body--flush table-wrap">
          <table class="bs-table">
            <thead><tr><th>Name</th><th>Type</th><th>Lifecycle</th><th>Description</th></tr></thead>
            <tbody>
              ${related.map(x => `
                <tr class="is-clickable" data-action="open-entity" data-arg="${esc(x.name)}">
                  <td><span class="cell-name">${esc(x.name)}</span></td>
                  <td class="cell-secondary">${esc(x.type)}</td>
                  <td class="cell-secondary">${esc(x.lifecycle)} ${entityLeaseChip(x)}</td>
                  <td class="cell-secondary">${esc(x.description)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
}

/* ---- 5.3 "Create..." page: template gallery ---- */
function userTemplatesPage() {
  const search = ui.user.templateSearch || '';
  const cat = ui.user.templateCategory || 'all';
  const CAT_COLORS = { infra: '#134a7c', app: '#1a6b3a', data: '#7b3a0e', docs: '#4a1a7c' };
  const TPL_CATS = [
    ['all', 'All'], ['infra', 'Infrastructure'], ['app', 'Application'],
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
          ${t.isNew ? '<span class="tpl-card__badge">New</span>' : ''}
        </div>
        <div class="tpl-card__body">
          <p class="tpl-card__desc">${esc(t.desc)}</p>
          <div class="tpl-card__tags">${chips(t.tags, 'chip--outline')}</div>
        </div>
        <div class="tpl-card__meta">
          <span class="tpl-card__meta-item">👤 ${esc(t.owner)}</span>
          <span class="tpl-card__meta-item">${esc(t.version)}</span>
          <span class="tpl-card__meta-item">🔧 ${t.usageCount} uses</span>
          ${t.duration ? `<span class="tpl-card__meta-item">⏱ ${esc(t.duration)}</span>` : ''}
        </div>
        <div class="tpl-card__foot">
          <button class="btn ${t.enabled ? 'btn--primary' : 'btn--outline'}"
                  data-action="${t.enabled ? (t.action || 'open-wizard') : 'not-included'}"
                  data-arg="${t.enabled ? (t.wizardType || t.resourceKey || '') : ''}">
            ${t.enabled ? 'Choose' : 'Coming soon'}
          </button>
        </div>
      </article>`;
  };
  return `
    ${pageHeader('user', {
      title: 'Create a new component',
      subtitle: 'Software Templates · start a project from a platform-team approved template',
    })}
    <div class="tabs">
      <button class="tab is-active">Templates</button>
      <button class="tab" data-action="not-included">Tasks</button>
    </div>
    <div class="tpl-toolbar">
      <div class="tpl-cats">
        ${TPL_CATS.map(([k, lbl]) => `
          <button class="tpl-cat-btn ${cat === k ? 'is-active' : ''}" data-action="tpl-category" data-arg="${k}">${lbl}</button>`).join('')}
      </div>
      <label class="search-field">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
        <input type="text" placeholder="Search templates..." value="${esc(search)}" data-input="tpl-search">
      </label>
    </div>
    <div class="content">
      ${filtered.length ? '<div class="banner banner--info">ℹ️ <span>Templates automatically apply company standards for security, naming and monitoring.</span></div>' : ''}
      ${filtered.length
        ? `<div class="cards-grid">${filtered.map(card).join('')}</div>`
        : emptyState('🔍', 'No templates found', 'Adjust your search or select another category.')}
    </div>`;
}

/* ---- 5.4 Multi-step wizard (Software Template) ---- */

const WIZARD_STEPS = ['Information', 'Environment', 'Resources', 'Sizing', 'Summary', 'Submit'];

function newWizard(resourceKey) {
  const isBundle = !resourceKey;
  const def = resourceKey ? RESOURCE_DEFS[resourceKey] : null;
  const isAutoTemplate = resourceKey && AUTO_APPROVAL_RESOURCE_KEYS.has(resourceKey);
  return {
    step: 0,
    error: '',
    sentRequestId: null,
    resourceKey:      resourceKey || null,
    templateTitle:    isBundle ? 'Bundle' : (def.icon + ' ' + def.label),
    templateSubtitle: isBundle
      ? 'Template managed by platform-team · v2.4'
      : `Individual provisioning · ${isAutoTemplate ? 'auto-approved' : 'platform-team'} · v1.0`,
    data: {
      name: '', team: TEAMS[0], description: '',
      env: 'dev', size: 'S',
      network: 'FR', hypervisor: 'auto',
      customSpecs: {},
      resourceSizes: { vm: 'S', postgres: 'S', mariadb: 'S', mongo: 'S', redis: 'S', rabbitmq: 'S' },
      vmSizes: resourceKey === 'vm' ? ['S'] : ['S', 'S'],
      timeouts: { vm: defaultVmTimeout(true, VM_TIMEOUT_DEFAULT_DAYS) },
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
        wiki:            resourceKey === 'wiki',
        wikiName:        '',
      },
    },
  };
}

const IMAGE_WIZARD_STEPS = {
  'harbor-pull': ['Identification', 'Source image', 'Destination', 'Summary', 'Submit'],
  'diode-push':  ['Identification', 'Source image', 'Destination', 'Summary', 'Submit'],
};

function newImageWizard(type) {
  const meta = {
    'harbor-pull': { title: '⚓ Pull image Harbor', subtitle: 'Image pull · platform-team · v1.2' },
    'diode-push':  { title: '🔒 Push to diode network', subtitle: 'Secure diode transfer · auto-approved · v1.0' },
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
      targetSystem: '', targetPath: '/images',
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
  const pushFns = [imgWizStepId, imgWizStepImage, imgWizStepDiode, imgWizSummaryPush, imgWizConfirm];
  const bodyFns = w.wizardType === 'harbor-pull' ? pullFns : pushFns;
  const body = (bodyFns[w.step] || (() => ''))();

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'Create...', action: 'goto-create' }, { label: w.templateTitle }],
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
                ? '<button class="btn btn--text" data-action="img-wiz-prev">Previous</button>'
                : '<button class="btn btn--text" data-action="goto-create">Cancel</button>'}
            </div>
            <div>
              ${isSummary
                ? '<button class="btn btn--success" data-action="img-wiz-submit">📨 Submit request</button>'
                : '<button class="btn btn--primary" data-action="img-wiz-next">Next</button>'}
            </div>
          </div>`}
        </div>
      </div>
    </div>`;
}

/* ---- Image wizard steps ---- */

function imgWizStepId() {
  const d = ui.wizard.data;
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Request identification</h3>
      <div class="form-row">
        <label class="field-label">Requesting team</label>
        <select class="field-select" data-input="img-wiz-team">
          ${TEAMS.map(t => `<option value="${esc(t)}" ${d.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label class="field-label">Justification / reference ticket <span style="color:var(--bs-danger)">*</span></label>
        <textarea rows="3" class="field-textarea" style="font-family:inherit;font-size:14px;padding:8px;border:1px solid var(--bs-border);border-radius:6px;width:100%;resize:vertical;"
                  placeholder="Describe the need and add a ticket number if available..."
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
      <h3 class="wiz-section__title">Source image (Harbor registry)</h3>
      <div class="form-row">
        <label class="field-label">Harbor project <span style="color:var(--bs-danger)">*</span></label>
        ${harbProjects.length ? `
        <select class="field-select" data-input="img-wiz-project">
          <option value="">— Select a project —</option>
          ${harbProjects.map(p => `<option value="${esc(p)}" ${d.harborProject === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
          <option value="__custom__" ${!harbProjects.includes(d.harborProject) && d.harborProject && d.harborProject !== '__custom__' ? 'selected' : ''}>Other project (enter manually)</option>
        </select>
        ${(!harbProjects.includes(d.harborProject) && d.harborProject && d.harborProject !== '__custom__') || d.harborProject === '__custom__' ? `
        <input type="text" class="field-input" style="margin-top:6px;" placeholder="nom-du-projet"
               data-input="img-wiz-project-custom" value="${esc(d.harborProject === '__custom__' ? '' : d.harborProject)}">` : ''}` : `
        <input type="text" class="field-input" placeholder="e.g. web-team/customer-portal"
               data-input="img-wiz-project" value="${esc(d.harborProject)}">`}
      </div>
      <div class="form-row">
        <label class="field-label">Image name <span style="color:var(--bs-danger)">*</span></label>
        <input type="text" class="field-input" placeholder="e.g. my-app-backend"
               data-input="img-wiz-image" value="${esc(d.imageName)}">
      </div>
      <div class="form-row">
        <label class="field-label">Tag <span style="color:var(--bs-danger)">*</span></label>
        <input type="text" class="field-input" placeholder="e.g. v1.4.2 or latest"
               data-input="img-wiz-tag" value="${esc(d.imageTag)}">
        <div class="field-hint muted" style="margin-top:4px;font-size:12px;">Full reference: harbor.internal/${esc(d.harborProject || '<project>')}/${esc(d.imageName || '<image>')}:${esc(d.imageTag || 'latest')}</div>
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
      <h3 class="wiz-section__title">Destination (Rancher cluster)</h3>
      <div class="form-row">
        <label class="field-label">Target cluster <span style="color:var(--bs-danger)">*</span></label>
        ${clusters.length ? `
        <select class="field-select" data-input="img-wiz-cluster">
          <option value="">— Select a cluster —</option>
          ${clusters.map(c => `<option value="${esc(c)}" ${d.targetCluster === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          <option value="__custom__" ${!clusters.includes(d.targetCluster) && d.targetCluster ? 'selected' : ''}>Other cluster</option>
        </select>
        ${(!clusters.includes(d.targetCluster) && d.targetCluster) ? `
        <input type="text" class="field-input" style="margin-top:6px;" placeholder="nom-du-cluster"
               data-input="img-wiz-cluster-custom" value="${esc(d.targetCluster)}">` : ''}` : `
        <input type="text" class="field-input" placeholder="e.g. cluster-rancher-prod"
               data-input="img-wiz-cluster" value="${esc(d.targetCluster)}">`}
      </div>
      <div class="form-row">
        <label class="field-label">Target namespace</label>
        <input type="text" class="field-input" placeholder="e.g. production (empty = default namespace)"
               data-input="img-wiz-namespace" value="${esc(d.targetNamespace)}">
      </div>
    </div>`;
}

function imgWizStepDiode() {
  const d = ui.wizard.data;
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Destination (diode-protected network)</h3>
      <div class="banner banner--warning" style="margin-bottom:16px;">⚡ <span>The transfer is <strong>one-way</strong>: no return flow is possible after the image is transferred.</span></div>
      <div class="form-row">
        <label class="field-label">Target system <span style="color:var(--bs-danger)">*</span></label>
        <input type="text" class="field-input" placeholder="e.g. isolated-server-prod"
               data-input="img-wiz-system" value="${esc(d.targetSystem)}">
      </div>
      <div class="form-row">
        <label class="field-label">Drop path on target system</label>
        <input type="text" class="field-input" placeholder="e.g. /images/apps"
               data-input="img-wiz-path" value="${esc(d.targetPath)}">
      </div>
    </div>`;
}

function imgWizSummaryPull() {
  const d = ui.wizard.data;
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Request summary</h3>
      <div class="kv-grid" style="margin-top:12px;">
        <div><span class="label">Type</span><span class="value">⚓ Pull image Harbor</span></div>
        <div><span class="label">Team</span><span class="value">${esc(d.team)}</span></div>
        <div><span class="label">Image</span><span class="value mono">harbor.internal/${esc(d.harborProject)}/${esc(d.imageName)}:${esc(d.imageTag)}</span></div>
        <div><span class="label">Target cluster</span><span class="value">${esc(d.targetCluster)}</span></div>
        <div><span class="label">Namespace</span><span class="value">${esc(d.targetNamespace) || 'default'}</span></div>
        <div class="kv--full"><span class="label">Justification</span><span class="value">${esc(d.justification)}</span></div>
      </div>
      <div class="banner banner--info" style="margin-top:16px;">ℹ️ <span>The platform team will review the request and run the Trivy scan + Rancher deployment pipeline.</span></div>
    </div>`;
}

function imgWizSummaryPush() {
  const d = ui.wizard.data;
  return `
    <div class="wiz-section">
      <h3 class="wiz-section__title">Request summary</h3>
      <div class="kv-grid" style="margin-top:12px;">
        <div><span class="label">Type</span><span class="value">🔒 Push to diode network</span></div>
        <div><span class="label">Team</span><span class="value">${esc(d.team)}</span></div>
        <div><span class="label">Image</span><span class="value mono">harbor.internal/${esc(d.harborProject)}/${esc(d.imageName)}:${esc(d.imageTag)}</span></div>
        <div><span class="label">Target system</span><span class="value">${esc(d.targetSystem)}</span></div>
        <div><span class="label">Path</span><span class="value mono">${esc(d.targetPath)}</span></div>
        <div class="kv--full"><span class="label">Justification</span><span class="value">${esc(d.justification)}</span></div>
      </div>
      <div class="banner banner--info" style="margin-top:16px;">⚡ <span>This transfer is <strong>auto-approved by policy</strong>. The pipeline includes AV scan, Trivy, AES-256 encryption and full traceability.</span></div>
    </div>`;
}

function imgWizConfirm() {
  const w = ui.wizard;
  const id = w.sentRequestId;
  const req = state.requests.find(x => x.id === id);
  const autoApproved = w.autoApproved || (req && isAutoApprovedRequest(req));
  return `
    <div style="text-align:center;padding:32px 16px;">
      <div style="font-size:48px;margin-bottom:16px;">${autoApproved ? '✅' : '📨'}</div>
      <h3 style="margin-bottom:8px;">Request submitted!</h3>
      <p class="muted">${autoApproved
        ? `Your request <strong>${esc(id)}</strong> was auto-approved and provisioning has started.`
        : `Your request <strong>${esc(id)}</strong> is pending platform-team approval.`}</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:24px;">
        <button class="btn btn--outline" data-action="open-request" data-arg="${esc(id)}">Track my request</button>
        <button class="btn btn--primary" data-action="goto-catalog">Back to catalog</button>
      </div>
    </div>`;
}

function validateImageWizardStep() {
  const w = ui.wizard;
  const d = w.data;
  const steps = IMAGE_WIZARD_STEPS[w.wizardType] || [];
  const summaryStep = steps.length - 2;

  if (w.step === 0 && !d.justification.trim()) return 'Justification is required.';
  if (w.step === 1) {
    if (!d.imageName.trim()) return 'Image name is required.';
    if (!d.imageTag.trim()) return 'Image tag is required.';
  }
  if (w.wizardType === 'harbor-pull' && w.step === 2 && !d.targetCluster.trim()) return 'Target cluster is required.';
  if (w.wizardType === 'diode-push' && w.step === 2 && !d.targetSystem.trim()) return 'Target system is required.';
  return '';
}

function submitImageWizard() {
  const w = ui.wizard;
  const d = w.data;
  const id = `REQ-${state.nextRequestNum++}`;
  const label = w.wizardType === 'harbor-pull' ? 'Pull image Harbor' : 'Push to diode network';
  const req = {
    id, requestType: w.wizardType,
    name: `${w.wizardType === 'harbor-pull' ? 'pull' : 'push'}-${d.imageName.trim() || 'image'}-${id.toLowerCase()}`,
    team: d.team, requester: 'Mary Lambert',
    description: d.justification.trim(),
    env: 'prod', size: 'S', network: 'FR', hypervisor: 'auto',
    resources: {}, customSpecs: {}, resourceSizes: {}, vmSizes: [],
    /* image-specific fields */
    harborProject: d.harborProject.trim(),
    imageName: d.imageName.trim(),
    imageTag: d.imageTag.trim(),
    targetCluster: d.targetCluster.trim(),
    targetNamespace: d.targetNamespace.trim(),
    targetSystem: d.targetSystem.trim(),
    targetPath: d.targetPath.trim(),
    status: 'pending', createdAt: now(),
    comment: '', prov: null,
    history: [{ ts: now(), label: `Request for ${label} submitted by Mary Lambert` }],
  };
  const autoApproved = submitRequest(req, `Mary Lambert submitted request ${id} (${label} — ${d.imageName}:${d.imageTag}).`);

  w.sentRequestId = id;
  w.autoApproved = autoApproved;
  w.step = (IMAGE_WIZARD_STEPS[w.wizardType] || []).length - 1;
  renderUser();
  renderAdmin();
  renderBadges();
  if (autoApproved) {
    toast('user', `Request <strong>${id}</strong> auto-approved — provisioning starts now`, 'success');
    toast('admin', `✅ Request <strong>${id}</strong> auto-approved by policy`, 'info');
  } else {
    toast('user', `Request <strong>${id}</strong> submitted for approval`, 'success');
    toast('admin', `🔔 New request <strong>${id}</strong> to review`, 'info');
  }
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
        <span><strong>${resCount}</strong> resource${resCount !== 1 ? 's' : ''} selected</span>
        <span>Monthly estimate: <strong>${euro(computeCost(w.data).total)}</strong> <small>excl. tax</small></span>
       </div>`
    : '';

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'Create…', action: 'goto-create' }, { label: w.templateTitle || 'Bundle' }],
      title: w.templateTitle || 'Bundle',
      subtitle: w.templateSubtitle || 'Template managed by platform-team · v2.4',
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
              ${w.step > 0 ? '<button class="btn btn--text" data-action="wiz-prev">Previous</button>' : '<button class="btn btn--text" data-action="goto-create">Cancel</button>'}
            </div>
            <div>
              ${w.step < 4
                ? '<button class="btn btn--primary" data-action="wiz-next">Next</button>'
                : '<button class="btn btn--success" data-action="wiz-submit">📨 Submit request</button>'}
            </div>
          </div>`}
        </div>
      </div>
    </div>`;
}

/* Step 1: general information */
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
    ? `<span class="slug-indicator ${slugValid ? 'slug-ok' : 'slug-err'}">${slugValid ? '✓' : slugTaken ? 'Already used' : '✗ Invalid format'}</span>`
    : '';
  return `
    <div class="form-grid-2">
      <div class="form-row">
        <label class="field-label">Project name <span class="required">*</span></label>
        <div class="slug-input-wrap">
          <input type="text" placeholder="e.g. supplier-portal" value="${esc(d.name)}" data-input="wiz-name">
          ${indicator}
        </div>
        <div class="hint">Lowercase letters, numbers and hyphens only — used to name all resources.</div>
        ${name.length >= 3 ? `
        <div class="slug-preview">
          <span class="slug-preview__label">Naming preview:</span>
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
        <label class="field-label">Owner / responsible team <span class="required">*</span></label>
        <select data-input="wiz-team">
          ${TEAMS.map(t => `<option ${t === d.team ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <label class="field-label">Description</label>
      <textarea rows="3" placeholder="What will this project be used for?" data-input="wiz-desc">${esc(d.description)}</textarea>
    </div>
  `;
}

/* Step 2: target environment */
function wizStep2() {
  const d = ui.wizard.data;
  const autoApproved = isAutoApprovedRequest(d);
  return `
    <div class="form-row">
      <label class="field-label">Target environment <span class="required">*</span></label>
      <div class="pick-grid">
        ${Object.entries(ENVIRONMENTS).map(([k, e]) => `
          <div class="pick-card ${d.env === k ? 'is-selected' : ''}" data-action="wiz-env" data-arg="${k}">
            <div class="pick-card__icon">${e.icon}</div>
            <div class="pick-card__title">${e.label}</div>
            <div class="pick-card__desc">${e.desc}</div>
          </div>`).join('')}
      </div>
      ${d.env === 'prod' ? `<div class="banner banner--warning" style="margin-top:14px;">⚠️ <span>${autoApproved
        ? 'Production policy checks run automatically for this service class.'
        : 'A production environment requires reinforced platform-team approval.'}</span></div>` : ''}
    </div>
    <div class="form-row">
      <label class="field-label">Target network / region <span class="required">*</span></label>
      <div class="pick-grid">
        ${Object.entries(NETWORKS).map(([k, n]) => `
          <div class="pick-card ${d.network === k ? 'is-selected' : ''}" data-action="wiz-network" data-arg="${k}">
            <div class="pick-card__icon">${n.flag}</div>
            <div class="pick-card__title">${n.label}</div>
            <div class="pick-card__desc">${n.desc}</div>
          </div>`).join('')}
      </div>
      <div class="hint">Determines the hosting datacenter and capacity pool. The VM hypervisor is selected in the Sizing step.</div>
    </div>`;
}

/* Resource display order (selection in step 3, configuration in step 4) */
const RES_ORDER = ['rancher', 'harbor', 'vm', 'postgres', 'mariadb', 'mongo', 'redis', 'rabbitmq', 'wiki'];

/* Step 3: resource selection (selection only, configuration in the next step) */
const RES_GROUPS = [
  { label: 'Orchestration & Registries', keys: ['rancher', 'harbor'] },
  { label: 'Virtual machines', keys: ['vm'] },
  { label: 'Databases', keys: ['postgres', 'mariadb', 'mongo'] },
  { label: 'Cache & Messaging', keys: ['redis', 'rabbitmq'] },
  { label: 'Documentation', keys: ['wiki'] },
];

function wizStep3() {
  const r = ui.wizard.data.resources;
  const card = key => {
    const def = RESOURCE_DEFS[key];
    const priceStr = key === 'harbor' ? '1 € / GB / month' : `from ${euro(def.base)} / month`;
    return `
      <div class="pick-card ${r[key] ? 'is-selected' : ''}" data-action="wiz-res" data-arg="${key}">
        <div class="pick-card__icon">${def.icon}</div>
        <div class="pick-card__title">${def.label}</div>
        <div class="pick-card__desc">${def.desc}</div>
        <div class="pick-card__price">${priceStr}</div>
      </div>`;
  };
  return `
    <div class="form-row">
      <label class="field-label">Requested resources <span class="required">*</span> <span class="muted">(at least one — click to select)</span></label>
      <div class="banner banner--info">ℹ️ <span>Choose the resources to provision. Details (name, volume, sizing...) are configured in the <strong>Sizing</strong> step.</span></div>
      ${RES_GROUPS.map(g => `
        <div class="res-group">
          <div class="res-group__header">${g.label}</div>
          <div class="pick-grid">${g.keys.map(card).join('')}</div>
        </div>`).join('')}
    </div>`;
}

function vmTimeoutEditor(d) {
  const timeout = ensureVmTimeout(d, true);
  return `
    <div class="lease-panel ${timeout.enabled ? '' : 'lease-panel--disabled'}">
      <div class="lease-panel__top">
        <label class="lease-toggle">
          <input type="checkbox" ${timeout.enabled ? 'checked' : ''} data-action="wiz-vm-timeout-toggle">
          <span>Time-limited workload</span>
        </label>
        <div class="lease-duration">
          <label>Keep VMs for</label>
          <input type="number" min="${VM_TIMEOUT_MIN_DAYS}" max="${VM_TIMEOUT_MAX_DAYS}" value="${esc(timeout.durationDays)}"
                 data-input="wiz-vm-duration" ${timeout.enabled ? '' : 'disabled'}>
          <span>days</span>
        </div>
      </div>
      <div class="lease-panel__body">
        <div class="lease-reminders">
          <span>Reminders</span>
          ${vmReminderChips()}
        </div>
        <div class="muted">Notifications are sent 45, 30, 15 and 1 day before VM auto-delete. Minimum lease is ${VM_TIMEOUT_MIN_DAYS} days.</div>
      </div>
    </div>`;
}


/* Step 4: resource configuration and sizing + cost estimate */
function wizStep4() {
  const d = ui.wizard.data;
  const r = d.resources;
  const rs = d.resourceSizes;
  const cost = computeCost(d);
  const selected = RES_ORDER.filter(k => r[k]);
  const approvalNote = isAutoApprovedRequest(d)
    ? 'Simulated prices · auto-approved service class.'
    : 'Simulated prices · subject to platform-team approval.';

  if (!selected.length) {
    return emptyState('🧩', 'No resources to configure',
      'Go back to the Resources step and select at least one resource to provision.');
  }

  /* Spec text for a given size (e.g. "PG-M · 4 vCPU · 16 GB RAM · 100 GB") */
  const sizeSpecsText = (key, sz) => {
    if (sz === 'custom') return 'Custom specification';
    const def = RESOURCE_DEFS[key];
    const plan = def.planLabels?.[sz];
    const fp = SIZE_FOOTPRINT[sz];
    const parts = [];
    if (plan) parts.push(plan);
    if (fp) parts.push(`${fp.cpu} vCPU · ${fp.ram} GB RAM · ${fp.storage} GB storage`);
    return parts.join(' · ');
  };

  /* S/M/L/XL/⚙ pill group for a given resource */
  const pillGroup = (currentSize, actionArg, resourceKey) => {
    const pills = Object.keys(SIZES).map(sz => `
      <button class="dim-pill ${currentSize === sz ? 'dim-pill--active' : ''}"
              data-action="wiz-ressize" data-arg="${actionArg}:${sz}"
              title="${SIZES[sz].label}">${sz === 'custom' ? '⚙' : sz}</button>`).join('');
    const specTxt = sizeSpecsText(resourceKey, currentSize);
    const def = RESOURCE_DEFS[resourceKey];
    const priceStr = currentSize === 'custom' ? '' : ` · <span class="dim-specs__price">${euro(sizePrice(def, currentSize, specFor(d, actionArg)))}/month</span>`;
    return `
      <div class="dim-pills">${pills}</div>
      <div class="dim-specs">${specTxt}${priceStr}</div>`;
  };

  /* Custom editor (shown only if sz === 'custom') */
  const customEditor = specKey => {
    const c = d.customSpecs[specKey] || DEFAULT_CUSTOM;
    return `
      <div class="dim-custom-editor">
        <div class="dim-custom-fields">
          <label class="dim-custom-field"><span>vCPU</span>
            <input type="number" min="1" max="64" value="${c.cpu}" data-input="wiz-rescustom" data-ckey="${specKey}" data-cfield="cpu">
          </label>
          <label class="dim-custom-field"><span>RAM (GB)</span>
            <input type="number" min="1" max="256" value="${c.ram}" data-input="wiz-rescustom" data-ckey="${specKey}" data-cfield="ram">
          </label>
          <label class="dim-custom-field"><span>Storage (GB)</span>
            <input type="number" min="1" max="2000" value="${c.storage}" data-input="wiz-rescustom" data-ckey="${specKey}" data-cfield="storage">
          </label>
        </div>
        <div class="dim-custom-hint">12 €/vCPU + 6 €/GB RAM + 0.20 €/GB storage = <strong>${euro(customPrice(c))}/month</strong></div>
      </div>`;
  };

  /* Resource card */
  const resCard = key => {
    const def = RESOURCE_DEFS[key];
    const sz = rs[key] ?? d.size;

    switch (key) {
      case 'rancher':
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(def.base)}<small>/month</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-field-row">
              <label>Rancher project name</label>
              <input type="text" class="dim-input" value="${esc(r.rancherName)}" placeholder="${esc(d.name || 'my-project')}" data-input="wiz-ranchername">
            </div>
          </div>
        </div>`;

      case 'harbor':
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(r.registryGb ?? 10)}<small>/month</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-field-row">
              <label>Capacity</label>
              <input type="number" min="1" max="500" value="${r.registryGb}" data-input="wiz-registrygb" style="width:72px;">
              <span class="muted">GB (1 €/GB/month)</span>
            </div>
          </div>
        </div>`;

      case 'wiki':
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(def.base)}<small>/month</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-field-row">
              <label>Wiki name</label>
              <input type="text" class="dim-input" value="${esc(r.wikiName)}" placeholder="${esc((d.name || 'my-project') + '-wiki')}" data-input="wiz-wikiname">
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
            <span class="dim-card__price">${euro(totalVmCost)}<small>/month</small></span>
          </div>
          <div class="dim-card__body">
            <div class="dim-vm-meta">
              <div class="dim-field-row">
                <label>VM count</label>
                <input type="number" min="1" max="6" value="${r.vmCount}" data-input="wiz-vmcount" style="width:60px;">
              </div>
              <div class="dim-field-row">
                <label>Hypervisor</label>
                <select data-input="wiz-hypervisor" class="dim-select">
                  ${Object.entries(HYPERVISORS).map(([k, h]) => `<option value="${k}" ${d.hypervisor === k ? 'selected' : ''}>${h.icon} ${h.label}</option>`).join('')}
                </select>
              </div>
            </div>
            ${vmTimeoutEditor(d)}
            <div class="dim-vm-list">${vmItems}</div>
          </div>
        </div>`;
      }

      default: {
        const isCustom = sz === 'custom';
        return `<div class="dim-card">
          <div class="dim-card__head">
            <span class="dim-card__title">${def.icon} ${def.label}</span>
            <span class="dim-card__price">${euro(sizePrice(def, sz, specFor(d, key)))}<small>/month</small></span>
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
          <span class="muted">Monthly estimate</span>
          <div class="cost-box__total">${euro(cost.total)} <small>/ month excl. tax</small></div>
          <div class="dim-cost-annual">${euro(cost.total * 12)} <small>/ year excl. tax</small></div>
          <ul class="cost-box__lines">
            ${cost.lines.map(l => `<li><span>${esc(l[0])}</span><span>${euro(Math.round(l[1]))}</span></li>`).join('')
              || '<li><span class="muted">No resources selected</span></li>'}
          </ul>
          <div class="dim-cost-note">${approvalNote}</div>
        </div>
      </aside>
    </div>`;
}


/* Check whether per-resource sizes differ from the global size */
function isCustomSized(d) {
  const rs = d.resourceSizes ?? {};
  if (Object.values(rs).some(sz => sz !== d.size)) return true;
  if ((d.vmSizes ?? []).some(sz => sz !== d.size)) return true;
  return false;
}

/* Effective size applied to sized resources:
   - one size key (S/M/L/XL) if all share the same one,
   - null if sizes are mixed (customization),
   - the global size if no sized resource is selected. */
const SIZED_KEYS = ['vm', 'postgres', 'mariadb', 'mongo', 'redis', 'rabbitmq'];
function effectiveSizeOf(d) {
  const rs = d.resourceSizes ?? {};
  const applied = SIZED_KEYS.filter(k => d.resources[k])
    .flatMap(k => k === 'vm' ? (d.vmSizes ?? []) : [rs[k] ?? d.size]);
  if (!applied.length) return d.size;
  return applied.every(s => s === applied[0]) ? applied[0] : null;
}

/* Step 5: summary before submission */
function wizStep5() {
  const d = ui.wizard.data;
  const cost = computeCost(d);
  const autoApproved = isAutoApprovedRequest(d);
  return `
    <div class="banner banner--info">📋 <span>${autoApproved
      ? 'Review the summary: this request is covered by auto-approval and provisioning starts after submission.'
      : 'Review the summary: the request will be sent to the platform team for approval.'}</span></div>
    <div class="kv-grid" style="margin-bottom:18px;">
      <div><span class="label">Project name</span><span class="value mono">${esc(d.name)}</span></div>
      <div><span class="label">Team</span><span class="value">${esc(d.team)}</span></div>
      <div><span class="label">Environment</span><span class="value">${ENVIRONMENTS[d.env].icon} ${ENVIRONMENTS[d.env].label}</span></div>
      <div><span class="label">Network</span><span class="value">${NETWORKS[d.network].flag} ${NETWORKS[d.network].label}</span></div>
      ${d.resources.vm ? `<div><span class="label">Hypervisor</span><span class="value">${d.hypervisor === 'auto' ? 'Any' : `${HYPERVISORS[d.hypervisor].icon} ${HYPERVISORS[d.hypervisor].label}`}</span></div>` : ''}
      ${d.resources.vm ? `<div><span class="label">VM timeout</span><span class="value">${vmTimeoutValueHtml(d)}</span></div>` : ''}
      <div><span class="label">Size</span><span class="value">${effectiveSizeOf(d)
        ? `${SIZES[effectiveSizeOf(d)].label}${isCustomSized(d) ? ' <span class="chip chip--info">customized</span>' : ''}`
        : '<span class="chip chip--info">Custom sizes</span>'}</span></div>
      <div class="kv--full"><span class="label">Description</span><span class="value">${esc(d.description) || '—'}</span></div>
      <div class="kv--full"><span class="label">Resources</span>
        <span class="value">${resourceSummary(d).map(x => `<span class="chip">${esc(x)}</span>`).join('') || '—'}</span></div>
    </div>
    <div class="cost-box">
      <span class="muted">Estimated monthly cost</span>
      <div class="cost-box__total">${euro(cost.total)} <small>/ month (simulated, excl. tax)</small></div>
    </div>`;
}

/* Step 6: submission confirmation */
function wizStep6() {
  const id = ui.wizard.sentRequestId;
  const req = state.requests.find(x => x.id === id);
  const autoApproved = ui.wizard.autoApproved || (req && isAutoApprovedRequest(req));
  return `
      <div class="empty-state">
        <div class="empty-state__icon">${autoApproved ? '✅' : '📨'}</div>
      <div class="empty-state__title">Request ${esc(id)} submitted</div>
      <p>${autoApproved
        ? 'This request does <strong>not require manual approval</strong>. Provisioning starts automatically and is visible in the admin pane.'
        : 'Your request is <strong>pending approval</strong> by the platform team. It now appears in the admin approval queue (right pane).'}</p>
      <div style="margin-top:18px; display:flex; gap:10px; justify-content:center;">
        <button class="btn btn--primary" data-action="open-request" data-arg="${esc(id)}">Track my request</button>
        <button class="btn btn--text" data-action="goto-catalog">Back to catalog</button>
      </div>
    </div>`;
}

/* Validate the current step; returns an error message or '' */
function validateWizardStep() {
  const w = ui.wizard, d = w.data;
  if (w.step === 0) {
    if (!d.name.trim()) return 'Project name is required.';
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(d.name.trim()))
      return 'Invalid name: lowercase letters, numbers and hyphens only (3 to 40 characters).';
    if (state.entities.some(e => e.name === d.name.trim()) || state.requests.some(r => r.name === d.name.trim() && r.status !== 'rejected'))
      return `Name "${d.name.trim()}" is already used in the catalog.`;
  }
  if (w.step === 2) {
    const r = d.resources;
    if (!r.rancher && !r.harbor && !r.vm && !r.postgres && !r.mariadb && !r.mongo && !r.redis && !r.rabbitmq && !r.wiki)
      return 'Select at least one resource.';
  }
  if (w.step === 3 && d.resources.vm && hasVmTimeout(d)) {
    const days = Number(getVmTimeout(d).durationDays);
    if (!Number.isInteger(days) || days < VM_TIMEOUT_MIN_DAYS || days > VM_TIMEOUT_MAX_DAYS)
      return `VM timeout duration must be between ${VM_TIMEOUT_MIN_DAYS} and ${VM_TIMEOUT_MAX_DAYS} days.`;
  }
  return '';
}

/* Create a request from the wizard */
function submitWizard() {
  const d = ui.wizard.data;
  const id = `REQ-${state.nextRequestNum++}`;
  const timeouts = JSON.parse(JSON.stringify(d.timeouts || {}));
  if (d.resources.vm) {
    timeouts.vm = normalizeVmTimeout(timeouts.vm, true);
  } else if (timeouts.vm) {
    delete timeouts.vm;
  }
  const req = {
    id, name: d.name.trim(), team: d.team, requester: 'Mary Lambert',
    description: d.description.trim(),
    env: d.env, size: d.size,
    network: d.network, hypervisor: d.hypervisor,
    customSpecs: JSON.parse(JSON.stringify(d.customSpecs || {})),
    resourceSizes: { ...d.resourceSizes },
    vmSizes: [...d.vmSizes],
    timeouts,
    resources: { ...d.resources },
    status: 'pending', createdAt: now(),
    comment: '', prov: null,
    history: [{ ts: now(), label: 'Request submitted by Mary Lambert' }],
  };
  const autoApproved = submitRequest(req, `Mary Lambert submitted request ${id} (${req.name}).`);

  ui.wizard.sentRequestId = id;
  ui.wizard.autoApproved = autoApproved;
  ui.wizard.step = 5;
  renderUser();
  renderAdmin();
  renderBadges();
  if (autoApproved) {
    toast('user', `Request <strong>${id}</strong> auto-approved — provisioning starts now`, 'success');
    toast('admin', `✅ Request <strong>${id}</strong> auto-approved by policy`, 'info');
  } else {
    toast('user', `Request <strong>${id}</strong> submitted for approval`, 'success');
    toast('admin', `🔔 New request <strong>${id}</strong> to review`, 'info');
  }
}

/* ---- 5.5 My requests ---- */
function userRequestsPage() {
  const mine = state.requests.slice().sort((a, b) => b.createdAt - a.createdAt);
  return `
    ${pageHeader('user', {
      title: 'My requests',
      subtitle: 'Track resource requests submitted to the platform team',
      meta: [['Requests', String(mine.length)]],
    })}
    <div class="content">
      <div class="card">
        <div class="table-wrap">
          ${mine.length ? `
          <table class="bs-table">
            <thead><tr>
              <th>Ref.</th><th>Project</th><th>Environment</th><th>Resources</th>
              <th>Lease / timeout</th><th>Estimated cost</th><th>Status</th><th>Created</th>
            </tr></thead>
            <tbody>
              ${mine.map(r => `
                <tr class="is-clickable" data-action="open-request" data-arg="${esc(r.id)}">
                  <td class="mono">${esc(r.id)}</td>
                  <td><span class="cell-name">${esc(r.name)}</span></td>
                  <td class="cell-secondary">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</td>
                  <td class="cell-secondary">${resourceSummary(r).join(' · ')}</td>
                  <td>${vmTimeoutTableCell(r)}</td>
                  <td>${r.requestType === 'harbor-pull' || r.requestType === 'diode-push' ? '<span class="muted">—</span>' : euro(computeCost(r).total) + '<span class="muted">/month</span>'}</td>
                  <td>${statusChip(r.status)}</td>
                  <td class="cell-secondary">${timeAgo(r.createdAt)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : emptyState('📭', 'No requests', 'Create your first request from the Create... page.')}
        </div>
      </div>
    </div>`;
}

/* ---- 5.6 Request detail (user side) ---- */
function userRequestDetailPage() {
  const r = state.requests.find(x => x.id === ui.user.request);
  if (!r) { ui.user.page = 'requests'; return userRequestsPage(); }
  const cost = computeCost(r);
  const createdEntities = state.entities.filter(e => e.fromRequest === r.id);

  return `
    ${pageHeader('user', {
      crumbs: [{ label: 'My requests', action: 'goto-requests' }, { label: r.id }],
      title: `${r.id} — ${r.name}`,
      subtitle: `Requested by ${esc(r.requester)} · ${esc(r.team)}`,
      meta: [['Status', statusChip(r.status)], ['Estimated cost', euro(cost.total) + '/month']],
    })}
    <div class="content">
      ${r.status === 'rejected' ? `
        <div class="banner banner--error">⛔ <span><strong>Request rejected.</strong> ${esc(r.comment)}</span></div>` : ''}
      ${r.status === 'available' ? `
        <div class="banner banner--success">🎉 <span><strong>Resources available!</strong> Created entities are visible in the catalog.</span></div>` : ''}
      ${r.status === 'available' && hasVmTimeout(r) ? `
        <div class="banner banner--warning">⏱ <span><strong>VM timeout active.</strong> ${vmTimeoutValueHtml(r)}</span></div>` : ''}
      ${r.status === 'pending' ? `
        <div class="banner banner--info">⏳ <span>Request under platform-team review.</span></div>` : ''}
      ${r.status === 'provisioning' ? `
        <div class="banner banner--info">⚙️ <span>Provisioning in progress... follow progress in the admin pane.</span></div>` : ''}

      <div class="card">
        <div class="card__header"><span class="card__title">Summary</span></div>
        <div class="card__body">
          <div class="kv-grid">
            ${r.requestType === 'harbor-pull' || r.requestType === 'diode-push' ? `
            <div><span class="label">Type</span><span class="value">${r.requestType === 'harbor-pull' ? '⚓ Pull image Harbor' : '🔒 Push to diode network'}</span></div>
            <div><span class="label">Image</span><span class="value mono">harbor.internal/${esc(r.harborProject || '?')}/${esc(r.imageName || '?')}:${esc(r.imageTag || 'latest')}</span></div>
            ${r.requestType === 'harbor-pull' ? `
            <div><span class="label">Target cluster</span><span class="value">${esc(r.targetCluster || '—')}</span></div>
            <div><span class="label">Namespace</span><span class="value">${esc(r.targetNamespace) || 'default'}</span></div>` : `
            <div><span class="label">Target system</span><span class="value">${esc(r.targetSystem || '—')}</span></div>
            <div><span class="label">Path</span><span class="value mono">${esc(r.targetPath || '/images')}</span></div>`}
            <div class="kv--full"><span class="label">Justification</span><span class="value">${esc(r.description) || '—'}</span></div>` : `
            <div><span class="label">Environment</span><span class="value">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</span></div>
            <div><span class="label">Network</span><span class="value">${NETWORKS[r.network || 'FR'].flag} ${NETWORKS[r.network || 'FR'].label}</span></div>
            ${r.resources.vm ? `<div><span class="label">Hypervisor</span><span class="value">${(r.hypervisor && r.hypervisor !== 'auto') ? `${HYPERVISORS[r.hypervisor].icon} ${HYPERVISORS[r.hypervisor].label}` : 'Any'}</span></div>` : ''}
            ${r.resources.vm ? `<div><span class="label">VM timeout</span><span class="value">${vmTimeoutValueHtml(r)}</span></div>` : ''}
            <div><span class="label">Size</span><span class="value">${SIZES[r.size].label}</span></div>
            <div><span class="label">Estimated monthly cost</span><span class="value">${euro(cost.total)}</span></div>
            <div class="kv--full"><span class="label">Description</span><span class="value">${esc(r.description) || '—'}</span></div>
            <div class="kv--full"><span class="label">Requested resources</span>
              <span class="value">${resourceSummary(r).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</span></div>`}
            ${r.comment && r.status !== 'rejected' ? `
              <div class="kv--full"><span class="label">Platform-team comment</span>
                <span class="value">💬 ${esc(r.comment)}</span></div>` : ''}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__header"><span class="card__title">History</span></div>
        <div class="card__body">
          <ul class="timeline">
            ${r.history.map(h => `<li>${esc(h.label)}<span class="time">${fmtDate(h.ts)}</span></li>`).join('')}
          </ul>
        </div>
      </div>

      ${createdEntities.length ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Created resources</span>
          <span class="muted">${createdEntities.length} catalog entit${createdEntities.length === 1 ? 'y' : 'ies'}</span></div>
        <div class="card__body--flush table-wrap">
          <table class="bs-table">
            <thead><tr><th>Name</th><th>Type</th><th>Expiration</th><th>Status</th></tr></thead>
            <tbody>
              ${createdEntities.map(e => `
                <tr class="is-clickable" data-action="open-entity" data-arg="${esc(e.name)}">
                  <td><span class="cell-name">${esc(e.name)}</span></td>
                  <td class="cell-secondary">${esc(e.type)}</td>
                  <td>${e.expiresAt ? entityLeaseChip(e) : '<span class="muted">—</span>'}</td>
                  <td><span class="status status--available">Operational</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    </div>`;
}

/* ============================================================
   6. Admin View
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

  // Keep the execution log scrolled to the bottom.
  const consoleEl = $('#prov-console');
  if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight;
}

/* ---- 6.1 Approval queue ---- */
function adminInboxPage() {
  const filters = [
    ['all', 'All'], ['pending', 'Pending'], ['provisioning', 'In progress'],
    ['available', 'Available'], ['rejected', 'Rejected'],
  ];
  const f = ui.admin.filter;
  let list = state.requests.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (f !== 'all') list = list.filter(r => f === 'provisioning' ? (r.status === 'provisioning' || r.status === 'approved') : r.status === f);
  const pending = state.requests.filter(r => r.status === 'pending').length;

  return `
    ${pageHeader('admin', {
      title: 'Approvals',
      subtitle: 'Governance plugin · infrastructure resource requests',
      meta: [['Pending', String(pending)], ['Total', String(state.requests.length)]],
    })}
    <div class="tabs">
      ${filters.map(([k, lbl]) => `
        <button class="tab ${f === k ? 'is-active' : ''}" data-action="admin-filter" data-arg="${k}">${lbl}</button>`).join('')}
    </div>
    <div class="content">
      ${pending ? `<div class="banner banner--warning">🔔 <span><strong>${pending} request${pending > 1 ? 's' : ''}</strong> waiting for your approval.</span></div>` : ''}
      <div class="card">
        <div class="table-wrap">
          ${list.length ? `
          <table class="bs-table">
            <thead><tr>
              <th>Ref.</th><th>Project</th><th>Requester</th><th>Env.</th>
              <th>Lease / timeout</th><th>Cost/month</th><th>Status</th><th>Created</th>
            </tr></thead>
            <tbody>
              ${list.map(r => `
                <tr class="is-clickable" data-action="admin-open" data-arg="${esc(r.id)}">
                  <td class="mono">${esc(r.id)}</td>
                  <td><span class="cell-name">${esc(r.name)}</span></td>
                  <td class="cell-secondary">${esc(r.requester)}<br><span class="muted">${esc(r.team)}</span></td>
                  <td class="cell-secondary">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</td>
                  <td>${vmTimeoutTableCell(r)}</td>
                  <td>${r.requestType === 'harbor-pull' || r.requestType === 'diode-push' ? '<span class="muted">—</span>' : euro(computeCost(r).total)}</td>
                  <td>${statusChip(r.status)}</td>
                  <td class="cell-secondary">${timeAgo(r.createdAt)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : emptyState('🗂️', 'No requests', 'No requests match this filter right now.')}
        </div>
      </div>
    </div>`;
}

/* ---- 6.2 Request detail + provisioning ---- */
function adminRequestPage() {
  const r = state.requests.find(x => x.id === ui.admin.request);
  if (!r) { ui.admin.page = 'inbox'; return adminInboxPage(); }
  if (r.requestType === 'harbor-pull' || r.requestType === 'diode-push') return adminImageRequestPage(r);
  const cost = computeCost(r);
  const canDecide = r.status === 'pending';

  /* Requested resource table rows */
  const res = r.resources;
  const rs = r.resourceSizes ?? {};
  const globalSz = r.size ?? 'S';
  const getSize = key => rs[key] ?? globalSz;
  const resRows = [];
  if (res.rancher) resRows.push(['🐮 Rancher Project (K8s)', esc(res.rancherName || '—'), euro(RESOURCE_DEFS.rancher.base)]);
  if (res.harbor) {
    const gb = res.registryGb ?? 10;
    resRows.push(['⚓ Harbor Registry', `${gb} GB`, euro(gb)]);
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
  if (res.wiki)       resRows.push(['📖 Wiki', esc(res.wikiName || '—'), euro(RESOURCE_DEFS.wiki.base)]);

  return `
    ${pageHeader('admin', {
      crumbs: [{ label: 'Approvals', action: 'admin-goto-inbox' }, { label: r.id }],
      title: `${r.id} — ${r.name}`,
      subtitle: `Submitted by ${esc(r.requester)} (${esc(r.team)}) · ${timeAgo(r.createdAt)}`,
      meta: [['Status', statusChip(r.status)]],
    })}
    <div class="content">

      <div class="card">
        <div class="card__header"><span class="card__title">Request detail</span></div>
        <div class="card__body">
          <div class="kv-grid">
            <div><span class="label">Project</span><span class="value mono">${esc(r.name)}</span></div>
            <div><span class="label">Environment</span><span class="value">${ENVIRONMENTS[r.env].icon} ${ENVIRONMENTS[r.env].label}</span></div>
            <div><span class="label">Network</span><span class="value">${NETWORKS[r.network || 'FR'].flag} ${NETWORKS[r.network || 'FR'].label}</span></div>
            ${r.resources.vm ? `<div><span class="label">Hypervisor</span><span class="value">${(r.hypervisor && r.hypervisor !== 'auto') ? `${HYPERVISORS[r.hypervisor].icon} ${HYPERVISORS[r.hypervisor].label}` : 'Any'}</span></div>` : ''}
            ${r.resources.vm ? `<div><span class="label">VM timeout</span><span class="value">${vmTimeoutValueHtml(r)}</span></div>` : ''}
            <div><span class="label">Size</span><span class="value">${SIZES[r.size].label}${isCustomSized(r) ? ' <span class="chip chip--info">customized</span>' : ''}</span></div>
            <div><span class="label">Requester</span><span class="value">${esc(r.requester)}</span></div>
            <div class="kv--full"><span class="label">Description</span><span class="value">${esc(r.description) || '—'}</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__header"><span class="card__title">Requested resources</span>
          <span class="muted">estimate: <strong>${euro(cost.total)}/month</strong></span></div>
        <div class="card__body--flush table-wrap">
          <table class="bs-table">
            <thead><tr><th>Resource</th><th>Quantity</th><th>Monthly cost</th></tr></thead>
            <tbody>
              ${resRows.map(row => `<tr><td>${row[0]}</td><td class="cell-secondary">${row[1]}</td><td>${row[2]}</td></tr>`).join('')}
              <tr><td style="font-weight:700;">Estimated total</td><td></td><td style="font-weight:700;color:var(--bs-primary);">${euro(cost.total)}/month</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      ${feasShouldShow(r) ? feasibilityCard(r) : ''}

      ${canDecide ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Decision</span></div>
        <div class="card__body">
          ${r.env === 'prod' ? '<div class="banner banner--warning">⚠️ <span><strong>Production</strong> request: check sizing before approval.</span></div>' : ''}
          ${feasShouldShow(r) && !assessFeasibility(r).feasible ? '<div class="banner banner--error">⛔ <span><strong>Insufficient capacity</strong> on the requested target (see above). You can approve anyway (exception) or reject and ask for resizing.</span></div>' : ''}
          ${r.resources.vm && hasVmTimeout(r) ? `<div class="banner banner--info">⏱ <span><strong>VM lease:</strong> ${vmTimeoutValueHtml(r)}</span></div>` : ''}
          ${r.resources.vm && !hasVmTimeout(r) ? '<div class="banner banner--warning">⏱ <span><strong>No VM timeout requested.</strong> Approval will create long-lived VMs.</span></div>' : ''}
          <div class="form-row">
            <label class="field-label">Comment (visible to requester)</label>
            <textarea rows="2" id="admin-comment" placeholder="e.g. Approved — remember to enable backups."></textarea>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button class="btn btn--danger" data-action="admin-reject" data-arg="${esc(r.id)}">Reject</button>
            <button class="btn btn--success" data-action="admin-approve" data-arg="${esc(r.id)}">✓ Approve and provision</button>
          </div>
        </div>
      </div>` : ''}

      ${r.comment && !canDecide ? `
        <div class="banner ${r.status === 'rejected' ? 'banner--error' : 'banner--info'}">💬 <span><strong>Comment:</strong> ${esc(r.comment)}</span></div>` : ''}

      ${r.prov ? adminProvisioningCard(r) : ''}

      <div class="card">
        <div class="card__header"><span class="card__title">Request history</span></div>
        <div class="card__body">
          <ul class="timeline">
            ${r.history.map(h => `<li>${esc(h.label)}<span class="time">${fmtDate(h.ts)}</span></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>`;
}

/* ---- Image request detail (harbor-pull / diode-push) ---- */
function adminImageRequestPage(r) {
  const canDecide = r.status === 'pending';
  const isPull = r.requestType === 'harbor-pull';
  const typeLabel = isPull ? '⚓ Pull image Harbor' : '🔒 Push to diode network';

  return `
    ${pageHeader('admin', {
      crumbs: [{ label: 'Approvals', action: 'admin-goto-inbox' }, { label: r.id }],
      title: `${r.id} — ${typeLabel}`,
      subtitle: `Submitted by ${esc(r.requester)} (${esc(r.team)}) · ${timeAgo(r.createdAt)}`,
      meta: [['Status', statusChip(r.status)]],
    })}
    <div class="content">

      <div class="card">
        <div class="card__header"><span class="card__title">Request detail</span></div>
        <div class="card__body">
          <div class="kv-grid">
            <div><span class="label">Type</span><span class="value">${typeLabel}</span></div>
            <div><span class="label">Team</span><span class="value">${esc(r.team)}</span></div>
            <div><span class="label">Requester</span><span class="value">${esc(r.requester)}</span></div>
            <div><span class="label">Image</span><span class="value mono">harbor.internal/${esc(r.harborProject || '?')}/${esc(r.imageName || '?')}:${esc(r.imageTag || 'latest')}</span></div>
            ${isPull ? `
            <div><span class="label">Target cluster</span><span class="value">${esc(r.targetCluster || '—')}</span></div>
            <div><span class="label">Namespace</span><span class="value">${esc(r.targetNamespace) || 'default'}</span></div>` : `
            <div><span class="label">Target system</span><span class="value">${esc(r.targetSystem || '—')}</span></div>
            <div><span class="label">Path</span><span class="value mono">${esc(r.targetPath || '/images')}</span></div>`}
            <div class="kv--full"><span class="label">Justification</span><span class="value">${esc(r.description) || '—'}</span></div>
          </div>
        </div>
      </div>

      ${!isPull ? `
      <div class="banner banner--info">⚡ <span>Transfer through a <strong>one-way diode</strong>: clearance and audit controls are validated by automated policy checks.</span></div>` : ''}

      ${canDecide ? `
      <div class="card">
        <div class="card__header"><span class="card__title">Decision</span></div>
        <div class="card__body">
          <div class="form-row">
            <label class="field-label">Comment (visible to requester)</label>
            <textarea rows="2" id="admin-comment" placeholder="e.g. Approved — Trivy scan validated."></textarea>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button class="btn btn--danger" data-action="admin-reject" data-arg="${esc(r.id)}">Reject</button>
            <button class="btn btn--success" data-action="admin-approve" data-arg="${esc(r.id)}">✓ Approve and run pipeline</button>
          </div>
        </div>
      </div>` : ''}

      ${r.comment && !canDecide ? `
        <div class="banner ${r.status === 'rejected' ? 'banner--error' : 'banner--info'}">💬 <span><strong>Comment:</strong> ${esc(r.comment)}</span></div>` : ''}

      ${r.prov ? adminProvisioningCard(r) : ''}

      <div class="card">
        <div class="card__header"><span class="card__title">Request history</span></div>
        <div class="card__body">
          <ul class="timeline">
            ${r.history.map(h => `<li>${esc(h.label)}<span class="time">${fmtDate(h.ts)}</span></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>`;
}

/* Provisioning card: vertical stepper + progress + console */
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
          <span class="card__title">Automated provisioning</span>
          <div class="card__subtitle">Simulated pipeline — no real system calls</div>
        </div>
        ${finished ? '<span class="status status--available">Done</span>' : '<span class="status status--running">In progress</span>'}
      </div>
      <div class="card__body">
        <div class="muted" style="display:flex;justify-content:space-between;">
          <span>Overall progress</span><span>${pct}%</span>
        </div>
        <div class="progress"><div class="progress__bar ${finished ? 'progress__bar--done' : ''}" style="width:${pct}%"></div></div>

        <ul class="vstepper" style="margin-top:18px;">
          ${getProvSteps(r).map((step, i) => {
            const st = p.steps[i];
            const cls = st === 'done' ? 'is-done' : st === 'active' ? 'is-active' : st === 'skipped' ? 'is-skipped' : '';
            const icon = st === 'done' ? '✓' : st === 'skipped' ? '–' : String(i + 1);
            const detail = st === 'skipped' ? 'Skipped — resource not requested'
              : st === 'active' ? 'Running...'
              : st === 'done' ? 'Done' : 'Pending';
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

        <div class="muted" style="margin:4px 0 6px;">Execution log</div>
        <div class="console" id="prov-console">
          ${p.log.map(l => `<div><span class="ts">${l.ts}</span><span class="${l.cls}">${esc(l.text)}</span></div>`).join('')}
          ${!finished ? '<div><span class="ts">··</span><span class="info">▍</span></div>' : ''}
        </div>
      </div>
    </div>`;
}

/* ---- 6.3 Activity log ---- */
function adminActivityPage() {
  return `
    ${pageHeader('admin', {
      title: 'Activity log',
      subtitle: 'Auditable trace of governance and provisioning actions',
      meta: [['Events', String(state.activity.length)]],
    })}
    <div class="content">
      <div class="card">
        ${state.activity.length ? state.activity.map(a => `
          <div class="activity-row">
            <div class="activity-row__icon">${a.icon}</div>
            <div>${esc(a.text)}</div>
            <div class="activity-row__time">${fmtDate(a.ts)} · ${timeAgo(a.ts)}</div>
          </div>`).join('')
        : emptyState('🗒️', 'Empty log', 'Approval and provisioning actions will appear here.')}
      </div>
    </div>`;
}

/* ============================================================
   7. Provisioning Simulation
   ============================================================ */

function approveRequest(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || r.status !== 'pending') return;
  const comment = ($('#admin-comment')?.value || '').trim();
  r.status = 'approved';
  r.comment = comment;
  r.history.push({ ts: now(), label: 'Approved by Anthony Durand' + (comment ? ` — "${comment}"` : '') });
  logActivity('✅', `Anthony Durand approved request ${id} (${r.name}).`);
  saveState();
  renderAdmin(); renderBadges();
  toast('admin', `Request <strong>${id}</strong> approved — starting provisioning`, 'success');
  notifyUser(r, `✅ Your request <strong>${id}</strong> was approved`, 'success');

  // Short delay before starting the pipeline, for demo pacing.
  setTimeout(() => startProvisioning(id), 1200);
}

function rejectRequest(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || r.status !== 'pending') return;
  const comment = ($('#admin-comment')?.value || '').trim();
  r.status = 'rejected';
  r.comment = comment || 'Request rejected by the platform team.';
  r.history.push({ ts: now(), label: 'Rejected by Anthony Durand' + (comment ? ` — "${comment}"` : '') });
  logActivity('⛔', `Anthony Durand rejected request ${id} (${r.name}).`);
  saveState();
  renderAdmin(); renderBadges();
  toast('admin', `Request <strong>${id}</strong> rejected`, 'error');
  notifyUser(r, `⛔ Your request <strong>${id}</strong> was rejected`, 'error');
}

function startProvisioning(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || (r.status !== 'approved' && r.status !== 'provisioning')) return;
  r.status = 'provisioning';
  if (!r.prov) {
    r.prov = { steps: getProvSteps(r).map(() => 'pending'), log: [] };
    provLog(r, 'info', `Provisioning pipeline started for "${r.name}" (${ENVIRONMENTS[r.env].label})`);
    r.history.push({ ts: now(), label: 'Provisioning started' });
  }
  saveState();
  renderAdmin(); renderBadges();
  notifyUser(r, `⚙️ Provisioning for <strong>${esc(r.name)}</strong> in progress`, 'info');
  advanceProvisioning(id);
}

/* Run the next unprocessed step, then reschedule itself */
function advanceProvisioning(id) {
  const r = state.requests.find(x => x.id === id);
  if (!r || r.status !== 'provisioning') return;
  const idx = r.prov.steps.findIndex(s => s === 'pending' || s === 'active');
  if (idx === -1) { finishProvisioning(r); return; }

  const step = getProvSteps(r)[idx];

  // Step not relevant to the request: mark as skipped and continue.
  if (!step.needs(r)) {
    r.prov.steps[idx] = 'skipped';
    provLog(r, '', `· ${step.title} — skipped (resource not requested)`);
    saveState(); renderAdmin();
    setTimeout(() => advanceProvisioning(id), 450);
    return;
  }

  // Active step: append its log lines, then close it.
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
  r.history.push({ ts: now(), label: 'Provisioning completed — resources available' });
  applyProvisionedTimeouts(r);
  const created = createEntitiesFromRequest(r);
  logActivity('🚀', `Provisioning for ${r.name} completed: ${created} resource(s) created in the catalog.`);
  provLog(r, 'ok', `✔ Provisioning completed — ${created} entit${created === 1 ? 'y' : 'ies'} published to the catalog`);
  saveState();
  renderAdmin(); renderBadges();
  toast('admin', `🚀 Provisioning for <strong>${esc(r.name)}</strong> completed`, 'success');
  notifyUser(r, `🎉 <strong>${esc(r.name)}</strong> is available — resources are visible in the catalog`, 'success');
  // Refresh the user pane to show the new entities.
  refreshUserSafely();
}

function applyProvisionedTimeouts(r) {
  if (!hasVmTimeout(r)) return;
  const timeout = ensureVmTimeout(r, true);
  const firstSchedule = !timeout.expiresAt;
  if (!timeout.startedAt) timeout.startedAt = now();
  if (!timeout.expiresAt) timeout.expiresAt = timeout.startedAt + vmTimeoutDays(r) * DAY;
  timeout.scheduledReminders = VM_TIMEOUT_REMINDERS.map(daysBefore => ({
    daysBefore,
    notifyAt: timeout.expiresAt - daysBefore * DAY,
  }));
  if (firstSchedule) {
    r.history.push({
      ts: now(),
      label: `VM timeout scheduled — auto-delete on ${fmtDateOnly(timeout.expiresAt)}; reminders at ${vmReminderText()}`,
    });
    logActivity('⏱', `VM timeout for ${r.name} scheduled: auto-delete on ${fmtDateOnly(timeout.expiresAt)} with reminders at ${vmReminderText()}.`);
  }
  provLog(r, 'info', `⏱ VM auto-delete scheduled on ${fmtDateOnly(timeout.expiresAt)} · reminders ${vmReminderText()}`);
}

/* Publish the entities matching the request resources */
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
        tags: [ENVIRONMENTS[r.env].label.toLowerCase(), 'size-' + r.size.toLowerCase()],
        description: r.description || `Project provisioned through request ${r.id}.` }); count++;
  if (r.resources.rancher) { add({ name: `${r.name}-rancher`, kind: 'Resource', type: 'rancher-project', tags: ['kubernetes'],
        description: `Rancher project "${r.resources.rancherName || r.name}" (namespaces and quotas) for project ${r.name}.` }); count++; }
  if (r.resources.harbor) { add({ name: `${r.name}-registry`, kind: 'Resource', type: 'harbor-project', tags: ['harbor', 'docker'],
        description: `Harbor image registry for project ${r.name} (${r.resources.registryGb ?? 10} GB).` }); count++; }
  if (r.resources.vm) {
    const timeout = getVmTimeout(r);
    const timeoutTags = hasVmTimeout(r) ? [`lease-${vmTimeoutDays(r)}d`, 'auto-delete'] : [];
    const timeoutAttrs = hasVmTimeout(r) ? {
      expiresAt: timeout.expiresAt,
      timeout: { resource: 'vm', durationDays: vmTimeoutDays(r), reminderDays: [...VM_TIMEOUT_REMINDERS], autoDelete: true },
    } : {};
    add({ name: `${r.name}-vms`, kind: 'Resource', type: 'virtual-machine',
        tags: [`x${r.resources.vmCount}`, r.size.toLowerCase(), (r.network || 'fr').toLowerCase(), ...((r.hypervisor && r.hypervisor !== 'auto') ? [r.hypervisor] : []), ...timeoutTags],
        description: `${r.resources.vmCount} virtual machine(s), plan ${sizePlan(RESOURCE_DEFS.vm, r.size)}${(r.hypervisor && r.hypervisor !== 'auto') ? ` on ${HYPERVISORS[r.hypervisor].label}` : ''} · region ${NETWORKS[r.network || 'FR'].label}.${hasVmTimeout(r) ? ` Auto-delete scheduled on ${fmtDateOnly(timeout.expiresAt)} with reminders at ${vmReminderText()}.` : ''}`,
        ...timeoutAttrs }); count++;
  }
  if (r.resources.postgres) { add({ name: `${r.name}-postgresql`, kind: 'Resource', type: 'database', tags: ['postgresql', sizePlan(RESOURCE_DEFS.postgres, r.size).toLowerCase()],
        description: `Managed PostgreSQL database for project ${r.name}.` }); count++; }
  if (r.resources.mariadb) { add({ name: `${r.name}-mariadb`, kind: 'Resource', type: 'database', tags: ['mariadb', sizePlan(RESOURCE_DEFS.mariadb, r.size).toLowerCase()],
        description: `Managed MariaDB database for project ${r.name}.` }); count++; }
  if (r.resources.mongo) { add({ name: `${r.name}-mongodb`, kind: 'Resource', type: 'database', tags: ['mongodb', sizePlan(RESOURCE_DEFS.mongo, r.size).toLowerCase()],
        description: `Managed MongoDB database for project ${r.name}.` }); count++; }
  if (r.resources.redis) { add({ name: `${r.name}-redis`, kind: 'Resource', type: 'cache', tags: ['redis', sizePlan(RESOURCE_DEFS.redis, r.size).toLowerCase()],
        description: `Managed Redis cache for project ${r.name}.` }); count++; }
  if (r.resources.rabbitmq) { add({ name: `${r.name}-rabbitmq`, kind: 'Resource', type: 'message-broker', tags: ['rabbitmq', sizePlan(RESOURCE_DEFS.rabbitmq, r.size).toLowerCase()],
        description: `Managed RabbitMQ broker for project ${r.name}.` }); count++; }
  if (r.resources.wiki) { add({ name: `${r.name}-wiki`, kind: 'Resource', type: 'wiki', tags: ['wiki'],
        description: `Wiki "${r.resources.wikiName || r.name + '-wiki'}" for project ${r.name}.` }); count++; }
  return count;
}

function provLog(r, cls, text) {
  r.prov.log.push({ ts: clock(), cls, text });
}

/* Notify the user pane and refresh passive pages.
   Never re-render the wizard while it is being edited. */
function notifyUser(r, message, type) {
  toast('user', message, type);
  refreshUserSafely();
}

function refreshUserSafely() {
  if (ui.user.page !== 'wizard') renderUser();
  renderBadges();
}

/* ============================================================
   8. Event Handling
   ============================================================ */

/* Update the active sidebar item according to the current page */
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

/* Keep the user side full-screen until a request has been created */
function updateSplitMode() {
  const split = document.querySelector('.split');
  if (!split) return;
  const userFocus = state.nextRequestNum <= 1042;
  split.classList.toggle('split--user-focus', userFocus);
}

/* --- Sidebar navigation --- */
$('#user-sidebar').addEventListener('click', e => {
  const item = e.target.closest('[data-nav]');
  if (!item) return;
  const nav = item.dataset.nav;
  if (nav === 'catalog') { ui.user.page = 'catalog'; renderUser(); }
  else if (nav === 'create') { ui.user.page = 'create'; renderUser(); }
  else if (nav === 'requests') { ui.user.page = 'requests'; renderUser(); }
  else toast('user', 'Section not included in this mockup', 'warning');
});

$('#admin-sidebar').addEventListener('click', e => {
  const item = e.target.closest('[data-nav]');
  if (!item) return;
  const nav = item.dataset.nav;
  if (nav === 'inbox') { ui.admin.page = 'inbox'; renderAdmin(); }
  else if (nav === 'activity') { ui.admin.page = 'activity'; renderAdmin(); }
  else toast('admin', 'Section not included in this mockup', 'warning');
});

/* --- User pane actions (delegation) --- */
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
    case 'not-included': toast('user', 'Feature not included in this mockup', 'warning'); break;

    /* Image wizard (harbor-pull / diode-push) */
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
    /* Infrastructure wizard */
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
    case 'wiz-vm-timeout-toggle':
      if (w) {
        const timeout = ensureVmTimeout(w.data, true);
        timeout.enabled = !!el.checked;
        renderUser();
      }
      break;
    case 'tpl-category': ui.user.templateCategory = arg; renderUser(); break;
    case 'wiz-goto-step': if (w) { const s = parseInt(arg, 10); if (s < w.step && !(w.resourceKey && s === 2)) { w.step = s; w.error = ''; renderUser(); } } break;
    case 'wiz-res':
      if (w && e.target.tagName !== 'INPUT' && !e.target.closest('.pick-card__qty')) {
        w.data.resources[arg] = !w.data.resources[arg];
        if (arg === 'vm' && w.data.resources.vm) ensureVmTimeout(w.data, true);
        w.error = '';
        renderUser();
      }
      break;
  }
});

/* Re-render the user pane, then restore focus (and caret) to the edited field.
   Used for fields whose changes affect display (price, VM rows...). */
function rerenderKeepFocus(selector, srcInput) {
  const pos = srcInput.selectionStart;
  renderUser();
  const again = document.querySelector(selector);
  if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (_) {} }
}

/* Field input handling (without re-rendering, to avoid losing focus) */
$('#user-main').addEventListener('input', e => {
  const key = e.target.dataset.input;
  if (!key) return;
  const w = ui.wizard;
  switch (key) {
    /* Image wizard input */
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
    /* Infrastructure wizard input */
    case 'wiz-name': if (w) { w.data.name = e.target.value; rerenderKeepFocus('[data-input="wiz-name"]', e.target); } break;
    case 'wiz-team': if (w) w.data.team = e.target.value; break;
    case 'wiz-hypervisor': if (w) { w.data.hypervisor = e.target.value; renderUser(); } break;
    case 'wiz-vm-duration': {
      if (!w) break;
      const timeout = ensureVmTimeout(w.data, true);
      timeout.durationDays = e.target.value.trim() === '' ? '' : parseInt(e.target.value, 10);
      break;
    }
    case 'wiz-desc': if (w) w.data.description = e.target.value; break;
    case 'wiz-ranchername':    if (w) w.data.resources.rancherName = e.target.value; break;
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
      // Re-render the filtered table + restore focus in the field.
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

/* --- Admin pane actions --- */
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
    case 'not-included': toast('admin', 'Feature not included in this mockup', 'warning'); break;
  }
});

/* --- Demo reset --- */
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Reset the demo? All created requests will be deleted.')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

/* ============================================================
   9. Initialization
   ============================================================ */

renderUser();
renderAdmin();
renderBadges();

/* If the page was reloaded during provisioning, resume it. */
state.requests
  .filter(r => r.status === 'provisioning' || r.status === 'approved')
  .forEach(r => setTimeout(() => startProvisioning(r.id), 800));
