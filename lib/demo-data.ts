import type { Permit, Source, Trade } from "./types";
import { floridaDay } from "./permit-utils.ts";
export const SOURCES: Source[] = [
  { id: "miami-city", name: "City of Miami", county: "Miami-Dade", url: "https://www.miami.gov/Permits-Construction", format: "ArcGIS", status: "not-connected", lastSuccessAt: null, newestRecordAt: null, note: "City-issued permits; separate from county-issued records." },
  { id: "miami-dade", name: "Miami-Dade County", county: "Miami-Dade", url: "https://www.miamidade.gov/permits/", format: "ArcGIS", status: "not-connected", lastSuccessAt: null, newestRecordAt: null, note: "The researched public feed does not include current permit status." },
  { id: "orlando", name: "City of Orlando", county: "Orange", url: "https://data.cityoforlando.net/Permitting/Building-Permits/ryhf-m453", format: "Open data", status: "not-connected", lastSuccessAt: null, newestRecordAt: null, note: "City-issued records; other Orange County municipalities have their own sources." },
  { id: "alachua", name: "Alachua County", county: "Alachua", url: "https://growth-management.alachuacounty.us/Building/NewPermitTool", format: "ArcGIS", status: "not-connected", lastSuccessAt: null, newestRecordAt: null, note: "Permit status is available; listed contact details vary." },
  { id: "lake", name: "Lake County", county: "Lake", url: "https://c.lakecountyfl.gov/offices/building_services/permit_activity_reports/permits_issued.aspx", format: "Activity report", status: "not-connected", lastSuccessAt: null, newestRecordAt: null, note: "County service area and Montverde; other cities require separate sources." },
  { id: "charlotte", name: "Charlotte County", county: "Charlotte", url: "https://www.charlottecountyfl.gov/departments/community-development/", format: "ArcGIS", status: "not-connected", lastSuccessAt: null, newestRecordAt: null, note: "The researched GIS layer includes other record types; the collector must filter for permits." },
];
const seeds: [string, string, string, string, Trade, number, number | null, string][] = [
  ["Solana Coffee", "Cafe interior build-out", "Miami", "miami-city", "Remodeling", 0, 185000, "Interior build-out for a new cafe, including the service counter, finishes and restroom improvements."],
  ["Bayview Market", "Commercial roof replacement", "Miami", "miami-dade", "Roofing", 0, 94000, "Replace the flat roofing system on an existing commercial neighborhood market."],
  ["Juniper Studio", "New HVAC installation", "Orlando", "orlando", "HVAC", 0, 32000, "Install two rooftop HVAC units and associated ductwork for a retail studio."],
  ["Harbor Dental", "Office electrical upgrade", "Miami", "miami-city", "Electrical", 0, 48000, "Electrical service upgrade and new circuits for an expanded dental office."],
  ["Magnolia House", "Residential kitchen renovation", "Tavares", "lake", "Remodeling", 0, 65000, "Kitchen renovation with new cabinetry and interior finishes."],
  ["Cedar & Coast", "Retail tenant improvement", "Orlando", "orlando", "General contracting", 1, 265000, "Tenant improvements for a retail location, including partitions, finishes and storefront work."],
  ["Lakefront Kitchen", "Restaurant plumbing fit-out", "Clermont", "lake", "Plumbing", 1, 54000, "New plumbing fixtures, grease interceptor connections and kitchen water lines."],
  ["Northside Fitness", "Gym interior remodel", "Gainesville", "alachua", "Remodeling", 1, 172000, "Commercial gym remodel with updated changing rooms and open training areas."],
  ["Biscayne Offices", "Office roof repair", "Miami", "miami-dade", "Roofing", 1, 72000, "Repair and replace damaged sections of the existing office roof."],
  ["Palm Grove Suites", "Air conditioning replacement", "Punta Gorda", "charlotte", "HVAC", 1, 29000, "Replace air conditioning equipment at a small hospitality property."],
  ["Oak Street Pharmacy", "Commercial electrical work", "Gainesville", "alachua", "Electrical", 2, 37000, "New lighting, electrical panels and outlets for a pharmacy tenant space."],
  ["Westshore Commons", "Site preparation", "Port Charlotte", "charlotte", "Site work", 2, 420000, "Site grading and drainage improvements for a proposed commercial building."],
  ["Orange Blossom Cafe", "Restaurant renovation", "Orlando", "orlando", "General contracting", 2, 310000, "Interior renovation of a restaurant, including the kitchen layout and customer seating."],
  ["Marina Wellness", "Medical office plumbing", "Miami", "miami-city", "Plumbing", 2, 41000, "Plumbing alterations for treatment rooms and an accessible restroom."],
  ["Willow Residence", "Backyard pool", "Leesburg", "lake", "Pools", 2, 88000, "New in-ground residential swimming pool and equipment pad."],
  ["Lakeside Retail", "Storefront expansion", "Tavares", "lake", "General contracting", 3, 395000, "Expand the existing storefront with a new entrance and retail floor area."],
  ["Grove Workspaces", "Commercial HVAC upgrade", "Miami", "miami-dade", "HVAC", 3, 86000, "Upgrade air conditioning and ventilation for a shared office building."],
  ["Elm Street Books", "Retail interior renovation", "Gainesville", "alachua", "Remodeling", 3, 58000, "Interior renovation of a bookstore with new shelving and accessible circulation."],
  ["Seagrass Lodge", "Hospitality roof replacement", "Punta Gorda", "charlotte", "Roofing", 4, 138000, "Replace the roofing system on an existing lodge building."],
  ["Vista Learning", "School electrical upgrade", "Orlando", "orlando", "Electrical", 4, 79000, "Electrical distribution and classroom lighting upgrades."],
  ["Brickell Studio", "Showroom build-out", "Miami", "miami-city", "General contracting", 4, 225000, "Commercial showroom build-out with display areas and interior partitions."],
  ["Maple Residence", "Residential HVAC replacement", "Gainesville", "alachua", "HVAC", 5, 14000, "Replace a residential heat pump and associated air handler."],
  ["Lakeview Grocers", "Roofing improvements", "Clermont", "lake", "Roofing", 5, 112000, "Roofing improvements and waterproofing for a grocery store."],
  ["Coastal Pharmacy", "Commercial plumbing upgrade", "Port Charlotte", "charlotte", "Plumbing", 5, null, "Plumbing upgrades and fixture replacements for a commercial pharmacy."],
  ["Studio Twenty", "Office renovation", "Orlando", "orlando", "Remodeling", 6, 145000, "Renovate an office floor with meeting rooms and accessible restrooms."],
  ["Silver Palm Cafe", "Commercial service upgrade", "Miami", "miami-dade", "Electrical", 6, 56000, "Electrical service upgrade for a commercial cafe space."],
  ["Pine Grove Offices", "New commercial roof", "Gainesville", "alachua", "Roofing", 7, 168000, "Roofing installation as part of a commercial office project."],
  ["Lake Street Dental", "Medical office HVAC", "Leesburg", "lake", "HVAC", 7, 44000, "Mechanical installation and ventilation for a new dental office."],
  ["Parkside Retail", "Commercial addition", "Orlando", "orlando", "General contracting", 8, 680000, "Commercial building addition with expanded retail and storage areas."],
  ["Harbor Club", "Pool refurbishment", "Punta Gorda", "charlotte", "Pools", 8, 124000, "Refurbish a commercial pool, including surfaces and mechanical equipment."],
  ["Banyan Offices", "Office plumbing improvements", "Miami", "miami-city", "Plumbing", 9, 69000, "Plumbing improvements for an office renovation."],
  ["Cypress Residence", "Residential roof replacement", "Clermont", "lake", "Roofing", 10, 28000, "Replace the roof on a detached single-family residence."],
  ["North Point Shops", "Retail site improvements", "Gainesville", "alachua", "Site work", 11, 285000, "Site access, drainage and parking improvements for retail units."],
  ["Sunset Workshops", "Commercial interior work", "Miami", "miami-dade", "Remodeling", 12, 97000, "Commercial interior alterations for a workshop and studio space."],
  ["Fern Street Clinic", "Clinic electrical work", "Orlando", "orlando", "Electrical", 14, 61000, "Electrical modifications for a healthcare tenant improvement."],
  ["Lemon Bay Lodge", "Hospitality HVAC", "Port Charlotte", "charlotte", "HVAC", 18, 73000, "Mechanical equipment upgrades at a hospitality building."],
];
export function demoPermits(now = new Date()): Permit[] {
  return seeds.map(([business, title, city, sourceId, trade, age, value, description], index) => {
    const source = SOURCES.find(item => item.id === sourceId)!;
    const issue = new Date(`${floridaDay(now)}T14:30:00Z`); issue.setUTCDate(issue.getUTCDate() - age); issue.setUTCMinutes(30 - (index % 20));
    const applied = new Date(issue); applied.setUTCDate(applied.getUTCDate() - 12);
    const status = sourceId === "miami-dade" ? "Unknown" : index === 31 || index === 35 ? "Closed" : index === 11 ? "In review" : "Issued";
    const propertyType = [4, 14, 21, 31].includes(index) ? "Residential" : "Commercial";
    const contact = index % 4 !== 3;
    return { id: `demo-${String(index + 1).padStart(3, "0")}`, permitNumber: `DEMO-${String(index + 1).padStart(4, "0")}`, title, businessName: business,
      address: `${110 + index * 23} ${["Oak Avenue", "Bay Street", "Palm Drive", "Main Street", "Lake Road"][index % 5]}`, city, county: source.county, trade,
      issuedAt: issue.toISOString(), appliedAt: applied.toISOString(), status, rawStatus: status === "Unknown" ? "Not provided by source" : status,
      propertyType, value, description, sourceId, sourceName: source.name, sourceUrl: source.url,
      contactName: contact ? `${business} permit applicant` : null, contactRole: contact ? "Applicant" : "Unknown", phone: contact ? `(305) 555-${String(100 + index).padStart(4, "0")}` : null, email: null,
      firstSeenAt: issue.toISOString(), updatedAt: issue.toISOString(), priority: 0, priorityReasons: [], demo: true };
  });
}
