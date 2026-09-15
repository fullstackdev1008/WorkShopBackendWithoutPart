/**
 * LIVE reset + seed of roles & users — replicates the local setup.
 *
 * ⚠️ DESTRUCTIVE: deletes ALL roles, users, permissions, and user_sessions,
 * then re-seeds the 12 roles (11 client roles + super-admin) and 12 users
 * (admin super-admin + 11 starter users) with password "password123".
 *
 * SAFE ONLY on a FRESH database (no transactional data) — user rows are
 * referenced by RESTRICT FKs (e.g. job_cards.created_by) once real data exists,
 * which would block the delete. The whole reset runs in ONE transaction, so any
 * FK conflict ROLLS BACK and nothing is lost (it will simply error out).
 *
 * Run on the SERVER (where .env points at the prod DB):
 *     CONFIRM_RESET=YES node reset-and-seed-live.mjs
 *
 * Idempotent to re-run (it wipes then re-seeds each time).
 */
import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

if (process.env.CONFIRM_RESET !== 'YES') {
  console.error('Refusing to run: set CONFIRM_RESET=YES to confirm wiping ALL roles & users.');
  process.exit(1);
}

const PASSWORD = 'password123';

// 11 client roles + super-admin. (super-admin holds NO permissions — it bypasses
// every check in code.) Mirrors the current local state: Security has NO
// VEHICLE_OUT; foreman roles have NO TECHNICIAN.
const ROLES = {
  'super-admin':            { name: 'Super Admin', perms: [] },
  'service-controller':     { name: 'Service Controller', perms: [['APPOINTMENT','view'],['APPOINTMENT','create'],['APPOINTMENT','edit'],['JOB_CARD','view'],['GATE_ENTRY','view'],['QC_INSPECTION','view'],['WASHBAY','view']] },
  'quality-controller':     { name: 'Quality Controller', perms: [['QC_INSPECTION','view'],['QC_INSPECTION','create'],['QC_INSPECTION','edit'],['QC_OUT','view'],['QC_OUT','create'],['WASHBAY','view'],['WASHBAY','edit']] },
  'security':               { name: 'Security', perms: [['GATE_ENTRY','view'],['GATE_ENTRY','create'],['GATE_ENTRY','edit'],['GATE_ENTRY','delete'],['GATE_RELEASE','view'],['GATE_RELEASE','edit']] },
  'service-foreman':        { name: 'Service Foreman', perms: [['WORKSHOP','view'],['WORKSHOP','create'],['WORKSHOP','edit'],['JOB_CARD','view']] },
  'major-shop-foreman':     { name: 'Major Shop Foreman', perms: [['WORKSHOP','view'],['WORKSHOP','create'],['WORKSHOP','edit'],['JOB_CARD','view']] },
  'major-shop-controller':  { name: 'Major Shop Controller', perms: [['APPOINTMENT','view'],['APPOINTMENT','create'],['APPOINTMENT','edit'],['JOB_CARD','view'],['GATE_ENTRY','view'],['QC_INSPECTION','view'],['WASHBAY','view']] },
  'pdi-foreman':            { name: 'PDI Foreman', perms: [['WORKSHOP','view'],['WORKSHOP','create'],['WORKSHOP','edit'],['JOB_CARD','view']] },
  'pdi-controller':         { name: 'PDI Controller', perms: [['APPOINTMENT','view'],['APPOINTMENT','create'],['APPOINTMENT','edit'],['JOB_CARD','view'],['GATE_ENTRY','view'],['QC_INSPECTION','view'],['WASHBAY','view']] },
  'service-advisor':        { name: 'Service Advisor', perms: [['JOB_CARD','view'],['JOB_CARD','create'],['JOB_CARD','edit'],['JOB_CARD','approve'],['INVOICING','view'],['INVOICING','create'],['INVOICING','edit']] },
  'technician':             { name: 'Technician', perms: [['TECHNICIAN','view'],['TECHNICIAN','edit']] },
  'warranty-clerk':         { name: 'Warranty Clerk', perms: [['JOB_CARD','view'],['JOB_CARD','create'],['JOB_CARD','edit'],['JOB_CARD','approve'],['WARRANTY','view'],['WARRANTY','edit']] },
  'warranty-supervisor':    { name: 'Warranty Supervisor', perms: [['WARRANTY','view'],['WARRANTY','edit'],['JOB_CARD','view']] },
  'parts-counter':          { name: 'Parts Counter', perms: [['PARTS_MANAGER','view'],['PARTS_MANAGER','edit']] },
};

// username, email, roleSlug, shopScope, warrantyOnly
const USERS = [
  ['super_admin',          'admin@workshop.com',                'super-admin',            'ALL',     false],
  ['service_controller',   'service-controller@workshop.com',   'service-controller',     'SERVICE', false],
  ['quality_controller',   'quality-controller@workshop.com',   'quality-controller',     'ALL',     false],
  ['security_user',        'security@workshop.com',              'security',               'ALL',     false],
  ['service_foreman',      'service-foreman@workshop.com',       'service-foreman',        'SERVICE', false],
  ['major_foreman',        'major-foreman@workshop.com',         'major-shop-foreman',     'MAJOR',   false],
  ['major_controller',     'major-controller@workshop.com',      'major-shop-controller',  'MAJOR',   false],
  ['service_advisor',      'advisor@workshop.com',               'service-advisor',        'ALL',     false],
  ['technician_user',      'tech@workshop.com',                  'technician',             'ALL',     false],
  ['warranty_clerk',       'warranty-clerk@workshop.com',        'warranty-clerk',         'ALL',     true],
  ['warranty_supervisor',  'warranty-supervisor@workshop.com',   'warranty-supervisor',    'ALL',     true],
  ['parts_counter',        'parts-counter@workshop.com',         'parts-counter',          'ALL',     false],
  ['pdi_foreman',          'pdi-foreman@workshop.com',           'pdi-foreman',            'PDI',     false],
  ['pdi_controller',       'pdi-controller@workshop.com',        'pdi-controller',         'PDI',     false],
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const ping = await pool.query('select current_database() as db, current_user as usr');
  console.log('Target DB:', ping.rows[0]);

  const hash = await bcrypt.hash(PASSWORD, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) WIPE (order: sessions → users → permissions → roles). Fresh DB only.
    const s = await client.query('DELETE FROM user_sessions');
    const u = await client.query('DELETE FROM users');
    const p = await client.query('DELETE FROM permissions');
    const r = await client.query('DELETE FROM roles');
    console.log(`Wiped: user_sessions=${s.rowCount} users=${u.rowCount} permissions=${p.rowCount} roles=${r.rowCount}`);

    // 2) Seed roles + permissions
    const roleId = {};
    for (const [slug, def] of Object.entries(ROLES)) {
      const ins = await client.query('INSERT INTO roles (name, slug) VALUES ($1,$2) RETURNING id', [def.name, slug]);
      roleId[slug] = ins.rows[0].id;
      for (const [resource, action] of def.perms) {
        await client.query('INSERT INTO permissions (role_id, resource, action) VALUES ($1,$2,$3)', [roleId[slug], resource, action]);
      }
    }
    console.log(`Seeded ${Object.keys(ROLES).length} roles.`);

    // 3) Seed users
    for (const [username, email, slug, shopScope, warrantyOnly] of USERS) {
      await client.query(
        `INSERT INTO users (username, email, password, role_id, shop_scope, warranty_only)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [username, email, hash, roleId[slug], shopScope, warrantyOnly],
      );
    }
    console.log(`Seeded ${USERS.length} users (password: ${PASSWORD}).`);

    await client.query('COMMIT');
    console.log('\n✅ DONE — live roles & users reset to match local.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n❌ ROLLED BACK (nothing changed):', e.message);
    console.error('If this is an FK error, the DB is NOT fresh — it has transactional data referencing users.');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
