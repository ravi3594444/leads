import postgres from 'postgres';
export function databaseClient() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error('Add DATABASE_URL to .env.local before running database setup.');
  let url;
  try {
    url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    throw Object.assign(new Error('DATABASE_URL must be a valid Postgres connection string.'), { code: 'DATABASE_URL_INVALID' });
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return postgres(value, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10,
    ssl: local ? false : { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replaceAll('\\n', '\n') } : {}) },
  });
}
