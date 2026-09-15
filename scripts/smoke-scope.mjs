/**
 * Scope smoke test (Phase 8) — end-to-end verification of Major-Shop /
 * Warranty scoping. Self-contained and self-cleaning:
 *   1. SETUP   — create temp roles+users (known password), assign scopes, tag
 *                two active check-ins (MAJOR/SERVICE) and two job cards
 *                (warranty/repair). Originals recorded for revert.
 *   2. ASSERT  — log in over HTTP and check status codes prove the scope guards
 *                (403 out-of-scope, scoped lists 200, super-admin/ALL bypass).
 *   3. TEARDOWN— always runs: revert data tags, delete temp users + roles.
 *
 * Touches only its own temp rows + reverts the few tagged records. Safe to
 * re-run (cleans leftovers first). DEV ONLY — point BASE_URL at a dev server.
 *
 * Usage:  node scripts/smoke-scope.mjs           (BASE_URL defaults to :3000)
 *         BASE_URL=http://localhost:3000 node scripts/smoke-scope.mjs
 */
import 'dotenv/config';
import { Pool } from 'pg';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = 'Smoke#12345';
const EMAIL = (k) => `smoke-${k}@smoke.test`;

if (typeof fetch !== 'function') {
  console.error('global fetch unavailable — use Node 18+');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const q = (text, params) => pool.query(text, params);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      // Only set JSON content-type when a body is present — an empty POST with
      // application/json triggers a Fastify 400 (empty-body parse) before the
      // handler runs, which would mask the scope guard under test.
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

async function login(email) {
  const r = await api('POST', '/api/auth/login', null, { email, password: PASSWORD });
  return r.json?.data?.token ?? null;
}

// ─── Temp role definitions ──────────────────────────────────────────────────
const ROLES = {
  'smoke-foreman': [['WORKSHOP', 'view'], ['WORKSHOP', 'create'], ['WORKSHOP', 'edit'], ['JOB_CARD', 'view']],
  'smoke-controller': [
    ['APPOINTMENT', 'view'], ['JOB_CARD', 'view'], ['GATE_ENTRY', 'view'],
    ['QC_INSPECTION', 'view'], ['WASHBAY', 'view'],
  ],
  'smoke-clerk': [
    ['JOB_CARD', 'view'], ['JOB_CARD', 'create'], ['JOB_CARD', 'edit'],
    ['JOB_CARD', 'approve'], ['WARRANTY', 'view'], ['WARRANTY', 'edit'],
  ],
};
// persona key → { roleSlug, shopScope, warrantyOnly }
const USERS = {
  'foreman-major':   { role: 'smoke-foreman',   shop: 'MAJOR',   warranty: false },
  'controller-major':{ role: 'smoke-controller',shop: 'MAJOR',   warranty: false },
  'controller-all':  { role: 'smoke-controller',shop: 'ALL',     warranty: false },
  'clerk':           { role: 'smoke-clerk',      shop: 'ALL',     warranty: true  },
  'super':           { role: 'super-admin',      shop: 'ALL',     warranty: false },
};

const saved = { checkins: [], jobcards: [] };

async function cleanupLeftovers() {
  // delete any prior smoke users + smoke roles (idempotent re-run)
  await q(`DELETE FROM users WHERE email LIKE '%@smoke.test'`);
  await q(`DELETE FROM roles WHERE slug LIKE 'smoke-%'`);
}

async function setup() {
  await cleanupLeftovers();

  // temp roles + permissions
  for (const [slug, perms] of Object.entries(ROLES)) {
    const { rows } = await q(
      `INSERT INTO roles (name, slug) VALUES ($1,$2) RETURNING id`,
      [slug, slug],
    );
    const roleId = rows[0].id;
    for (const [resource, action] of perms) {
      await q(
        `INSERT INTO permissions (role_id, resource, action) VALUES ($1,$2,$3)`,
        [roleId, resource, action],
      );
    }
  }

  // temp users via register (sets bcrypt password), then set scope via DB
  for (const [key, cfg] of Object.entries(USERS)) {
    const reg = await api('POST', '/api/auth/register', null, {
      username: `smoke_${key.replace(/-/g, '_')}`,
      email: EMAIL(key),
      password: PASSWORD,
      roleSlug: cfg.role,
    });
    if (!reg.json?.data) throw new Error(`register ${key} failed: ${JSON.stringify(reg.json)}`);
    await q(
      `UPDATE users SET shop_scope=$1, warranty_only=$2 WHERE email=$3`,
      [cfg.shop, cfg.warranty, EMAIL(key)],
    );
  }

  // tag two active check-ins (record originals to revert)
  const cis = (await q(`SELECT id, shop FROM vehicle_check_ins WHERE is_active=true ORDER BY check_in_time DESC LIMIT 2`)).rows;
  if (cis.length < 2) throw new Error('need ≥2 active check-ins to test');
  saved.checkins = cis.map((r) => ({ id: r.id, shop: r.shop }));
  await q(`UPDATE vehicle_check_ins SET shop='MAJOR'   WHERE id=$1`, [cis[0].id]);
  await q(`UPDATE vehicle_check_ins SET shop='SERVICE' WHERE id=$1`, [cis[1].id]);

  // tag two job cards (warranty / repair)
  const jcs = (await q(`SELECT id, service_type FROM job_cards ORDER BY created_at DESC LIMIT 2`)).rows;
  if (jcs.length < 2) throw new Error('need ≥2 job cards to test');
  saved.jobcards = jcs.map((r) => ({ id: r.id, service_type: r.service_type }));
  await q(`UPDATE job_cards SET service_type='Warranty Service' WHERE id=$1`, [jcs[0].id]);
  await q(`UPDATE job_cards SET service_type='Repair'           WHERE id=$1`, [jcs[1].id]);

  return {
    CI_MAJOR: cis[0].id,
    CI_SERVICE: cis[1].id,
    JC_WARRANTY: jcs[0].id,
    JC_REPAIR: jcs[1].id,
  };
}

async function teardown() {
  for (const c of saved.checkins) await q(`UPDATE vehicle_check_ins SET shop=$1 WHERE id=$2`, [c.shop, c.id]);
  for (const j of saved.jobcards) await q(`UPDATE job_cards SET service_type=$1 WHERE id=$2`, [j.service_type, j.id]);
  await cleanupLeftovers();
}

async function run() {
  const ids = await setup();
  const tok = {};
  for (const key of Object.keys(USERS)) {
    tok[key] = await login(EMAIL(key));
    if (!tok[key]) throw new Error(`login failed for ${key}`);
  }
  const dummyAlloc = { bayId: '00000000-0000-0000-0000-000000000000', priority: 'MEDIUM', repairCategory: 'OTHER' };

  // ── Major Foreman ──
  let r = await api('GET', '/api/workshop/dashboard', tok['foreman-major']);
  check('Foreman(MAJOR) workshop dashboard → 200', r.status === 200, `got ${r.status}`);
  r = await api('POST', `/api/workshop/check-ins/${ids.CI_SERVICE}/allocate`, tok['foreman-major'], dummyAlloc);
  check('Foreman(MAJOR) allocate SERVICE check-in → 403 (IDOR)', r.status === 403, `got ${r.status}`);
  r = await api('POST', `/api/workshop/check-ins/${ids.CI_MAJOR}/allocate`, tok['foreman-major'], dummyAlloc);
  check('Foreman(MAJOR) allocate MAJOR check-in → not 403 (scope allowed)', r.status !== 403, `got ${r.status}`);

  // ── Major Controller ──
  r = await api('GET', `/api/check-ins/${ids.CI_MAJOR}`, tok['controller-major']);
  check('Controller(MAJOR) get MAJOR check-in → 200', r.status === 200, `got ${r.status}`);
  r = await api('GET', `/api/check-ins/${ids.CI_SERVICE}`, tok['controller-major']);
  check('Controller(MAJOR) get SERVICE check-in → 403 (IDOR)', r.status === 403, `got ${r.status}`);
  r = await api('GET', '/api/service-advisor/dashboard', tok['controller-major']);
  check('Controller(MAJOR) job-cards dashboard → 200', r.status === 200, `got ${r.status}`);

  // ── Warranty Clerk ──
  r = await api('GET', `/api/service-advisor/job-cards/${ids.JC_WARRANTY}`, tok['clerk']);
  check('Clerk get WARRANTY job card → 200', r.status === 200, `got ${r.status}`);
  r = await api('GET', `/api/service-advisor/job-cards/${ids.JC_REPAIR}`, tok['clerk']);
  check('Clerk get non-warranty job card → 403 (IDOR)', r.status === 403, `got ${r.status}`);
  r = await api('POST', `/api/service-advisor/job-cards/${ids.JC_REPAIR}/share`, tok['clerk']);
  check('Clerk share non-warranty job card → 403 (IDOR)', r.status === 403, `got ${r.status} :: ${r.json?.error?.message ?? ''}`);

  // ── Bypass / regression ──
  r = await api('GET', `/api/check-ins/${ids.CI_SERVICE}`, tok['super']);
  check('Super-admin get SERVICE check-in → 200 (bypass)', r.status === 200, `got ${r.status}`);
  r = await api('GET', `/api/check-ins/${ids.CI_SERVICE}`, tok['controller-all']);
  check('Controller(ALL) get SERVICE check-in → 200 (unscoped, no regression)', r.status === 200, `got ${r.status}`);
}

(async () => {
  let failed = false;
  try {
    await run();
  } catch (e) {
    console.error('\nERROR during run:', e.message);
    failed = true;
  } finally {
    try { await teardown(); console.log('\n(teardown complete — temp users/roles removed, data tags reverted)'); }
    catch (e) { console.error('TEARDOWN FAILED:', e.message); failed = true; }
    await pool.end();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} assertions passed`);
  process.exit(failed || passed !== results.length ? 1 : 0);
})();
