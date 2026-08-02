// Shared view-model + normalizer for the tenant-scoped `healthcare-settings` collection. Both CMS
// backends (REST + in-process) fetch raw docs and route them through here, so public-site components
// see one stable shape: four named hero stats (a non-localized numeric `value` + a localized `unit`)
// and an emergency number. Raw Payload documents are never exposed to components. The numeric value is
// formatted per language by the components (Intl.NumberFormat), so it is stored once, not per locale.
//
// At most one healthcare-settings document exists per tenant (UNIQUE(tenant_id) + singlePerTenant
// hook). normalizeDocs returns undefined for zero rows and throws for more than one — a uniqueness
// violation must be repaired, not silently deduped.

import { toLocalizedMap } from "../../i18n";

export interface LocalizedStat {
  value: number;
  unit: Record<string, string>;
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

// A localized field comes back as { en, ar, … } under locale=all&fallback-locale=none; a plain
// string is treated as a single-locale value. toLocalizedMap filters empties and returns the map.
function stat(group: any): LocalizedStat {
  const n = Number(group?.value);
  return {
    value: Number.isFinite(n) ? n : 0,
    unit: toLocalizedMap(group?.unit),
  };
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
