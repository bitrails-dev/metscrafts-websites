'use client'

// The Social connections navigation item is a settings surface, not a CRUD list. It consolidates
// the tenant's public social links, social-publishing controls, and the OAuth connection panel in
// one place while the internal `social-connections` collection continues to store one row per
// connected provider account.
import React, { useEffect, useState } from 'react'
import { Banner, Button, CheckboxInput, Gutter, SelectInput, TextInput, useConfig } from '@payloadcms/ui'
import { useTenantSelection } from '@payloadcms/plugin-multi-tenant/client'
import { PLATFORMS } from '../social/platforms'
import SocialConnectionsPanel from './SocialConnectionsPanel'

// The page combines Payload inputs that normally control their own margins. Keep the composition
// explicit here so fields, sections, and the action area all use the same rhythm.
const pageStack = { display: 'grid', gap: 'calc(var(--base) * 3)' } as const
const sectionStack = { display: 'grid', gap: 'calc(var(--base) * 1.5)', margin: 0 } as const
const compactStack = { display: 'grid', gap: 'calc(var(--base) * 0.75)' } as const
const fieldStack = { display: 'grid', gap: 'calc(var(--base) * 1.5)' } as const

type SocialLinks = Record<string, string | undefined>
type TenantSocialData = {
  contact?: Record<string, unknown> & { social?: SocialLinks }
  socialPublishing?: {
    enabled?: boolean
    defaultAutoPublish?: boolean
    includedPlatforms?: string[]
  }
}

export default function SocialConnectionsSettingsView() {
  const { selectedTenantID } = useTenantSelection()
  const { config } = useConfig()
  const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`
  const [tenant, setTenant] = useState<TenantSocialData | null>(null)
  const [links, setLinks] = useState<SocialLinks>({})
  const [publishing, setPublishing] = useState<Required<NonNullable<TenantSocialData['socialPublishing']>>>({
    enabled: false,
    defaultAutoPublish: false,
    includedPlatforms: [],
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const tenantID = selectedTenantID === undefined ? null : String(selectedTenantID)

  useEffect(() => {
    if (!tenantID) {
      setTenant(null)
      return
    }

    let active = true
    setLoading(true)
    setError(null)
    setNotice(null)
    void fetch(`${apiBase}/tenants/${tenantID}?depth=0`, { credentials: 'include' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.errors?.[0]?.message ?? body?.message ?? `HTTP ${res.status}`)
        return body as TenantSocialData
      })
      .then((data) => {
        if (!active) return
        setTenant(data)
        setLinks(data.contact?.social ?? {})
        setPublishing({
          enabled: Boolean(data.socialPublishing?.enabled),
          defaultAutoPublish: Boolean(data.socialPublishing?.defaultAutoPublish),
          includedPlatforms: data.socialPublishing?.includedPlatforms ?? [],
        })
      })
      .catch((cause: unknown) => active && setError(String((cause as Error)?.message ?? cause)))
      .finally(() => active && setLoading(false))

    return () => { active = false }
  }, [apiBase, tenantID])

  const save = async () => {
    if (!tenantID || !tenant) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      // Preserve the rest of the contact group (phone, email, address, hours) while relocating
      // only its social-link editor to this dedicated screen.
      const res = await fetch(`${apiBase}/tenants/${tenantID}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contact: { ...(tenant.contact ?? {}), social: links },
          socialPublishing: publishing,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.errors?.[0]?.message ?? body?.message ?? `HTTP ${res.status}`)
      const updated = body as TenantSocialData
      setTenant(updated)
      setLinks(updated.contact?.social ?? links)
      setPublishing({
        enabled: Boolean(updated.socialPublishing?.enabled),
        defaultAutoPublish: Boolean(updated.socialPublishing?.defaultAutoPublish),
        includedPlatforms: updated.socialPublishing?.includedPlatforms ?? [],
      })
      setNotice('Social settings saved.')
    } catch (cause) {
      setError(String((cause as Error)?.message ?? cause))
    } finally {
      setSaving(false)
    }
  }

  if (!tenantID) return <Gutter><Banner type="info">Select a tenant to manage its social settings.</Banner></Gutter>
  if (loading) return <Gutter><p>Loading social settings…</p></Gutter>
  if (!tenant) return <Gutter><Banner type="error">Unable to load social settings.</Banner></Gutter>

  return (
    <Gutter>
      <div className="collection-list">
        <div className="collection-list__wrap">
          <header className="list-header">
            <div className="list-header__content">
              <div className="list-header__title-and-actions">
                <h1 className="list-header__title">Social connections</h1>
              </div>
            </div>
          </header>

          <div className="collection-list__sub-header">
            <div className="collection-list__wrap">
              <div className="social-connections-settings" style={pageStack}>
                <p style={{ margin: 0 }}>Manage profile links, auto-publishing, and platform integrations for this tenant.</p>

                {(error || notice) && (
                  <div style={compactStack}>
                    {error && <Banner type="error">{error}</Banner>}
                    {notice && <Banner type="success">{notice}</Banner>}
                  </div>
                )}

                <section className="field-type group" style={sectionStack}>
                  <div style={compactStack}>
                    <h2 style={{ margin: 0 }}>Profile links</h2>
                    <p style={{ margin: 0 }}>These links are shown on the tenant’s public website.</p>
                  </div>
                  <div style={fieldStack}>
                    {PLATFORMS.map((platform) => {
                      const field = `${platform.key}Url`
                      return (
                        <TextInput
                          key={platform.key}
                          label={platform.label}
                          path={`contact.social.${field}`}
                          placeholder="https://…"
                          style={{ margin: 0 }}
                          value={links[field] ?? ''}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLinks((current) => ({ ...current, [field]: event.target.value }))}
                        />
                      )
                    })}
                  </div>
                </section>

                <section className="field-type group" style={sectionStack}>
                  <h2 style={{ margin: 0 }}>Auto-publishing</h2>
                  <div style={compactStack}>
                    <CheckboxInput
                      checked={publishing.enabled}
                      label="Enable auto-publishing"
                      name="socialPublishing.enabled"
                      onToggle={(event) => setPublishing((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    <CheckboxInput
                      checked={publishing.defaultAutoPublish}
                      label="Auto-publish new Articles by default"
                      name="socialPublishing.defaultAutoPublish"
                      onToggle={(event) => setPublishing((current) => ({ ...current, defaultAutoPublish: event.target.checked }))}
                    />
                  </div>
                  <SelectInput
                    hasMany
                    isClearable
                    label="Included platforms"
                    name="socialPublishing.includedPlatforms"
                    options={PLATFORMS.map((platform) => ({ label: platform.label, value: platform.key }))}
                    path="socialPublishing.includedPlatforms"
                    style={{ margin: 0 }}
                    value={publishing.includedPlatforms}
                    onChange={(value) => setPublishing((current) => ({
                      ...current,
                      includedPlatforms: (Array.isArray(value) ? value : [value]).map((option) => String(option.value)),
                    }))}
                  />
                </section>

                <div>
                  <Button buttonStyle="primary" disabled={saving} onClick={() => void save()} type="button">
                    {saving ? 'Saving…' : 'Save social settings'}
                  </Button>
                </div>

                <SocialConnectionsPanel tenantId={tenantID} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Gutter>
  )
}
