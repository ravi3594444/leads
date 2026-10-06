// Only known error codes and fixed messages may leave the server. Database
// errors can contain connection strings, SQL, parameters and private notes.
const messages: Record<string, string> = {
  DATABASE_URL_INVALID: "DATABASE_URL in Vercel must be a valid Postgres connection string. Copy it from Supabase Connect and redeploy.",
  ERR_INVALID_URL: "DATABASE_URL in Vercel must be a valid Postgres connection string. Copy it from Supabase Connect and redeploy.",
  SELF_SIGNED_CERT_IN_CHAIN: "The database SSL certificate could not be verified. Add the Supabase CA certificate as DATABASE_CA_CERT in Vercel and redeploy.",
  DEPTH_ZERO_SELF_SIGNED_CERT: "The database SSL certificate could not be verified. Add the Supabase CA certificate as DATABASE_CA_CERT in Vercel and redeploy.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The database SSL certificate could not be verified. Add the Supabase CA certificate as DATABASE_CA_CERT in Vercel and redeploy.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "The database SSL certificate could not be verified. Add the Supabase CA certificate as DATABASE_CA_CERT in Vercel and redeploy.",
  ERR_OSSL_PEM_NO_START_LINE: "DATABASE_CA_CERT is not a valid PEM certificate. Use the certificate downloaded from Supabase Database settings and redeploy.",
  ERR_TLS_CERT_ALTNAME_INVALID: "The database hostname does not match its SSL certificate. Check DATABASE_URL against Supabase Connect and redeploy.",
  CERT_HAS_EXPIRED: "The database SSL certificate has expired. Check the server certificate and configured CA before reconnecting.",
  ENOTFOUND: "The database hostname could not be resolved. Check DATABASE_URL against Supabase Connect and redeploy.",
  EAI_AGAIN: "The database hostname could not be resolved. Check DATABASE_URL against Supabase Connect and try again.",
  ECONNREFUSED: "The database refused the connection. Check the Supabase project, pooler hostname, port and network restrictions.",
  ENETUNREACH: "The database network could not be reached. For Vercel, use the transaction-pooler connection from Supabase Connect.",
  EHOSTUNREACH: "The database host could not be reached. Check the Supabase pooler hostname and network restrictions.",
  ETIMEDOUT: "The database connection timed out. Check the Supabase project and network restrictions, then try again.",
  CONNECT_TIMEOUT: "The database connection timed out. Check the Supabase project and network restrictions, then try again.",
  "28P01": "The database rejected the credentials. Update DATABASE_URL in Vercel with the current Supabase database password and redeploy.",
  "28000": "The database rejected this connection. Check the Supabase pooler username and credentials in DATABASE_URL.",
  "3D000": "The database name is invalid. Check DATABASE_URL against the connection string in Supabase Connect.",
  "3F000": "The dashboard database schema is missing. Run this project's db/schema.sql in Supabase SQL Editor.",
  "42P01": "A dashboard database table is missing. Run this project's db/schema.sql in Supabase SQL Editor.",
  "42703": "The database schema does not match this dashboard version. Check the deployed schema against this project's db/schema.sql.",
  "42501": "The database connection lacks dashboard permissions. Use the schema-owner connection configured in this project's README.",
};
export function safeFailure(error: unknown): { error: string; errorCode: string; codes: string[] } {
  const queue: unknown[] = [error], seen = new Set<unknown>(), codes: string[] = [];
  for (let i = 0; queue.length && i < 12; i++) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const current = value as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof current.code === "string" && Object.hasOwn(messages, current.code) && !codes.includes(current.code)) codes.push(current.code);
    if (current.cause) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors.slice(0, 4));
  }
  const errorCode = codes[0] || "REQUEST_FAILED";
  return { error: messages[errorCode] || "The workspace could not complete this request. Please try again.", errorCode, codes };
}
