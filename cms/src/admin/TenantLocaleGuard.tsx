'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import { useRouter, useSearchParams } from 'next/navigation.js'
import { useTenantSelection } from '@payloadcms/plugin-multi-tenant/client'
import { DEFAULT_PLATFORM_LOCALE } from '../i18n/catalogue'

type TenantResponse = { languages?: unknown; defaultLanguage?: unknown }

const validLocales = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((locale): locale is string => typeof locale === 'string'))]
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
  const [allowedLocales, setAllowedLocales] = useState<string[]>([DEFAULT_PLATFORM_LOCALE])
  const [tenantDefaultLocale, setTenantDefaultLocale] = useState<string>()
  const [tenantLocaleMetadataReady, setTenantLocaleMetadataReady] = useState(
    selectedTenantID === undefined,
  )
  const requestID = useRef(0)

  useEffect(() => {
    const currentRequest = ++requestID.current
    if (selectedTenantID === undefined) {
      setTenantLocaleMetadataReady(true)
      setAllowedLocales([DEFAULT_PLATFORM_LOCALE])
      setTenantDefaultLocale(undefined)
      return
    }

    // Do not carry the previous tenant's locale set/default while the new tenant is loading.
    setTenantLocaleMetadataReady(false)
    setAllowedLocales([DEFAULT_PLATFORM_LOCALE])
    setTenantDefaultLocale(undefined)
    const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`
    void fetch(`${apiBase}/tenants/${encodeURIComponent(String(selectedTenantID))}?depth=0`, {
      credentials: 'include',
    })
      .then(async (response) => (response.ok ? await response.json() as TenantResponse : null))
      .then((tenant) => {
        if (currentRequest !== requestID.current) return
        const languages = validLocales(tenant?.languages)
        const allowed = languages.length > 0 ? languages : [DEFAULT_PLATFORM_LOCALE]
        const requestedDefault = typeof tenant?.defaultLanguage === 'string'
          ? tenant.defaultLanguage
          : undefined
        setTenantLocaleMetadataReady(true)
        setAllowedLocales(allowed)
        setTenantDefaultLocale(
          requestedDefault && allowed.includes(requestedDefault) ? requestedDefault : allowed[0],
        )
      })
      .catch(() => {
        // Keep the platform default if the tenant metadata request fails.
        if (currentRequest === requestID.current) {
          setTenantLocaleMetadataReady(true)
          setAllowedLocales([DEFAULT_PLATFORM_LOCALE])
          setTenantDefaultLocale(undefined)
        }
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
    if (allowedLocales.length === 0) return
    if (selectedTenantID !== undefined && !tenantLocaleMetadataReady) return

    const preferred = tenantDefaultLocale && allowedLocales.includes(tenantDefaultLocale)
      ? tenantDefaultLocale
      : allowedLocales[0]
    if (!preferred) return

    // A tenant's configured default is the initial content locale. Once an admin explicitly
    // chooses a locale, preserve that choice as long as it remains enabled for the tenant.
    if (!current) {
      if (!tenantDefaultLocale || selectedTenantID === undefined) return
      const params = new URLSearchParams(searchParams.toString())
      params.set('locale', preferred)
      router.replace(`?${params.toString()}`)
      return
    }
    if (allowedLocales.includes(current)) return

    const params = new URLSearchParams(searchParams.toString())
    params.set('locale', preferred)
    router.replace(`?${params.toString()}`)
  }, [
    allowedLocales,
    router,
    searchParams,
    selectedTenantID,
    tenantDefaultLocale,
    tenantLocaleMetadataReady,
  ])

  return <>{children}</>
}
