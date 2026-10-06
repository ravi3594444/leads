import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import type { Filters, PermitStats, Profile, Source } from "../lib/types";
import { ApiError } from "./http";

type Row = Record<string, unknown>;

// Both the production postgres-js driver and the disposable PGlite tests run
// this same parameterized SQL. No collector records are modified here.
async function rows<T extends Row>(query: SQL): Promise<T[]> {
  const result: unknown = await getDb().execute(query);
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

export async function collectorConnected(): Promise<boolean> {
  const [row] = await rows(sql`SELECT to_regclass('public.permits') IS NOT NULL
    AND to_regclass('public.permit_sources') IS NOT NULL AS connected`);
  return row.connected === true;
}

async function requireCollector() {
  if (!await collectorConnected()) throw new ApiError(503, "The collector tables are not available in this database yet. Use the same Supabase project as your collector. No sample permits are shown.");
}

function inList(column: SQL, values: string[]): SQL {
  return values.length ? sql`${column} IN (${sql.join(values.map(value => sql`${value}`), sql`, `)})` : sql`true`;
}

function baseQuery(userId: string, profile: Profile): SQL {
  const tradeMatch = profile.trades.includes("General contracting") ? sql`true` : inList(sql`trade`, profile.trades);
  const countyMatch = inList(sql`county`, profile.counties);
  return sql`WITH normalized AS (
    SELECT p.id::text AS id, p.permit_number, p.description, p.address, p.city,
      COALESCE(NULLIF(p.county_name, ''), regexp_replace(p.county, ' County$', '', 'i'), '') AS county,
      COALESCE(NULLIF(p.dashboard_trade, ''), 'General contracting') AS trade,
      COALESCE(NULLIF(p.dashboard_status, ''), 'Unknown') AS status,
      CASE p.property_class WHEN 'commercial' THEN 'Commercial' WHEN 'residential' THEN 'Residential' ELSE 'Unknown' END AS property_type,
      p.issue_date, p.application_date, p.project_value, p.status_raw,
      p.source_id, s.name AS source_name, p.source_url, p.record_url,
      p.applicant_name, p.applicant_company, p.applicant_phone, p.owner_name,
      p.contractor_name, p.contractor_phone, p.business_names, p.contacts,
      p.first_seen_at, p.last_seen_at, p.last_changed_at, p.source_updated_at,
      COALESCE(NULLIF(p.applicant_company, ''), p.business_names[1]) AS business_name,
      (now() AT TIME ZONE 'America/New_York')::date - p.issue_date AS age,
      p.has_listed_contact, COALESCE(l.status, 'new') AS lead_status
    FROM public.permits p
    LEFT JOIN public.permit_sources s ON s.id = p.source_id
    LEFT JOIN permitline_dashboard.lead_states l ON l.permit_id = p.id::text AND l.user_id = ${userId}
  ), scored AS (
    SELECT *, GREATEST(0, LEAST(100,
      30 + CASE WHEN age BETWEEN 0 AND 7 THEN GREATEST(0, 18 - age * 2) ELSE 0 END
      + CASE status WHEN 'Issued' THEN 12 WHEN 'In review' THEN 7 WHEN 'Closed' THEN -35 ELSE 0 END
      + CASE WHEN property_type = 'Commercial' THEN 8 ELSE 0 END
      + CASE WHEN ${profile.trades.length > 0} THEN CASE WHEN ${tradeMatch} THEN 22 ELSE -25 END ELSE 0 END
      + CASE WHEN ${profile.counties.length > 0} THEN CASE WHEN ${countyMatch} THEN 14 ELSE -30 END ELSE 0 END
      + CASE WHEN has_listed_contact THEN 7 ELSE 0 END
      - CASE WHEN ${profile.minimumValue > 0} AND project_value < ${profile.minimumValue} THEN 20 ELSE 0 END
      - CASE WHEN ${profile.commercialOnly} AND property_type = 'Residential' THEN 15 ELSE 0 END
    )) AS priority
    FROM normalized
  )`;
}

function filterQuery(filters: Filters, profile: Profile, savedOnly: boolean): SQL {
  const clauses: SQL[] = [];
  if (savedOnly) clauses.push(sql`lead_status IN ('saved', 'contacted', 'won')`);
  else if (filters.hideDismissed) clauses.push(sql`lead_status <> 'dismissed'`);
  if (filters.leadStatus !== "all") clauses.push(sql`lead_status = ${filters.leadStatus}`);
  if (filters.q.trim()) clauses.push(sql`position(lower(${filters.q.trim()}) in lower(concat_ws(' ', description, business_name, address, city, county, permit_number))) > 0`);
  if (filters.county !== "all") clauses.push(sql`county = ${filters.county}`);
  if (filters.trade !== "all") clauses.push(sql`trade = ${filters.trade}`);
  if (filters.propertyType !== "all") clauses.push(sql`property_type = ${filters.propertyType}`);
  if (filters.status === "open") clauses.push(sql`status IN ('Issued', 'In review')`);
  else if (filters.status !== "all") clauses.push(sql`status = ${filters.status}`);
  if (filters.minimumValue > 0) clauses.push(sql`project_value >= ${filters.minimumValue}`);
  if (filters.onlyServiceArea) {
    if (profile.counties.length) clauses.push(inList(sql`county`, profile.counties));
    if (profile.trades.length && !profile.trades.includes("General contracting")) clauses.push(inList(sql`trade`, profile.trades));
  }
  if (filters.age === "today") clauses.push(sql`age = 0`);
  if (filters.age === "yesterday") clauses.push(sql`age = 1`);
  if (filters.age === "two-days") clauses.push(sql`age = 2`);
  if (filters.age === "week") clauses.push(sql`age BETWEEN 0 AND 7`);
  if (filters.age === "older") clauses.push(sql`age > 7`);
  return clauses.length ? sql.join(clauses, sql` AND `) : sql`true`;
}

function orderQuery(sort: string): SQL {
  if (sort === "priority") return sql`priority DESC, issue_date DESC NULLS LAST, id`;
  if (sort === "value") return sql`project_value DESC NULLS LAST, issue_date DESC NULLS LAST, id`;
  if (sort === "oldest") return sql`issue_date ASC NULLS LAST, id`;
  return sql`issue_date DESC NULLS LAST, id`;
}

export async function collectorPage(userId: string, profile: Profile, filters: Filters, savedOnly: boolean, page: number, pageSize: number): Promise<{ rows: Row[]; total: number; stats: PermitStats; updatedAt: string | null }> {
  await requireCollector();
  const where = filterQuery(filters, profile, savedOnly);
  const [row] = await rows(sql`${baseQuery(userId, profile)}
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(records) FROM (
        SELECT * FROM scored WHERE ${where} ORDER BY ${orderQuery(filters.sort)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      ) records), '[]'::jsonb),
      'total', (SELECT count(*) FROM scored WHERE ${where}),
      'updatedAt', (SELECT max(last_seen_at) FROM scored),
      'stats', (SELECT jsonb_build_object(
        'total', count(*), 'today', count(*) FILTER (WHERE age = 0),
        'yesterday', count(*) FILTER (WHERE age = 1), 'twoDays', count(*) FILTER (WHERE age = 2),
        'week', count(*) FILTER (WHERE age BETWEEN 0 AND 7), 'older', count(*) FILTER (WHERE age > 7),
        'commercial', count(*) FILTER (WHERE property_type = 'Commercial'),
        'open', count(*) FILTER (WHERE status IN ('Issued', 'In review')),
        'strongFit', count(*) FILTER (WHERE priority >= 80)
      ) FROM scored)
    ) AS result`);
  return row.result as { rows: Row[]; total: number; stats: PermitStats; updatedAt: string | null };
}

export async function collectorPermit(userId: string, id: string): Promise<Row | null> {
  await requireCollector();
  const [row] = await rows(sql`${baseQuery(userId, { company: "", trades: [], counties: [], commercialOnly: false, minimumValue: 0, jevEnabled: false })} SELECT * FROM normalized WHERE id = ${id} LIMIT 1`);
  return row || null;
}

function url(value: unknown): string {
  try { const parsed = new URL(String(value)); return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : ""; } catch { return ""; }
}

export async function collectorSources(): Promise<Source[]> {
  await requireCollector();
  const records = await rows(sql`SELECT s.id, s.name, s.county, s.endpoint, s.connector_type, s.connector_status,
      s.enabled, s.notes, s.publication_cadence, s.poll_interval_minutes,
      h.last_success_at, h.last_error_at, h.newest_record_at
    FROM public.permit_sources s LEFT JOIN (
      SELECT source_id, max(last_success_at) AS last_success_at,
        max(last_error_at) AS last_error_at, max(newest_record_at) AS newest_record_at
      FROM public.source_checkpoints GROUP BY source_id
    ) h ON h.source_id = s.id ORDER BY s.county, s.name`);
  return records.map(row => {
    const lastSuccessAt = row.last_success_at ? new Date(String(row.last_success_at)).toISOString() : null;
    const failed = row.connector_status === "blocked" || (!!row.last_error_at && (!lastSuccessAt || Date.parse(String(row.last_error_at)) > Date.parse(lastSuccessAt)));
    const stale = lastSuccessAt && Date.now() - Date.parse(lastSuccessAt) > Math.max(60, Number(row.poll_interval_minutes || 20) * 3) * 60000;
    return { id: String(row.id), name: String(row.name), county: String(row.county || ""), url: url(row.endpoint), format: String(row.connector_type),
      status: failed ? "error" : !row.enabled || !lastSuccessAt ? "not-connected" : stale ? "stale" : "healthy",
      lastSuccessAt, newestRecordAt: row.newest_record_at ? new Date(String(row.newest_record_at)).toISOString() : null,
      note: [row.notes, row.publication_cadence].filter(Boolean).join(" ") };
  });
}
