import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateArticleSlug,
  generateArticleSlugOnCreate,
  preferredArticleTitle,
  shouldAutoGenerateArticleSlug,
} from '../src/collections/articleSlug'

test('prefers an English article title when it is available', () => {
  assert.equal(preferredArticleTitle({ ar: 'عنوان عربي', en: 'English Title' }), 'English Title')
  assert.equal(preferredArticleTitle({ ar: 'عنوان عربي', es: 'Título español' }), 'عنوان عربي')
})

test('generates a lowercase, hyphenated title-date slug', () => {
  assert.equal(
    generateArticleSlug('A Title With Spaces', '2026-08-05T00:00:00.000Z'),
    'a-title-with-spaces-2026-08-05',
  )
})

test('normalizes punctuation and path characters into a filename-safe slug', () => {
  assert.equal(
    generateArticleSlug('../A/B testing: safe?', '2026-08-05'),
    'a-b-testing-safe-2026-08-05',
  )
  assert.equal(generateArticleSlug('عنوان عربي', '2026-08-05'), 'عنوان-عربي-2026-08-05')
})

test('only allows live generation before a slug is stored or edited manually', () => {
  assert.equal(shouldAutoGenerateArticleSlug({ storedSlug: undefined, manuallyEdited: false }), true)
  assert.equal(shouldAutoGenerateArticleSlug({ storedSlug: 'stored-slug', manuallyEdited: false }), false)
  assert.equal(shouldAutoGenerateArticleSlug({ storedSlug: undefined, manuallyEdited: true }), false)
})

test('create hook fills only a missing slug and preserves a manually supplied one', () => {
  const generated: Record<string, unknown> = {
    title: { en: 'English Title', ar: 'عنوان' },
    date: '2026-08-05',
  }
  generateArticleSlugOnCreate({ data: generated, operation: 'create' } as never)
  assert.equal(generated.slug, 'english-title-2026-08-05')

  const manual: Record<string, unknown> = {
    title: 'Ignored title', date: '2026-08-05', slug: 'chosen-slug',
  }
  generateArticleSlugOnCreate({ data: manual, operation: 'create' } as never)
  assert.equal(manual.slug, 'chosen-slug')

  const registered: Record<string, unknown> = { title: 'Updated title', date: '2026-08-05' }
  generateArticleSlugOnCreate({
    data: registered,
    operation: 'update',
    originalDoc: { slug: 'registered-slug' },
  } as never)
  assert.equal('slug' in registered, false)
})
