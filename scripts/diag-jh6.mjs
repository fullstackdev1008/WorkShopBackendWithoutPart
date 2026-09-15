/**
 * Diagnostic: shows which DB this .env points at and whether the JH6 AMC
 * assignments exist there. Run from /var/www/backend:  node scripts/diag-jh6.mjs
 */
import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL || '(unset)';
// Mask password
const masked = url.replace(/(:\/\/[^:]+:)[^@]*(@)/, '$1***$2');
console.log('DATABASE_URL (.env, masked):', masked);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const who = await pool.query('SELECT current_database() AS db, inet_server_addr() AS host');
  console.log('Connected to DB:', who.rows[0].db, '@', who.rows[0].host || 'localhost/socket');

  const total = await pool.query('SELECT count(*) AS c FROM model_service_type_assignments');
  console.log('Total assignments in this DB:', total.rows[0].c);

  const jh6 = await pool.query(`
    SELECT st.name AS service_type, cat.name AS category, count(*) AS parts
    FROM model_service_type_assignments a
    JOIN vehicle_models m ON m.id = a.model_id
    JOIN service_types cat ON cat.id = a.service_type_id
    LEFT JOIN service_types st ON st.id = a.service_category_id
    WHERE m.name = 'JH6 28.500FT A/T T/T C/C'
    GROUP BY st.name, cat.name ORDER BY cat.name`);
  console.log('JH6 rows in this DB:');
  console.table(jh6.rows);
} catch (e) {
  console.error('Diag error:', e.message);
} finally {
  await pool.end();
}
