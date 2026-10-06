import { readFileSync } from 'node:fs';
import { databaseClient } from './database-client.mjs';
const client = databaseClient();
try {
  await client.begin(async transaction => transaction.unsafe(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')).simple());
  console.log('Permitline workspace schema is ready. Collector tables were not modified.');
} catch {
  console.error('Workspace setup failed. Check database reachability, SSL configuration and schema-owner permissions.');
  process.exitCode = 1;
} finally { await client.end(); }
