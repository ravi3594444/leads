import { env } from "./env";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { assessments, leadStates, preferences } from "../db/schema";
import { demoPermits, SOURCES } from "../lib/demo-data";
import { DEFAULT_FILTERS, DEFAULT_PROFILE, TRADES, COUNTIES, type Assessment, type Filters, type LeadState, type Permit, type PermitPage, type Profile, type Source, type Trade } from "../lib/types";
import { comparePermits, matchesFilters, scorePermit, summarize } from "../lib/permit-utils";
import { sha256 } from "../lib/password";
import { ApiError } from "./http";

export const profileSchema = z.object({ company: z.string().max(120), trades: z.array(z.enum(TRADES)).max(8), counties: z.array(z.enum(COUNTIES)).max(67), commercialOnly: z.boolean(), minimumValue: z.number().min(0).max(1e10), jevEnabled: z.boolean() });
export async function profileFor(userId: string): Promise<Profile> {
  const [row] = await getDb().select().from(preferences).where(eq(preferences.userId, userId)).limit(1);
  if (!row) return DEFAULT_PROFILE;
  try { return profileSchema.parse(JSON.parse(row.payload)); } catch { return DEFAULT_PROFILE; }
}
export async function leadsFor(userId: string): Promise<Record<string, LeadState>> {
  const rows = await getDb().select().from(leadStates).where(eq(leadStates.userId, userId));
  return Object.fromEntries(rows.map(row => [row.permitId, { status: row.status as LeadState["status"], notes: row.notes, updatedAt: row.updatedAt }]));
}
export async function remote(path: string, params?: URLSearchParams): Promise<unknown> {
  const base = env.PERMIT_API_URL?.replace(/\/$/, "");
  if (!base || !base.startsWith("https://")) throw new ApiError(503, "The permit feed has not been connected.");
  const response = await fetch(`${base}${path}${params?.size ? `?${params}` : ""}`, { headers: { Accept: "application/json", ...(env.PERMIT_API_TOKEN ? { Authorization: `Bearer ${env.PERMIT_API_TOKEN}` } : {}) }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new ApiError(502, "The permit feed is temporarily unavailable. Please try again.");
  return response.json();
}
function safeUrl(value: unknown): string { try { const url = new URL(String(value)); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } }
function iso(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value); const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function normalizePermit(record: unknown): Permit {
  const r = record as Record<string, unknown>;
  if (!r || typeof r !== "object") throw new ApiError(502, "The feed returned an invalid permit record.");
  const id = String(r.id || r.permit_id || ""); if (!id) throw new ApiError(502, "The permit feed must provide a stable record ID.");
  const rawStatus = String(r.rawStatus || r.raw_status || r.status || "Unknown");
  const issuedAt = iso(r.issuedAt || r.issued_at || r.issue_date);
  const statusText = String(r.status || "").toLowerCase();
  const status = /closed|final|complete|expired|cancel/.test(statusText) ? "Closed" : /review|pending|application/.test(statusText) ? "In review" : /issued/.test(statusText) || (/open|active/.test(statusText) && issuedAt) ? "Issued" : "Unknown";
  const tradeText = String(r.trade || r.permit_type || ""); const trade = TRADES.find(t => t.toLowerCase() === tradeText.toLowerCase()) || "General contracting";
  const property = String(r.propertyType || r.property_type || "").toLowerCase();
  const valueRaw = r.value ?? r.project_value; const value = valueRaw === null || valueRaw === undefined || valueRaw === "" ? null : Number(valueRaw);
  const role = String(r.contactRole || r.contact_role || "Unknown");
  return { id, permitNumber: String(r.permitNumber || r.permit_number || id), title: String(r.title || r.description || "Permit project").slice(0, 200), businessName: r.businessName || r.business_name ? String(r.businessName || r.business_name) : null,
    address: String(r.address || "Address not provided"), city: String(r.city || ""), county: String(r.county || "").replace(/ County$/i, ""), trade: trade as Trade,
    issuedAt, appliedAt: iso(r.appliedAt || r.applied_at || r.application_date), status, rawStatus, propertyType: /commercial/.test(property) ? "Commercial" : /residential/.test(property) ? "Residential" : "Unknown", value: value !== null && Number.isFinite(value) ? value : null,
    description: String(r.description || r.scope_of_work || "The source has not provided a project description."), sourceId: String(r.sourceId || r.source_id || ""), sourceName: String(r.sourceName || r.source_name || "Permit source"), sourceUrl: safeUrl(r.sourceUrl || r.source_url),
    contactName: r.contactName || r.contact_name ? String(r.contactName || r.contact_name) : null, contactRole: ["Applicant", "Owner", "Contractor"].includes(role) ? role as Permit["contactRole"] : "Unknown", phone: r.phone ? String(r.phone) : null, email: r.email ? String(r.email) : null,
    firstSeenAt: iso(r.firstSeenAt || r.first_seen_at) || new Date().toISOString(), updatedAt: iso(r.updatedAt || r.updated_at) || new Date().toISOString(), priority: 0, priorityReasons: [], demo: !!r.demo };
}
export function assessmentInput(permit: Permit, profile: Profile): string { return JSON.stringify({ assessmentVersion: "aimlapi/typesafe/jev/v1", description: permit.description, trade: permit.trade, propertyType: permit.propertyType, value: permit.value, status: permit.status, issuedAt: permit.issuedAt, county: permit.county, profile }); }
export async function withAssessment(permit: Permit, profile: Profile, userId: string): Promise<Permit> {
  let result = scorePermit(permit, profile);
  if (!profile.jevEnabled) return result;
  const [cached] = await getDb().select().from(assessments).where(and(eq(assessments.userId, userId), eq(assessments.permitId, permit.id))).limit(1);
  if (cached && cached.inputHash === await sha256(assessmentInput(permit, profile))) {
    try { const assessment = JSON.parse(cached.payload) as Assessment; result = { ...result, priority: assessment.score, assessment }; } catch { /* Recompute on the next explicit Jev request. */ }
  }
  return result;
}
export function filtersFrom(params: URLSearchParams): Filters {
  const value = (key: keyof Filters) => params.get(key) || String(DEFAULT_FILTERS[key]);
  return { ...DEFAULT_FILTERS, q: (params.get("q") || "").slice(0, 200), county: value("county"), trade: value("trade"), status: value("status"), propertyType: value("propertyType"), age: value("age") as Filters["age"], sort: value("sort"), onlyServiceArea: params.get("onlyServiceArea") === "true", leadStatus: value("leadStatus"), minimumValue: Math.max(0, Number(params.get("minimumValue")) || 0), hideDismissed: params.get("hideDismissed") !== "false" };
}
export async function permitPage(userId: string, params: URLSearchParams): Promise<PermitPage> {
  const profile = await profileFor(userId), leads = await leadsFor(userId), filters = filtersFrom(params);
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1)), pageSize = Math.min(50, Math.max(1, Math.floor(Number(params.get("pageSize")) || 10))), savedOnly = params.get("view") === "saved";
  if (env.PERMIT_API_URL) {
    const query = new URLSearchParams(params); query.set("page", String(page)); query.set("limit", String(pageSize)); query.set("pageSize", String(pageSize)); query.set("profile", JSON.stringify(profile));
    const savedIds = Object.entries(leads).filter(([, lead]) => lead.status !== "new" && lead.status !== "dismissed" && (filters.leadStatus === "all" || lead.status === filters.leadStatus)).map(([id]) => id);
    if (savedOnly && !savedIds.length) return { permits: [], total: 0, page, pageSize, stats: null, mode: "live", updatedAt: new Date().toISOString() };
    if (savedOnly) query.set("ids", savedIds.join(","));
    query.set("dismissedIds", Object.entries(leads).filter(([, lead]) => lead.status === "dismissed").map(([id]) => id).join(","));
    const data = await remote("/api/permits", query) as Record<string, unknown>;
    const rows = data.permits || data.items || data.data;
    if (!Array.isArray(rows) || !Number.isFinite(Number(data.total))) throw new ApiError(502, "The permit API must return permits and a total record count.");
    const permits = await Promise.all(rows.slice(0, pageSize).map(async row => withAssessment(normalizePermit(row), profile, userId)));
    return { permits, total: Number(data.total), page, pageSize, stats: data.stats as PermitPage["stats"] || null, mode: "live", updatedAt: iso(data.updatedAt) || new Date().toISOString() };
  }
  const all = await Promise.all(demoPermits().map(permit => withAssessment(permit, profile, userId)));
  const filtered = all.filter(p => matchesFilters(p, filters, profile, leads, savedOnly)).sort((a, b) => comparePermits(a, b, filters.sort));
  return { permits: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, stats: summarize(all), mode: "demo", updatedAt: new Date().toISOString() };
}
export async function permitById(userId: string, id: string): Promise<Permit> {
  const profile = await profileFor(userId);
  if (env.PERMIT_API_URL) { const data = await remote(`/api/permits/${encodeURIComponent(id)}`) as Record<string, unknown>; return withAssessment(normalizePermit(data.permit || data), profile, userId); }
  const permit = demoPermits().find(p => p.id === id); if (!permit) throw new ApiError(404, "This permit could not be found.");
  return withAssessment(permit, profile, userId);
}
export async function sourcesFor(): Promise<{ sources: Source[]; mode: string }> {
  if (!env.PERMIT_API_URL) return { sources: SOURCES, mode: "demo" };
  const data = await remote("/api/sources") as Record<string, unknown>;
  if (!Array.isArray(data.sources)) throw new ApiError(502, "The source API must return a sources array.");
  return { sources: data.sources.map((raw) => { const s = raw as Source; return { ...s, url: safeUrl(s.url) }; }), mode: "live" };
}
