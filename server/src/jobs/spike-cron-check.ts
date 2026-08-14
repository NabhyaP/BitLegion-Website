// Phase 0 spike (4): prove Hostinger Cron can run a Node script that reaches MySQL.
// Run: node dist/jobs/spike-cron-check.js
import { pool } from '../db/pool.ts';

const started = Date.now();
try {
  await pool.query(
    'INSERT INTO job_runs (job_code, status, finished_at, duration_ms, detail) VALUES (?,?,NOW(),?,?)',
    ['spike-cron-check', 'OK', Date.now() - started, JSON.stringify({ node: process.version })],
  );
  console.log('spike-cron-check OK');
} catch (err) {
  console.error('spike-cron-check FAILED', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
