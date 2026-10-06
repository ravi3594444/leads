import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { safeFailure } from '../server/failure.ts';
import { databaseClient } from '../scripts/database-client.mjs';

test('database authentication failures remain actionable through an ORM error wrapper', () => {
  const cause = Object.assign(new Error('private connection string'), { code: '28P01' });
  const failure = safeFailure(new Error('private SQL and parameter values', { cause }));
  assert.equal(failure.errorCode, '28P01');
  assert.match(failure.error, /current Supabase database password/);
  assert.ok(!JSON.stringify(failure).includes('private'));
});
test('aggregate network errors and circular causes do not leak arbitrary data', () => {
  const cause = Object.assign(new Error('private host'), { code: 'ENOTFOUND' });
  cause.cause = cause;
  const failure = safeFailure(new AggregateError([cause], 'private details'));
  assert.equal(failure.errorCode, 'ENOTFOUND');
  assert.ok(!JSON.stringify(failure).includes('private'));
  assert.equal(safeFailure({ code: 'secret-value', message: 'secret-value' }).errorCode, 'REQUEST_FAILED');
});
test('malformed connection strings never appear in configuration errors', () => {
  const previous = process.env.DATABASE_URL;
  try {
    for (const value of ['not-a-url-with-test-only-secret', 'https://test-only-secret@example.test']) {
      process.env.DATABASE_URL = value;
      assert.throws(databaseClient, error => error.code === 'DATABASE_URL_INVALID' && !error.message.includes('test-only-secret') && !('input' in error));
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('Supabase connections trust the published CA and still require certificate verification', async () => {
  const previousUrl = process.env.DATABASE_URL, previousCa = process.env.DATABASE_CA_CERT;
  delete process.env.DATABASE_CA_CERT;
  try {
    for (const host of ['aws-0-ap-south-1.pooler.supabase.com', 'db.testproject.supabase.co']) {
      process.env.DATABASE_URL = `postgresql://test:test@${host}:6543/postgres`;
      const client = databaseClient();
      try {
        assert.equal(client.options.ssl.rejectUnauthorized, true);
        const ca = new X509Certificate(client.options.ssl.ca);
        assert.equal(ca.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
        assert.equal(ca.ca, true);
        assert.equal(ca.verify(ca.publicKey), true);
        assert.ok(new Date(ca.validTo).getTime() > Date.now());
      } finally { await client.end(); }
    }
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousCa === undefined) delete process.env.DATABASE_CA_CERT; else process.env.DATABASE_CA_CERT = previousCa;
  }
});

test('Supabase CA trust is confined to Supabase hosts and custom CA overrides are preserved', async () => {
  const previousUrl = process.env.DATABASE_URL, previousCa = process.env.DATABASE_CA_CERT;
  delete process.env.DATABASE_CA_CERT;
  try {
    for (const host of ['database.example.com', 'aws-0.pooler.supabase.com.example.com', 'fake-supabase.co']) {
      process.env.DATABASE_URL = `postgresql://test:test@${host}:5432/postgres`;
      const client = databaseClient();
      try {
        assert.equal(client.options.ssl.rejectUnauthorized, true);
        assert.equal(client.options.ssl.ca, undefined);
      } finally { await client.end(); }
    }
    process.env.DATABASE_URL = 'postgresql://test:test@db.testproject.supabase.co:5432/postgres';
    process.env.DATABASE_CA_CERT = '  custom\\nCA  ';
    const custom = databaseClient();
    try {
      assert.equal(custom.options.ssl.rejectUnauthorized, true);
      assert.equal(custom.options.ssl.ca, 'custom\nCA');
    } finally { await custom.end(); }
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousCa === undefined) delete process.env.DATABASE_CA_CERT; else process.env.DATABASE_CA_CERT = previousCa;
  }
});
