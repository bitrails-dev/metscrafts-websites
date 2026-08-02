import ar from './ar.json'
import en from './en.json'
import es from './es.json'
import { LOCALES, type Locale } from '../catalogue'

// Keep imports explicit so Node-based tests, Astro SSR, and editor tooling all load JSON the same
// way. The parity gate verifies this directory contains exactly one bundle per catalogue locale.
const bundles = [ar, en, es]
if (bundles.length !== LOCALES.length) {
  throw new Error('Every platform locale must have one registered message bundle.')
}

export const messages = Object.fromEntries(
  LOCALES.map((locale, index) => [locale, bundles[index]]),
) as Record<Locale, typeof en>

export type Messages = typeof en
