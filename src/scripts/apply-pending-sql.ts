import 'dotenv/config';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';

(async () => {
  const files = [
    'drizzle/0005_apt_seq.sql',
    'drizzle/0006_unique_registration_active.sql',
    'drizzle/0007_check_in_actor_columns.sql',
    'drizzle/0008_job_card_assign_technician.sql',
    'drizzle/0009_job_card_item_assign_technician.sql',
    'drizzle/0010_job_card_item_time_logs.sql',
    'drizzle/0011_job_card_item_completion_notes.sql',
    'drizzle/0012_job_card_item_assigned_by.sql',
    'drizzle/0013_phase1_arrival_capture.sql',
    'drizzle/0014_phase2_workshop_allocation.sql',
    'drizzle/0015_phase3_technician_enhancements.sql',
    'drizzle/0016_phase4_alerts_notifications.sql',
    'drizzle/0017_phase5_qc_out_washbay.sql',
    'drizzle/0018_phase6_warranty_store.sql',
    'drizzle/0019_phase7_invoicing_release.sql',
    'drizzle/0020_qc_out_works.sql',
    'drizzle/0021_rework_notes.sql',
    'drizzle/0022_part_request_pricing.sql',
    'drizzle/0023_part_request_auto_assign.sql',
    'drizzle/0024_part_photo_types.sql',
    'drizzle/0025_qc_out_checklist_unique.sql',
    'drizzle/0026_item_reassignments.sql',
    'drizzle/0027_evolve_full_persist.sql',
  ];
  for (const f of files) {
    const content = readFileSync(join(process.cwd(), f), 'utf8');
    console.log(`-- applying ${f}`);
    await db.execute(sql.raw(content));
    console.log(`-- ok: ${f}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
