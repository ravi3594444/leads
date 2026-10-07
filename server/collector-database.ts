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

const countyColumn = sql`COALESCE(NULLIF(p.county_name, ''), regexp_replace(p.county, ' County$', '', 'i'), '')`;

function countyFilter(values: string[]): SQL {
  // Use the indexed collector column for ordinary records, while preserving
  // the county fallback for sources that have not populated it.
  return sql`(${inList(sql`p.county_name`, values)} OR
    ((p.county_name IS NULL OR p.county_name = '') AND
      ${inList(sql`COALESCE(regexp_replace(p.county, ' County$', '', 'i'), '')`, values)}))`;
}

function normalizedFilter(column: SQL, values: string[], fallback: string): SQL {
  return values.includes(fallback) ? sql`(${inList(column, values)} OR ${column} IS NULL OR ${column} = '')` : inList(column, values);
}

function baseQuery(userId: string, profile: Profile, where: SQL = sql`true`): SQL {
  const tradeMatch = profile.trades.includes("General contracting") ? sql`true` : inList(sql`trade`, profile.trades);
  const countyMatch = inList(sql`county`, profile.counties);
  return sql`WITH normalized AS NOT MATERIALIZED (
    SELECT p.id, p.permit_number, p.description, p.address, p.city,
      ${countyColumn} AS county,
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
    WHERE ${where}
  ), scored AS NOT MATERIALIZED (
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
  const leadStatus = sql`COALESCE(l.status, 'new')`;
  if (savedOnly) clauses.push(sql`${leadStatus} IN ('saved', 'contacted', 'won')`);
  else if (filters.hideDismissed) clauses.push(sql`${leadStatus} <> 'dismissed'`);
  if (filters.leadStatus !== "all") clauses.push(sql`${leadStatus} = ${filters.leadStatus}`);
  if (filters.q.trim()) clauses.push(sql`position(lower(${filters.q.trim()}) in lower(concat_ws(' ', p.description, COALESCE(NULLIF(p.applicant_company, ''), p.business_names[1]), p.address, p.city, ${countyColumn}, p.permit_number))) > 0`);
  if (filters.county !== "all") clauses.push(countyFilter([filters.county]));
  if (filters.trade !== "all") clauses.push(normalizedFilter(sql`p.dashboard_trade`, [filters.trade], "General contracting"));
  if (filters.propertyType === "Commercial") clauses.push(sql`p.property_class = 'commercial'`);
  else if (filters.propertyType === "Residential") clauses.push(sql`p.property_class = 'residential'`);
  else if (filters.propertyType === "Unknown") clauses.push(sql`(p.property_class NOT IN ('commercial', 'residential') OR p.property_class IS NULL)`);
  else if (filters.propertyType !== "all") clauses.push(sql`false`);
  if (filters.status === "open") clauses.push(sql`p.dashboard_status IN ('Issued', 'In review')`);
  else if (filters.status !== "all") clauses.push(normalizedFilter(sql`p.dashboard_status`, [filters.status], "Unknown"));
  if (filters.minimumValue > 0) clauses.push(sql`p.project_value >= ${filters.minimumValue}`);
  if (filters.onlyServiceArea) {
    if (profile.counties.length) clauses.push(countyFilter(profile.counties));
    if (profile.trades.length && !profile.trades.includes("General contracting")) clauses.push(normalizedFilter(sql`p.dashboard_trade`, profile.trades, "General contracting"));
  }
  const today = sql`(now() AT TIME ZONE 'America/New_York')::date`;
  if (filters.age === "today") clauses.push(sql`p.issue_date = ${today}`);
  if (filters.age === "yesterday") clauses.push(sql`p.issue_date = ${today} - 1`);
  if (filters.age === "two-days") clauses.push(sql`p.issue_date = ${today} - 2`);
  if (filters.age === "week") clauses.push(sql`p.issue_date BETWEEN ${today} - 7 AND ${today}`);
  if (filters.age === "older") clauses.push(sql`p.issue_date < ${today} - 7`);
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
  const [row] = await rows(sql`${baseQuery(userId, profile, where)}, summary AS (
    ${baseQuery(userId, profile)}
    SELECT max(last_seen_at) AS updated_at, jsonb_build_object(
      'total', count(*), 'today', count(*) FILTER (WHERE age = 0),
      'yesterday', count(*) FILTER (WHERE age = 1), 'twoDays', count(*) FILTER (WHERE age = 2),
      'week', count(*) FILTER (WHERE age BETWEEN 0 AND 7), 'older', count(*) FILTER (WHERE age > 7),
      'commercial', count(*) FILTER (WHERE property_type = 'Commercial'),
      'open', count(*) FILTER (WHERE status IN ('Issued', 'In review')),
      'strongFit', count(*) FILTER (WHERE priority >= 80)
    ) AS stats FROM (
      -- Keep this projection narrow. An ordered index scan can skip the empty
      -- heap pages left by retention instead of scanning the entire old heap.
      SELECT age, property_type, status, priority, last_seen_at FROM scored ORDER BY id
    ) all_permits
  )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(records) FROM (
        SELECT * FROM scored ORDER BY ${orderQuery(filters.sort)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      ) records), '[]'::jsonb),
      'total', (SELECT count(*) FROM (SELECT id FROM normalized ORDER BY id) matching),
      'updatedAt', summary.updated_at, 'stats', summary.stats
    ) AS result FROM summary`);
  return row.result as { rows: Row[]; total: number; stats: PermitStats; updatedAt: string | null };
}

export async function collectorPermit(userId: string, id: string): Promise<Row | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  await requireCollector();
  const [row] = await rows(sql`${baseQuery(userId, { company: "", trades: [], counties: [], commercialOnly: false, minimumValue: 0, jevEnabled: false }, sql`p.id = ${id}::uuid`)} SELECT * FROM normalized LIMIT 1`);
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
