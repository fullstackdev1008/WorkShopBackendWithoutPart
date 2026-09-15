/**
 * Seed the client's 14 roles (Phase: rollout).
 *
 * Idempotent + ADDITIVE: ensures each role exists (by slug) and adds any
 * MISSING permissions. It never deletes a role or removes a permission, so it
 * is safe to re-run and safe on roles that already have live users.
 *
 *   • 11 operational roles are created/topped-up with the exact permission
 *     grids from the client requirement.
 *   • 3 "Super User" titles (Admin Manager / Workshop Manager / H.O.D) are NOT
 *     new roles — they use the existing `super-admin` role (a hard-coded bypass
 *     that cannot be reproduced via permissions). The script reports this.
 *
 * Shop scope (Service vs Major) and warranty-only are USER attributes, not role
 * permissions — set them per user in User Management when creating users. The
 * intended scope for each role is printed at the end as a checklist.
 *
 * Usage:  node scripts/seed-client-roles.mjs
 */
import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

// resource:action grids per role (modules match shared/security/permissions.ts)
const ROLES = {
  'service-controller': {
    name: 'Service Controller',
    perms: [
      ['APPOINTMENT', 'view'], ['APPOINTMENT', 'create'], ['APPOINTMENT', 'edit'],
      ['JOB_CARD', 'view'], ['GATE_ENTRY', 'view'], ['QC_INSPECTION', 'view'], ['WASHBAY', 'view'],
    ],
  },
  'quality-controller': {
    name: 'Quality Controller',
    perms: [
      ['QC_INSPECTION', 'view'], ['QC_INSPECTION', 'create'], ['QC_INSPECTION', 'edit'],
      ['QC_OUT', 'view'], ['QC_OUT', 'create'], ['WASHBAY', 'view'], ['WASHBAY', 'edit'],
    ],
  },
  'security': {
    name: 'Security',
    perms: [
      ['GATE_ENTRY', 'view'], ['GATE_ENTRY', 'create'], ['GATE_ENTRY', 'edit'], ['GATE_ENTRY', 'delete'],
      ['GATE_RELEASE', 'view'], ['GATE_RELEASE', 'edit'],
      // VEHICLE_OUT intentionally NOT granted — "Vehicle Out" is hidden from the
      // Security sidebar; gate-out is handled via Gate Release (gate pass).
    ],
  },
  // Foreman roles do NOT get TECHNICIAN:view — that would surface the Technician
  // dashboard in their sidebar. Tech allocation uses the /technicians picker,
  // which is guarded by JOB_CARD:view / WORKSHOP:view (both held here), and the
  // assign action itself by WORKSHOP:edit — so allocation still works.
  'service-foreman': {
    name: 'Service Foreman',
    perms: [['WORKSHOP', 'view'], ['WORKSHOP', 'create'], ['WORKSHOP', 'edit'], ['JOB_CARD', 'view']],
  },
  'major-shop-foreman': {
    name: 'Major Shop Foreman',
    perms: [['WORKSHOP', 'view'], ['WORKSHOP', 'create'], ['WORKSHOP', 'edit'], ['JOB_CARD', 'view']],
  },
  'major-shop-controller': {
    name: 'Major Shop Controller',
    perms: [
      ['APPOINTMENT', 'view'], ['APPOINTMENT', 'create'], ['APPOINTMENT', 'edit'],
      ['JOB_CARD', 'view'], ['GATE_ENTRY', 'view'], ['QC_INSPECTION', 'view'], ['WASHBAY', 'view'],
    ],
  },
  // PDI shop — mirrors the Service/Major foreman + controller grids; scope to PDI.
  'pdi-foreman': {
    name: 'PDI Foreman',
    perms: [['WORKSHOP', 'view'], ['WORKSHOP', 'create'], ['WORKSHOP', 'edit'], ['JOB_CARD', 'view']],
  },
  'pdi-controller': {
    name: 'PDI Controller',
    perms: [
      ['APPOINTMENT', 'view'], ['APPOINTMENT', 'create'], ['APPOINTMENT', 'edit'],
      ['JOB_CARD', 'view'], ['GATE_ENTRY', 'view'], ['QC_INSPECTION', 'view'], ['WASHBAY', 'view'],
    ],
  },
  'service-advisor': {
    name: 'Service Advisor',
    perms: [
      ['JOB_CARD', 'view'], ['JOB_CARD', 'create'], ['JOB_CARD', 'edit'], ['JOB_CARD', 'approve'],
      ['INVOICING', 'view'], ['INVOICING', 'create'], ['INVOICING', 'edit'],
    ],
  },
  'technician': {
    name: 'Technician',
    perms: [['TECHNICIAN', 'view'], ['TECHNICIAN', 'edit']],
  },
  'warranty-clerk': {
    name: 'Warranty Clerk',
    perms: [
      ['JOB_CARD', 'view'], ['JOB_CARD', 'create'], ['JOB_CARD', 'edit'], ['JOB_CARD', 'approve'],
      ['WARRANTY', 'view'], ['WARRANTY', 'edit'],
    ],
  },
  'warranty-supervisor': {
    name: 'Warranty Supervisor',
    perms: [['WARRANTY', 'view'], ['WARRANTY', 'edit'], ['JOB_CARD', 'view']],
  },
  'parts-counter': {
    name: 'Parts Counter',
    perms: [['PARTS_MANAGER', 'view'], ['PARTS_MANAGER', 'edit']],
  },
};

// User-scope checklist (scope is a per-user attribute, not a role permission)
const SCOPE_HINTS = {
  'service-controller': 'shop_scope = SERVICE',
  'major-shop-controller': 'shop_scope = MAJOR',
  'service-foreman': 'shop_scope = SERVICE',
  'major-shop-foreman': 'shop_scope = MAJOR',
  'pdi-foreman': 'shop_scope = PDI',
  'pdi-controller': 'shop_scope = PDI',
  'warranty-clerk': 'warranty_only = true (also needs JOB_CARD:approve — included)',
  'warranty-supervisor': 'warranty_only = true',
};

(async () => {
  const report = [];
  for (const [slug, def] of Object.entries(ROLES)) {
    // ensure role exists
    let { rows } = await pool.query(`SELECT id FROM roles WHERE slug=$1`, [slug]);
    let created = false;
    let roleId;
    if (rows.length === 0) {
      const ins = await pool.query(`INSERT INTO roles (name, slug) VALUES ($1,$2) RETURNING id`, [def.name, slug]);
      roleId = ins.rows[0].id;
      created = true;
    } else {
      roleId = rows[0].id;
    }
    // add missing permissions only (unique index uq_permissions_role_resource_action)
    let added = 0;
    for (const [resource, action] of def.perms) {
      const r = await pool.query(
        `INSERT INTO permissions (role_id, resource, action) VALUES ($1,$2,$3)
         ON CONFLICT (role_id, resource, action) DO NOTHING`,
        [roleId, resource, action],
      );
      added += r.rowCount;
    }
    report.push({ role: def.name, slug, status: created ? 'CREATED' : 'existed', permsAdded: added, totalPerms: def.perms.length });
  }

  console.log('\n=== Operational roles seeded (idempotent, additive) ===');
  console.table(report);

  console.log('\n=== Super Users (no new role — assign the existing super-admin role) ===');
  console.log('  Admin Manager · Workshop Manager · H.O.D  →  role = super-admin');

  console.log('\n=== Per-user scope checklist (set in User Management when creating users) ===');
  for (const [slug, hint] of Object.entries(SCOPE_HINTS)) console.log(`  ${slug.padEnd(22)} → ${hint}`);
  console.log('  all other roles                      → shop_scope = ALL, warranty_only = false');

  console.log('\n=== Counts to create as USERS (same role, N users) ===');
  console.log('  Service Advisor ×2 · Technician ×17 · Warranty Clerk ×2');

  await pool.end();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
