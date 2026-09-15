import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { roles, users, permissions } from '../db/models';

// ─── Slug Helper ────────────────────────────────────────────────────────────
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Default Roles ──────────────────────────────────────────────────────────
const DEFAULT_ROLES = [
  { name: 'Super Admin', slug: 'super-admin' },
  { name: 'QC Inspector', slug: 'qc-inspector' },
  { name: 'Security Gate Keeper', slug: 'security-gate-keeper' },
  { name: 'Customer', slug: 'customer' },
  { name: 'Service Advisor', slug: 'service-advisor' },
  { name: 'Parts Manager', slug: 'parts-manager' },
  { name: 'Receptionist', slug: 'receptionist' },
  { name: 'Technician', slug: 'technician' },
  { name: 'Foreman', slug: 'foreman' },
  { name: 'Finance', slug: 'finance' },
];

// ─── Default Users ──────────────────────────────────────────────────────────
const DEFAULT_USERS = [
  {
    username: 'qc_inspector',
    email: 'qc@workshop.com',
    password: 'password123',
    roleSlug: 'qc-inspector',
  },
  {
    username: 'gate_keeper',
    email: 'gatekeeper@workshop.com',
    password: 'password123',
    roleSlug: 'security-gate-keeper',
  },
  {
    username: 'service_advisor',
    email: 'advisor@workshop.com',
    password: 'password123',
    roleSlug: 'service-advisor',
  },
  {
    username: 'super_admin',
    email: 'admin@workshop.com',
    password: 'password123',
    roleSlug: 'super-admin',
  },
  {
    username: 'parts_manager',
    email: 'partsmanager@workshop.com',
    password: 'password123',
    roleSlug: 'parts-manager',
  },
  {
    username: 'receptionist',
    email: 'receptionist@workshop.com',
    password: 'password123',
    roleSlug: 'receptionist',
  },
  {
    username: 'tech1',
    email: 'tech1@workshop.com',
    password: 'password123',
    roleSlug: 'technician',
  },
  {
    username: 'tech2',
    email: 'tech2@workshop.com',
    password: 'password123',
    roleSlug: 'technician',
  },
  {
    username: 'tech3',
    email: 'tech3@workshop.com',
    password: 'password123',
    roleSlug: 'technician',
  },
  {
    username: 'foreman',
    email: 'foreman@workshop.com',
    password: 'password123',
    roleSlug: 'foreman',
  },
  {
    username: 'finance',
    email: 'finance@workshop.com',
    password: 'password123',
    roleSlug: 'finance',
  },
];

// ─── Default Permissions ────────────────────────────────────────────────────
const DEFAULT_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  'super-admin': [
    // Module-level permissions (for frontend routing)
    { resource: 'GATE_ENTRY', action: 'view' },
    { resource: 'QC_INSPECTION', action: 'view' },
    { resource: 'JOB_CARD', action: 'view' },
    { resource: 'PARTS_MANAGER', action: 'view' },
    { resource: 'ROLE_MANAGEMENT', action: 'view' },
    // Resource-level permissions
    { resource: 'vehicles', action: 'read' },
    { resource: 'vehicles', action: 'create' },
    { resource: 'vehicles', action: 'update' },
    { resource: 'vehicles', action: 'delete' },
    { resource: 'vehicle-images', action: 'create' },
    { resource: 'vehicle-images', action: 'update' },
    { resource: 'vehicle-images', action: 'delete' },
    { resource: 'vehicle-accessories', action: 'read' },
    { resource: 'vehicle-accessories', action: 'create' },
    { resource: 'vehicle-accessories', action: 'update' },
    { resource: 'vehicle-accessories', action: 'delete' },
    { resource: 'check-ins', action: 'read' },
    { resource: 'check-ins', action: 'create' },
    { resource: 'check-ins', action: 'update' },
    { resource: 'check-ins', action: 'delete' },
    { resource: 'confirm-entry', action: 'create' },
    { resource: 'customers', action: 'read' },
    { resource: 'customers', action: 'create' },
    { resource: 'customers', action: 'update' },
    { resource: 'customers', action: 'delete' },
    { resource: 'qc-inspections', action: 'read' },
    { resource: 'qc-inspections', action: 'create' },
    { resource: 'qc-inspections', action: 'update' },
    { resource: 'qc-inspections', action: 'delete' },
    { resource: 'service-advisor', action: 'read' },
    { resource: 'service-advisor', action: 'create' },
    { resource: 'service-advisor', action: 'update' },
    { resource: 'service-advisor', action: 'delete' },
  ],
  'qc-inspector': [
    { resource: 'QC_INSPECTION', action: 'view' },
    { resource: 'qc-inspections', action: 'read' },
    { resource: 'qc-inspections', action: 'create' },
    { resource: 'qc-inspections', action: 'update' },
    { resource: 'qc-inspections', action: 'delete' },
    // Phase 5 — QC Out also lives with the QC role.
    { resource: 'QC_OUT', action: 'view' },
    { resource: 'QC_OUT', action: 'create' },
    { resource: 'QC_OUT', action: 'edit' },
  ],
  'technician': [
    { resource: 'TECHNICIAN', action: 'view' },
    { resource: 'qc-inspections', action: 'read' },
    { resource: 'qc-inspections', action: 'update' },
    { resource: 'job-cards', action: 'read' },
    { resource: 'job-cards', action: 'update' },
    { resource: 'vehicles', action: 'read' },
  ],
  'foreman': [
    // Workshop allocation dashboard + bay master CRUD.
    { resource: 'WORKSHOP', action: 'view' },
    { resource: 'WORKSHOP', action: 'create' },
    { resource: 'WORKSHOP', action: 'edit' },
    // Phase 5 — read QC Out outcomes (so failed badge clicks through), and
    // manage the washbay queue.
    { resource: 'QC_OUT', action: 'view' },
    { resource: 'WASHBAY', action: 'view' },
    { resource: 'WASHBAY', action: 'edit' },
    // Read-only on the rest so foreman dashboards can show context.
    { resource: 'vehicles', action: 'read' },
    { resource: 'qc-inspections', action: 'read' },
    { resource: 'job-cards', action: 'read' },
  ],
  'security-gate-keeper': [
    { resource: 'GATE_ENTRY', action: 'view' },
    { resource: 'GATE_ENTRY', action: 'create' },
    { resource: 'GATE_ENTRY', action: 'edit' },
    { resource: 'GATE_ENTRY', action: 'delete' },
    { resource: 'vehicles', action: 'read' },
    { resource: 'vehicles', action: 'create' },
    { resource: 'vehicles', action: 'update' },
    { resource: 'vehicles', action: 'delete' },
    { resource: 'vehicle-images', action: 'create' },
    { resource: 'vehicle-images', action: 'update' },
    { resource: 'vehicle-images', action: 'delete' },
    { resource: 'vehicle-accessories', action: 'read' },
    { resource: 'vehicle-accessories', action: 'create' },
    { resource: 'vehicle-accessories', action: 'update' },
    { resource: 'vehicle-accessories', action: 'delete' },
    { resource: 'check-ins', action: 'read' },
    { resource: 'check-ins', action: 'create' },
    { resource: 'check-ins', action: 'update' },
    { resource: 'check-ins', action: 'delete' },
    { resource: 'confirm-entry', action: 'create' },
    { resource: 'customers', action: 'read' },
    { resource: 'customers', action: 'create' },
    { resource: 'customers', action: 'update' },
    { resource: 'customers', action: 'delete' },
    // Phase 7 — gate verifies + redeems the gate pass at exit.
    { resource: 'GATE_RELEASE', action: 'view' },
    { resource: 'GATE_RELEASE', action: 'edit' },
  ],
  'customer': [
    { resource: 'customers', action: 'read' },
    { resource: 'customers', action: 'create' },
    { resource: 'customers', action: 'update' },
    { resource: 'customers', action: 'delete' },
    { resource: 'service-advisor', action: 'read' },
    { resource: 'service-advisor', action: 'create' },
    { resource: 'service-advisor', action: 'update' },
  ],
  'service-advisor': [
    { resource: 'JOB_CARD', action: 'view' },
    { resource: 'service-advisor', action: 'read' },
    { resource: 'service-advisor', action: 'create' },
    { resource: 'service-advisor', action: 'update' },
    { resource: 'service-advisor', action: 'delete' },
  ],
  'parts-manager': [
    { resource: 'PARTS_MANAGER', action: 'view' },
    { resource: 'parts-manager', action: 'read' },
    { resource: 'parts-manager', action: 'create' },
    { resource: 'parts-manager', action: 'update' },
    // Phase 6 — Parts Manager doubles as Warranty Clerk for v1.
    { resource: 'WARRANTY', action: 'view' },
    { resource: 'WARRANTY', action: 'edit' },
  ],
  'receptionist': [
    { resource: 'APPOINTMENT', action: 'view' },
    { resource: 'APPOINTMENT', action: 'create' },
    { resource: 'APPOINTMENT', action: 'edit' },
    { resource: 'GATE_ENTRY', action: 'view' },
    { resource: 'GATE_ENTRY', action: 'create' },
    { resource: 'GATE_ENTRY', action: 'edit' },
    // Phase 5 — receptionist owns the washbay queue and the final hand-off.
    { resource: 'WASHBAY', action: 'view' },
    { resource: 'WASHBAY', action: 'edit' },
  ],
  // Phase 7 — Finance: build/generate invoices, capture payments, void.
  'finance': [
    { resource: 'INVOICING', action: 'view' },
    { resource: 'INVOICING', action: 'create' },
    { resource: 'INVOICING', action: 'edit' },
    { resource: 'INVOICING', action: 'delete' },
    { resource: 'JOB_CARD', action: 'view' },
    { resource: 'job-cards', action: 'read' },
    { resource: 'customers', action: 'read' },
    { resource: 'vehicles', action: 'read' },
  ],
};

// ─── Seed Function ──────────────────────────────────────────────────────────
async function seed() {
  console.log('Starting seed...\n');

  // 1. Create roles
  console.log('Creating roles...');
  const roleMap = new Map<string, string>(); // slug → id

  for (const role of DEFAULT_ROLES) {
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.slug, role.slug))
      .limit(1);

    if (existing) {
      roleMap.set(role.slug, existing.id);
      console.log(`  ✓ Role "${role.name}" already exists (${existing.id})`);
    } else {
      const [created] = await db
        .insert(roles)
        .values({ name: role.name, slug: role.slug })
        .returning({ id: roles.id });
      roleMap.set(role.slug, created.id);
      console.log(`  + Role "${role.name}" created (${created.id})`);
    }
  }

  // 2. Create users
  console.log('\nCreating users...');
  for (const user of DEFAULT_USERS) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, user.email))
      .limit(1);

    if (existing) {
      console.log(`  ✓ User "${user.username}" already exists (${existing.id})`);
      continue;
    }

    const hashedPassword = await bcrypt.hash(user.password, 12);
    const roleId = roleMap.get(user.roleSlug);

    if (!roleId) {
      console.log(`  ✗ Role "${user.roleSlug}" not found, skipping user "${user.username}"`);
      continue;
    }

    const [created] = await db
      .insert(users)
      .values({
        username: user.username,
        email: user.email,
        password: hashedPassword,
        roleId,
      })
      .returning({ id: users.id });

    console.log(`  + User "${user.username}" created (${created.id}) → role: ${user.roleSlug}`);
  }

  // 3. Create permissions
  console.log('\nCreating permissions...');
  for (const [roleSlug, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
    const roleId = roleMap.get(roleSlug);
    if (!roleId) {
      console.log(`  ✗ Role "${roleSlug}" not found, skipping permissions`);
      continue;
    }

    for (const perm of perms) {
      const [existing] = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          eq(permissions.roleId, roleId),
        )
        .limit(1);

      // Use upsert approach - just try inserting, ignore conflicts
      try {
        await db
          .insert(permissions)
          .values({
            roleId,
            resource: perm.resource,
            action: perm.action,
          })
          .onConflictDoNothing();
        console.log(`  + ${roleSlug}: ${perm.resource}:${perm.action}`);
      } catch {
        console.log(`  ✓ ${roleSlug}: ${perm.resource}:${perm.action} (exists)`);
      }
    }
  }

  console.log('\n─── Seed completed successfully! ───');
  console.log('\nDefault login credentials:');
  console.log('  Super Admin:          admin@workshop.com / password123');
  console.log('  QC Inspector:         qc@workshop.com / password123');
  console.log('  Security Gate Keeper: gatekeeper@workshop.com / password123');
  console.log('  Service Advisor:      advisor@workshop.com / password123');
  console.log('  Parts Manager:        partsmanager@workshop.com / password123');
  console.log('  Receptionist:         receptionist@workshop.com / password123');
}

// ─── Run ────────────────────────────────────────────────────────────────────
seed()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    pool.end();
    process.exit(1);
  });
