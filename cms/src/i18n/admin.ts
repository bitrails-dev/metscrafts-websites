// Payload's own dashboard chrome translations are code modules supplied by Payload. Keep this
// registry separate from product/storefront JSON messages: these modules localize Payload itself,
// while tenant content and storefront UI use localized fields and JSON bundles respectively.
import { ar } from '@payloadcms/translations/languages/ar'
import { en } from '@payloadcms/translations/languages/en'
import { es } from '@payloadcms/translations/languages/es'

export const ADMIN_TRANSLATIONS = { ar, en, es }
