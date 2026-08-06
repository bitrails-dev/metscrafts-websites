import type { CollectionBeforeChangeHook } from 'payload'

type LocalizedTitle = Record<string, unknown>

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** A stored slug or one user edit permanently opts the editor out of live generation. */
export const shouldAutoGenerateArticleSlug = ({
  manuallyEdited,
  storedSlug,
}: {
  manuallyEdited: boolean
  storedSlug: unknown
}): boolean => !manuallyEdited && !nonEmptyString(storedSlug)

/** Prefer the English translation, then the first available translated title. */
export const preferredArticleTitle = (title: unknown): string | undefined => {
  const directTitle = nonEmptyString(title)
  if (directTitle) return directTitle
  if (!title || typeof title !== 'object' || Array.isArray(title)) return undefined

  const localizedTitle = title as LocalizedTitle
  return nonEmptyString(localizedTitle.en)
    ?? Object.values(localizedTitle).map(nonEmptyString).find(Boolean)
}

const slugDate = (date: unknown): string | undefined => {
  if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  const stringDate = nonEmptyString(date)
  if (!stringDate) return undefined

  // Payload date fields are ISO strings. Keep the calendar date rather than converting it through
  // the browser timezone, which could otherwise shift the day in the generated slug.
  const isoDate = stringDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  return isoDate ?? stringDate
}

/** Builds a URL- and filename-safe `title-yyyy-mm-dd` slug while preserving non-English letters. */
export const generateArticleSlug = (title: unknown, date: unknown): string | undefined => {
  const preferredTitle = preferredArticleTitle(title)
  const formattedDate = slugDate(date)
  if (!preferredTitle || !formattedDate) return undefined

  const normalizedTitle = preferredTitle
    .normalize('NFKD')
    .toLocaleLowerCase()
    // Keep every script's letters/numbers (plus combining marks), while collapsing separators,
    // punctuation, and path characters into one hyphen. The slug is used as a Markdown filename
    // by the export script, so `/`, `\\`, and `.` must never survive this normalization.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  if (!normalizedTitle) return undefined

  return `${normalizedTitle}-${formattedDate}`
}

/**
 * API/import safety net. The admin field generates the value while editing; this only fills a
 * missing slug during creation, so neither a manually supplied slug nor any existing URL changes.
 */
export const generateArticleSlugOnCreate: CollectionBeforeChangeHook = ({ data, operation }) => {
  if (operation !== 'create' || nonEmptyString(data.slug)) return data

  const slug = generateArticleSlug(data.title, data.date)
  if (slug) data.slug = slug
  return data
}
