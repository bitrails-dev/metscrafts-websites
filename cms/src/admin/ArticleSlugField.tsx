'use client'

import React, { useEffect, useRef, useState } from 'react'
import { TextField, useConfig, useDocumentInfo, useField, useFormFields, useLocale } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { generateArticleSlug, shouldAutoGenerateArticleSlug } from '../collections/articleSlug'

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

/**
 * Keeps a new article's slug synchronized with title + date. A saved slug is considered registered
 * and is never changed; typing in the slug field likewise opts out for the current new document.
 */
export default function ArticleSlugField(props: TextFieldClientProps) {
  const path = props.path || props.field.name
  const { config } = useConfig()
  const { id } = useDocumentInfo()
  const locale = useLocale()
  const localeCode = locale.code
  const { initialValue, setValue, value } = useField<string>({ path })
  const title = useFormFields(([fields]) => fields.title?.value)
  const date = useFormFields(([fields]) => fields.date?.value)
  const [englishTitle, setEnglishTitle] = useState<string | undefined>(undefined)
  const manualSlug = useRef(false)
  const lastGeneratedSlug = useRef<string | undefined>(undefined)
  const previousSlug = useRef(value)

  // A localized edit form only contains the title for the active locale. When it is not English,
  // fetch the stored English title so it remains the preferred slug source whenever it exists.
  useEffect(() => {
    if (!id || localeCode === 'en') {
      setEnglishTitle(undefined)
      return
    }

    const controller = new AbortController()
    const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`
    void fetch(
      `${apiBase}/articles/${encodeURIComponent(String(id))}?locale=en&fallback-locale=false&depth=0`,
      { credentials: 'include', signal: controller.signal },
    )
      .then(async (response) => (response.ok ? await response.json() as { title?: unknown } : undefined))
      .then((article) => {
        if (!controller.signal.aborted) setEnglishTitle(asString(article?.title))
      })
      .catch(() => {
        // If the lookup is unavailable, the active locale title remains a useful fallback.
      })

    return () => controller.abort()
  }, [config?.routes?.api, config?.serverURL, id, localeCode])

  // Any change not made by the generator is a deliberate manual edit. This includes clearing a
  // generated value, so subsequent title/date changes do not put it back unexpectedly.
  useEffect(() => {
    if (value === previousSlug.current) return
    if (value !== lastGeneratedSlug.current) manualSlug.current = true
    previousSlug.current = value
  }, [value])

  useEffect(() => {
    if (!shouldAutoGenerateArticleSlug({
      manuallyEdited: manualSlug.current,
      storedSlug: initialValue,
    })) return

    const preferredTitle = localeCode === 'en' ? title : englishTitle ?? title
    const generatedSlug = generateArticleSlug(preferredTitle, date)
    if (!generatedSlug || generatedSlug === value) return

    lastGeneratedSlug.current = generatedSlug
    setValue(generatedSlug)
  }, [date, englishTitle, initialValue, localeCode, setValue, title, value])

  return <TextField {...props} />
}
