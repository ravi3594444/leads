export const TRADES = ["General contracting", "Roofing", "HVAC", "Electrical", "Plumbing", "Remodeling", "Pools", "Site work"] as const;
export type Trade = typeof TRADES[number];
export const COUNTIES = ["Alachua", "Baker", "Bay", "Bradford", "Brevard", "Broward", "Calhoun", "Charlotte", "Citrus", "Clay", "Collier", "Columbia", "DeSoto", "Dixie", "Duval", "Escambia", "Flagler", "Franklin", "Gadsden", "Gilchrist", "Glades", "Gulf", "Hamilton", "Hardee", "Hendry", "Hernando", "Highlands", "Hillsborough", "Holmes", "Indian River", "Jackson", "Jefferson", "Lafayette", "Lake", "Lee", "Leon", "Levy", "Liberty", "Madison", "Manatee", "Marion", "Martin", "Miami-Dade", "Monroe", "Nassau", "Okaloosa", "Okeechobee", "Orange", "Osceola", "Palm Beach", "Pasco", "Pinellas", "Polk", "Putnam", "Santa Rosa", "Sarasota", "Seminole", "St. Johns", "St. Lucie", "Sumter", "Suwannee", "Taylor", "Union", "Volusia", "Wakulla", "Walton", "Washington"] as const;
export type LeadStatus = "new" | "saved" | "contacted" | "won" | "dismissed";
export type PermitStatus = "Issued" | "In review" | "Closed" | "Unknown";
export type AgeFilter = "all" | "today" | "yesterday" | "two-days" | "week" | "older";
export interface Profile { company: string; trades: Trade[]; counties: string[]; commercialOnly: boolean; minimumValue: number; jevEnabled: boolean }
export const DEFAULT_PROFILE: Profile = { company: "", trades: [], counties: [], commercialOnly: true, minimumValue: 0, jevEnabled: false };
export interface LeadState { status: LeadStatus; notes: string; updatedAt?: number }
export interface Assessment { score: number; confidence: number | null; trade: string; model: string; assessedAt: string }
export interface Permit {
  id: string; permitNumber: string; title: string; businessName: string | null; address: string; city: string; county: string; trade: Trade;
  issuedAt: string | null; appliedAt: string | null; status: PermitStatus; rawStatus: string; propertyType: "Commercial" | "Residential" | "Unknown";
  value: number | null; description: string; sourceId: string; sourceName: string; sourceUrl: string;
  contactName: string | null; contactRole: "Applicant" | "Owner" | "Contractor" | "Unknown"; phone: string | null; email: string | null;
  firstSeenAt: string; updatedAt: string; priority: number; priorityReasons: string[]; assessment?: Assessment; demo: boolean;
}
export interface Source { id: string; name: string; county: string; url: string; format: string; status: "not-connected" | "healthy" | "stale" | "error"; lastSuccessAt: string | null; newestRecordAt: string | null; note: string }
export interface PermitStats { total: number; today: number; yesterday: number; twoDays: number; week: number; older: number; commercial: number; open: number; strongFit: number }
export interface PermitPage { permits: Permit[]; total: number; page: number; pageSize: number; stats: PermitStats | null; mode: "demo" | "live"; updatedAt: string }
export interface WorkspaceData { profile: Profile; leads: Record<string, LeadState>; jevConnected: boolean; backendConnected: boolean; displayName: string }
export interface Filters { q: string; county: string; trade: string; status: string; propertyType: string; age: AgeFilter; sort: string; onlyServiceArea: boolean; leadStatus: string; minimumValue: number; hideDismissed: boolean }
export const DEFAULT_FILTERS: Filters = { q: "", county: "all", trade: "all", status: "all", propertyType: "all", age: "all", sort: "newest", onlyServiceArea: false, leadStatus: "all", minimumValue: 0, hideDismissed: true };
