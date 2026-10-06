import { databaseClient } from './database-client.mjs';
const client = databaseClient();
try {
  const rows = await client`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'permitline_dashboard' AND table_type = 'BASE TABLE'`;
  if (rows[0].tables !== 5) throw new Error('Schema is incomplete.');
  await client`SELECT user_id FROM permitline_dashboard.workspace_accounts LIMIT 1`;
  console.log('Database connection and all five workspace tables are ready.');
} catch {
  console.error('Database check failed. Run pnpm db:migrate and verify connection permissions.');
  process.exitCode = 1;
} finally { await client.end(); }
