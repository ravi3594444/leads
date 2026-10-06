import postgres from 'postgres';
export function databaseClient() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('Add DATABASE_URL to .env.local before running database setup.');
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return postgres(value, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10,
    ssl: local ? false : { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replaceAll('\\n', '\n') } : {}) },
  });
}
