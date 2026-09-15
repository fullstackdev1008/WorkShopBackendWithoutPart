/**
 * Seed one starter user per client role (demo logins). Idempotent: skips an
 * email that already exists. Password for all = "password123".
 * Sets shop_scope / warranty_only per the client requirement so scoping is
 * immediately demoable. Super users use the existing super-admin login.
 *
 * Usage:  node scripts/seed-client-users.mjs
 */
import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const PASSWORD = 'password123';

// username, email, roleSlug, shopScope, warrantyOnly
const USERS = [
  ['service_controller',   'service-controller@workshop.com',   'service-controller',   'SERVICE', false],
  ['quality_controller',   'quality-controller@workshop.com',   'quality-controller',   'ALL',     false],
  ['security_user',        'security@workshop.com',              'security',             'ALL',     false],
  ['service_foreman',      'service-foreman@workshop.com',       'service-foreman',      'SERVICE', false],
  ['major_foreman',        'major-foreman@workshop.com',         'major-shop-foreman',   'MAJOR',   false],
  ['major_controller',     'major-controller@workshop.com',      'major-shop-controller','MAJOR',   false],
  ['service_advisor',      'advisor@workshop.com',               'service-advisor',      'ALL',     false],
  ['technician_user',      'tech@workshop.com',                  'technician',           'ALL',     false],
  ['warranty_clerk',       'warranty-clerk@workshop.com',        'warranty-clerk',       'ALL',     true],
  ['warranty_supervisor',  'warranty-supervisor@workshop.com',   'warranty-supervisor',  'ALL',     true],
  ['parts_counter',        'parts-counter@workshop.com',         'parts-counter',        'ALL',     false],
  ['pdi_foreman',          'pdi-foreman@workshop.com',           'pdi-foreman',          'PDI',     false],
  ['pdi_controller',       'pdi-controller@workshop.com',        'pdi-controller',       'PDI',     false],
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const hash = await bcrypt.hash(PASSWORD, 12);
  const report = [];

  for (const [username, email, roleSlug, shopScope, warrantyOnly] of USERS) {
    const [role] = (await pool.query('SELECT id FROM roles WHERE slug=$1', [roleSlug])).rows;
    if (!role) { report.push({ email, role: roleSlug, status: 'SKIP (role missing)' }); continue; }

    const exists = (await pool.query('SELECT id FROM users WHERE email=$1 AND is_deleted=false', [email])).rows[0];
    if (exists) {
      // keep idempotent: ensure scope is correct even if the user already exists
      await pool.query('UPDATE users SET shop_scope=$1, warranty_only=$2 WHERE id=$3', [shopScope, warrantyOnly, exists.id]);
      report.push({ email, role: roleSlug, scope: shopScope, warranty: warrantyOnly, status: 'existed (scope synced)' });
      continue;
    }
    await pool.query(
      `INSERT INTO users (username, email, password, role_id, shop_scope, warranty_only)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [username, email, hash, role.id, shopScope, warrantyOnly],
    );
    report.push({ email, role: roleSlug, scope: shopScope, warranty: warrantyOnly, status: 'CREATED' });
  }

  console.log('\n=== Starter users (password: ' + PASSWORD + ') ===');
  console.table(report);
  console.log('\nSuper users (Admin Manager / Workshop Manager / H.O.D): use admin@workshop.com (super-admin).');
  await pool.end();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
