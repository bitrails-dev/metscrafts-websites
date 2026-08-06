'use client'
// Per-platform social connection panel in the consolidated Social connections settings view. Reads sanitized status (incl. the
// platform label + availability) from /api/tenants/:id/social-status — NO label map is duplicated
// here; every label/availability flag comes from the single platform catalogue via the server
// response. Offers OAuth Connect (redirect, only for available platforms) / Disconnect, and shows the
// last publish result.
import React, { useEffect, useState } from 'react'
import { Banner, Button, useConfig } from '@payloadcms/ui'

const panelStack = { display: 'grid', gap: 'calc(var(--base) * 1.5)', margin: 0 } as const
const compactStack = { display: 'grid', gap: 'calc(var(--base) * 0.75)' } as const
const platformRow = {
  alignItems: 'flex-start',
  display: 'flex',
  gap: 'calc(var(--base) * 2)',
  justifyContent: 'space-between',
  margin: 0,
} as const
const platformActions = { display: 'flex', flexShrink: 0, flexWrap: 'wrap', gap: 'calc(var(--base) * 0.75)' } as const

type PlatformStatus = {
  platform: string
  label: string
  available: boolean
  approvalNote: string
  connected: boolean
  status: string
  remoteAccountLabel: string
  lastPublishStatus: string
  lastPublishUrl: string
  lastPublishAt: string
  lastErrorCode: string
  lastFailedArticleId: string
}

type Props = {
  tenantId: number | string
}

export default function SocialConnectionsPanel({ tenantId: id }: Props) {
  const { config } = useConfig()
  const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`${apiBase}/tenants/${id}/social-status`, { credentials: 'include' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setPlatforms(body.platforms as PlatformStatus[])
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  useEffect(() => { void load() }, [id])

  if (!id) return null

  const connect = (platform: string) => {
    const returnTo = `${window.location.pathname}${window.location.search}`
    window.location.href = `${apiBase}/social/connect/${platform}?tenant=${id}&returnTo=${encodeURIComponent(returnTo)}`
  }
  const disconnect = async (platform: string) => {
    if (!window.confirm(`Disconnect ${platform}?`)) return
    const res = await fetch(`${apiBase}/social/disconnect`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ tenant: id, platform }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`)
    if (res.ok && body?.revoked === 'failed') setError(`${platform} revocation failed — retry from the provider console.`)
    await load()
  }
  const retry = async (platform: string, articleId: string) => {
    setError(null)
    const res = await fetch(`${apiBase}/social/retry-publication`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ tenantId: id, articleId, platform }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`)
    else await load()
  }

  return (
    <section className="field-type group" style={panelStack}>
      <div style={compactStack}>
        <h2 style={{ margin: 0 }}>Platform integrations</h2>
        <p style={{ margin: 0 }}>
          Connect each platform to enable auto-publishing. Inclusion is set in the “Included platforms” field.
        </p>
      </div>
      {error && <Banner type="error">{error}</Banner>}
      {!platforms && !error && <p>Loading…</p>}
      {platforms?.map((p) => (
        <div className="field-type__wrap" key={p.platform} style={platformRow}>
          <div>
            <strong>{p.label}</strong>{p.remoteAccountLabel ? ` — ${p.remoteAccountLabel}` : ''}
            <p style={{ margin: 'calc(var(--base) * 0.5) 0 0' }}>
              {p.connected
                ? `connected · last: ${p.lastPublishStatus || '—'}`
                : p.available
                  ? `not connected${p.status === 'reconnect_required' ? ' (reconnect required)' : ''}`
                  : `not available${p.approvalNote ? ` — ${p.approvalNote}` : ''}`}
              {p.lastErrorCode ? ` · ${p.lastErrorCode}` : ''}
            </p>
          </div>
          {p.available && (
            <div style={platformActions}>
              {p.connected ? (
              <>
                {p.lastPublishStatus === 'failed' && p.lastFailedArticleId ? (
                  <Button buttonStyle="secondary" onClick={() => retry(p.platform, p.lastFailedArticleId)} size="small" type="button">Retry</Button>
                ) : null}
                <Button buttonStyle="secondary" onClick={() => disconnect(p.platform)} size="small" type="button">Disconnect</Button>
              </>
            ) : (
              <Button buttonStyle="primary" onClick={() => connect(p.platform)} size="small" type="button">Connect</Button>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
