import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Migration C — collapse each hero stat's localized text `value` into a single non-localized NUMBER
// on the parent healthcare_settings row. The figure is the same in every locale; the public site
// formats it per language (Intl.NumberFormat — Arabic-Indic digits in ar, ASCII in en), so storing
// one number removes the per-locale editing burden. `unit` stays localized text (it genuinely
// translates, e.g. M+ / م+).
//
// up(): add 4 numeric columns to healthcare_settings; parse them from the ar-locale text value
// (Arabic-Indic digits → ASCII → REAL; ar is the default locale and always present, and its seeded
// values carry no thousands separator so they parse clean); then drop the now-redundant per-locale
// value text columns (the unit columns stay). ALTER TABLE DROP/ADD COLUMN is used (not a rebuild) so
// no DROP TABLE fires the document-lock FK.
// down(): restore the locale value text columns, write the number back as locale-appropriate digits
// (Arabic-Indic for ar, ASCII otherwise), drop the parent numeric columns. The ar round-trip is
// byte-identical for the seeded data (digit-for-digit mapping, no separators introduced).

const STATS = ['years', 'departments', 'patients', 'staff'] as const

// Wrap `expr` in nested REPLACE()s converting Arabic-Indic digits + decimal/thousands separators
// to ASCII so CAST(... AS REAL) parses the ar-locale text value.
const toAsciiNumber = (expr: string): string => {
  let s = expr
  for (const [from, to] of [
    ['٠', '0'], ['١', '1'], ['٢', '2'], ['٣', '3'], ['٤', '4'],
    ['٥', '5'], ['٦', '6'], ['٧', '7'], ['٨', '8'], ['٩', '9'],
    ['٫', '.'], ['٬', ''],
  ]) {
    s = `REPLACE(${s}, '${from}', '${to}')`
  }
  return s
}

// The reverse: ASCII digits + decimal → Arabic-Indic, for restoring the ar locale on down().
const toArabicDigits = (expr: string): string => {
  let s = expr
  for (const [from, to] of [
    ['0', '٠'], ['1', '١'], ['2', '٢'], ['3', '٣'], ['4', '٤'],
    ['5', '٥'], ['6', '٦'], ['7', '٧'], ['8', '٨'], ['9', '٩'],
    ['.', '٫'],
  ]) {
    s = `REPLACE(${s}, '${from}', '${to}')`
  }
  return s
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const s of STATS) {
    const col = `hero_${s}_value`
    // 1. Add the non-localized numeric column on the parent.
    await db.run(sql.raw(`ALTER TABLE \`healthcare_settings\` ADD COLUMN \`${col}\` numeric;`))
    // 2. Parse it from the ar-locale text value (Arabic-Indic → ASCII → REAL).
    const arText = `(SELECT hl.\`${col}\` FROM \`healthcare_settings_locales\` hl WHERE hl.\`_parent_id\` = \`healthcare_settings\`.\`id\` AND hl.\`_locale\` = 'ar')`
    await db.run(sql.raw(`UPDATE \`healthcare_settings\` SET \`${col}\` = CAST(${toAsciiNumber(arText)} AS REAL);`))
    // 3. Drop the now-redundant per-locale value column (the unit column stays).
    await db.run(sql.raw(`ALTER TABLE \`healthcare_settings_locales\` DROP COLUMN \`${col}\`;`))
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  for (const s of STATS) {
    const col = `hero_${s}_value`
    // 1. Restore the locale value column (text; NOT NULL needs a default for existing rows).
    await db.run(sql.raw(`ALTER TABLE \`healthcare_settings_locales\` ADD COLUMN \`${col}\` text NOT NULL DEFAULT '';`))
    // 2. Write the parent number back as locale-appropriate digits (Arabic-Indic for ar, ASCII else).
    const numText = `CAST((SELECT hs.\`${col}\` FROM \`healthcare_settings\` hs WHERE hs.\`id\` = \`healthcare_settings_locales\`.\`_parent_id\`) AS TEXT)`
    await db.run(sql.raw(
      `UPDATE \`healthcare_settings_locales\` SET \`${col}\` = CASE WHEN \`_locale\` = 'ar' THEN ${toArabicDigits(numText)} ELSE ${numText} END;`,
    ))
    // 3. Drop the parent numeric column.
    await db.run(sql.raw(`ALTER TABLE \`healthcare_settings\` DROP COLUMN \`${col}\`;`))
  }
}
