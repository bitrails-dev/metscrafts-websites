'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import { useRouter, useSearchParams } from 'next/navigation.js'
import { useTenantSelection } from '@payloadcms/plugin-multi-tenant/client'

// A super-admin has no tenant context until one is selected in the dashboard. English is the
// safe platform fallback; once a tenant is selected, its published languages become authoritative.
const PLATFORM_FALLBACK_LOCALE = 'en'

type TenantResponse = { languages?: unknown }

const validLocales = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((locale): locale is string => typeof locale === 'string')
    : []

const localeFromElement = (element: Element): string | null => {
  const value = element.getAttribute('data-locale')
  return value || null
}

const hideUnsupportedLocaleControls = (allowed: Set<string>): void => {
  document.querySelectorAll<HTMLElement>('[data-locale]').forEach((element) => {
    const locale = localeFromElement(element)
    if (!locale) return

    // Payload puts data-locale on both the locale-code span and, in some controls, the control
    // itself. Hide the interactive control rather than only its label.
    const control = element.closest<HTMLElement>('button,[role="button"]') ?? element
    control.hidden = !allowed.has(locale)
    control.dataset.tenantLocaleHidden = control.hidden ? 'true' : 'false'
  })
}

export default function TenantLocaleGuard({ children }: { children?: React.ReactNode }) {
  const { config } = useConfig()
  const { selectedTenantID } = useTenantSelection()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [allowedLocales, setAllowedLocales] = useState<string[]>([PLATFORM_FALLBACK_LOCALE])
  const requestID = useRef(0)

  useEffect(() => {
    const currentRequest = ++requestID.current
    if (selectedTenantID === undefined) {
      setAllowedLocales([PLATFORM_FALLBACK_LOCALE])
      return
    }

    const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`
    void fetch(`${apiBase}/tenants/${encodeURIComponent(String(selectedTenantID))}?depth=0`, {
      credentials: 'include',
    })
      .then(async (response) => (response.ok ? await response.json() as TenantResponse : null))
      .then((tenant) => {
        if (currentRequest !== requestID.current) return
        const languages = validLocales(tenant?.languages)
        setAllowedLocales(languages.length > 0 ? languages : [PLATFORM_FALLBACK_LOCALE])
      })
      .catch(() => {
        // Keep the safe English fallback if the tenant metadata request fails.
        if (currentRequest === requestID.current) setAllowedLocales([PLATFORM_FALLBACK_LOCALE])
      })
  }, [config?.routes?.api, config?.serverURL, selectedTenantID])

  useEffect(() => {
    const allowed = new Set(allowedLocales)
    const apply = () => hideUnsupportedLocaleControls(allowed)
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [allowedLocales])

  useEffect(() => {
    const current = searchParams.get('locale')
    if (!current || allowedLocales.includes(current) || allowedLocales.length === 0) return

    const params = new URLSearchParams(searchParams.toString())
    params.set('locale', allowedLocales[0])
    router.replace(`?${params.toString()}`)
  }, [allowedLocales, router, searchParams])

  return <>{children}</>
}
