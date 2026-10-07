import type { Filters, LeadState, Permit, PermitStats, Profile, Trade } from "./types.ts";
export function floridaDay(value: string | Date): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
export function ageInDays(date: string | null, now = new Date()): number | null {
  if (!date || Number.isNaN(Date.parse(date))) return null;
  return Math.floor((Date.parse(`${floridaDay(now)}T12:00:00Z`) - Date.parse(`${floridaDay(date)}T12:00:00Z`)) / 86400000);
}
export function ageLabel(date: string | null, now = new Date()): string {
  const age = ageInDays(date, now);
  return age === null ? "Date unavailable" : age < 0 ? "Upcoming" : age === 0 ? "Today" : age === 1 ? "Yesterday" : `${age} days ago`;
}
export function permitActivityDate(permit: Pick<Permit, "issuedAt" | "appliedAt">): string | null { return permit.issuedAt ?? permit.appliedAt; }
export function money(value: number | null, compact = false): string { return value === null ? "Not provided" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, ...(compact ? { notation: "compact" } : {}) }).format(value); }
export function permitDate(value: string | null): string { return !value || Number.isNaN(Date.parse(value)) ? "Not provided" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(value)); }
export function priorityLabel(score: number): string { return score >= 80 ? "Strong fit" : score >= 60 ? "Good fit" : "Review"; }
export function scorePermit(permit: Permit, profile: Profile, now = new Date()): Permit {
  const age = ageInDays(permitActivityDate(permit), now);
  let score = 30;
  const reasons: string[] = [];
  if (age !== null && age >= 0 && age < 7) { score += Math.max(0, 18 - age * 2); const action = permit.issuedAt ? "Issued" : "Applied"; reasons.push(`${action} ${age === 0 ? "today" : age === 1 ? "yesterday" : "this week"}`); }
  if (permit.status === "Issued") { score += 12; reasons.push("Permit is issued"); }
  if (permit.status === "In review") { score += 7; reasons.push("Application in review"); }
  if (permit.status === "Closed") score -= 35;
  if (permit.propertyType === "Commercial") { score += 8; reasons.push("Commercial project"); }
  const tradeMatch = profile.trades.length === 0 || profile.trades.includes("General contracting") || profile.trades.includes(permit.trade as Trade);
  if (profile.trades.length && tradeMatch) { score += 22; reasons.unshift("Matches your services"); }
  else if (profile.trades.length) score -= 25;
  const countyMatch = profile.counties.length === 0 || profile.counties.includes(permit.county);
  if (profile.counties.length && countyMatch) { score += 14; reasons.unshift("In your service area"); }
  else if (profile.counties.length) score -= 30;
  if (permit.phone || permit.email) { score += 7; reasons.push("Listed contact available"); }
  if (profile.minimumValue > 0 && permit.value !== null && permit.value < profile.minimumValue) score -= 20;
  if (profile.commercialOnly && permit.propertyType === "Residential") score -= 15;
  return { ...permit, priority: Math.max(0, Math.min(100, Math.round(score))), priorityReasons: reasons.slice(0, 3) };
}
export function matchesFilters(permit: Permit, filters: Filters, profile: Profile, leads: Record<string, LeadState>, savedOnly = false, now = new Date()): boolean {
  const state = leads[permit.id]?.status || "new";
  if (savedOnly && (state === "new" || state === "dismissed")) return false;
  if (!savedOnly && filters.hideDismissed && state === "dismissed") return false;
  if (filters.leadStatus !== "all" && state !== filters.leadStatus) return false;
  const haystack = [permit.title, permit.businessName, permit.address, permit.city, permit.county, permit.permitNumber, permit.description].join(" ").toLowerCase();
  if (filters.q && !haystack.includes(filters.q.trim().toLowerCase())) return false;
  if (filters.county !== "all" && permit.county !== filters.county) return false;
  if (filters.trade !== "all" && permit.trade !== filters.trade) return false;
  if (filters.propertyType !== "all" && permit.propertyType !== filters.propertyType) return false;
  if (filters.status === "open" && permit.status !== "Issued" && permit.status !== "In review") return false;
  if (filters.status !== "all" && filters.status !== "open" && permit.status !== filters.status) return false;
  if (filters.minimumValue && (permit.value === null || permit.value < filters.minimumValue)) return false;
  if (filters.onlyServiceArea && profile.counties.length && !profile.counties.includes(permit.county)) return false;
  if (filters.onlyServiceArea && profile.trades.length && !profile.trades.includes("General contracting") && !profile.trades.includes(permit.trade)) return false;
  const age = ageInDays(permitActivityDate(permit), now);
  if (filters.age === "today" && age !== 0) return false;
  if (filters.age === "yesterday" && age !== 1) return false;
  if (filters.age === "two-days" && age !== 2) return false;
  if (filters.age === "week" && (age === null || age < 0 || age >= 7)) return false;
  if (filters.age === "older" && (age === null || age < 7)) return false;
  return true;
}
export function comparePermits(a: Permit, b: Permit, sort: string): number {
  const aActivity = permitActivityDate(a), bActivity = permitActivityDate(b);
  const aDate = aActivity ? Date.parse(aActivity) : 0, bDate = bActivity ? Date.parse(bActivity) : 0;
  if (sort === "priority") return b.priority - a.priority || bDate - aDate || a.id.localeCompare(b.id);
  if (sort === "value") return (b.value ?? -1) - (a.value ?? -1) || bDate - aDate;
  if (sort === "oldest") return aDate - bDate || a.id.localeCompare(b.id);
  return bDate - aDate || a.id.localeCompare(b.id);
}
export function summarize(permits: Permit[], now = new Date()): PermitStats {
  const stats: PermitStats = { total: permits.length, today: 0, yesterday: 0, twoDays: 0, week: 0, older: 0, commercial: 0, open: 0, strongFit: 0 };
  for (const p of permits) {
    const age = ageInDays(permitActivityDate(p), now);
    if (age === 0) stats.today++; if (age === 1) stats.yesterday++; if (age === 2) stats.twoDays++;
    if (age !== null && age >= 0 && age < 7) stats.week++; if (age !== null && age >= 7) stats.older++;
    if (p.propertyType === "Commercial") stats.commercial++; if (p.status === "Issued" || p.status === "In review") stats.open++;
    if (p.priority >= 80) stats.strongFit++;
  }
  return stats;
}
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function makeCsv(permits: Permit[], leads: Record<string, LeadState>): string {
  const columns = ["Permit number", "Project", "Business", "County", "City", "Address", "Trade", "Issue date", "Application date", "Permit status", "Property type", "Project value USD", "Priority index", "Lead status", "Contact name", "Contact role", "Phone", "Email", "Source", "Notes"];
  const rows = permits.map(p => [p.permitNumber, p.title, p.businessName, p.county, p.city, p.address, p.trade, p.issuedAt, p.appliedAt, p.rawStatus, p.propertyType, p.value, p.priority, leads[p.id]?.status || "new", p.contactName, p.contactRole, p.phone, p.email, p.sourceUrl, leads[p.id]?.notes || ""]);
  return "\ufeff" + [columns, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
}
