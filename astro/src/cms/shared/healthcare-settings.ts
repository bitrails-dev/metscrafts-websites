// Shared view-model + normalizer for the tenant-scoped `healthcare-settings` collection. Both CMS
// backends (REST + in-process) fetch raw docs and route them through here, so public-site components
// see one stable shape: four named hero stats (localized {value, valueAr, unit, unitAr}) and an
// emergency number. Raw Payload documents are never exposed to components.
//
// At most one healthcare-settings document exists per tenant (UNIQUE(tenant_id) + singlePerTenant
// hook). normalizeDocs returns undefined for zero rows and throws for more than one — a uniqueness
// violation must be repaired, not silently deduped.

export interface LocalizedStat {
  value: string;
  valueAr: string;
  unit: string;
  unitAr: string;
}

export interface HealthcareSettings {
  emergencyNumber?: string;
  stats: {
    years: LocalizedStat;
    departments: LocalizedStat;
    patients: LocalizedStat;
    staff: LocalizedStat;
  };
}

// A localized field comes back as { en, ar } under locale=all; a plain string is treated as English
// (matches the loc() helper used elsewhere in the CMS layer).
function pair(f: any): [string, string] {
  if (f && typeof f === "object" && !Array.isArray(f)) return [String(f.en ?? ""), String(f.ar ?? "")];
  return [String(f ?? ""), ""];
}

function stat(group: any): LocalizedStat {
  const [value, valueAr] = pair(group?.value);
  const [unit, unitAr] = pair(group?.unit);
  return { value, valueAr, unit, unitAr };
}

// Map a single raw healthcare-settings document to the view model.
export function normalizeHealthcareSettings(doc: any): HealthcareSettings {
  const h = doc?.hero ?? {};
  return {
    emergencyNumber: doc?.emergencyNumber == null ? undefined : String(doc.emergencyNumber),
    stats: {
      years: stat(h.years),
      departments: stat(h.departments),
      patients: stat(h.patients),
      staff: stat(h.staff),
    },
  };
}

// Map the fetched docs (limit 1) to a single view model: undefined when none, throw when >1.
export function normalizeHealthcareSettingsDocs(
  docs: any[] | undefined | null,
): HealthcareSettings | undefined {
  if (!docs || docs.length === 0) return undefined;
  if (docs.length > 1) {
    throw new Error("healthcare-settings: expected at most one document per tenant");
  }
  return normalizeHealthcareSettings(docs[0]);
}
