// Dev-only mock for social auto-publishing. Gated by SOCIAL_DEV_MOCK=1. Lets you click Connect →
// create Article → see a "published" result in the admin panel with NO real provider apps, no network,
// and no provider credentials. Imported for its side effect in payload.config.ts (after the real
// adapter registration) so the overrides win; harmless when the flag is off (everything is a no-op).
//
// How it works:
//   - Sets fake SOCIAL_*_CLIENT_{ID,SECRET} env for every tier-1 platform so oauth/endpoints.ts
//     `clientCreds()` returns truthy and the existing connect/callback handlers run unchanged.
//   - Overrides OAUTH_PROVIDERS[platform] with a mock whose buildAuthUrl redirects straight back to
//     our own callback with a synthetic code → Connect is a one-click instant round-trip (no approval
//     page), exchangeCode/listTargets return a single fake account, storeConnection completes.
//   - Overrides the adapter for each platform so publish() records the post to an in-memory feed and
//     returns `published` — the durable job + connection panel then show a real-looking success.
//
// The feed is in-memory and resets on process restart. NEVER enable in production (no real security).
import type { Endpoint, PayloadRequest } from 'payload'
import { OAUTH_PROVIDERS, type OAuthProvider, type AccountTarget } from './oauth/providers'
import { registerAdapter } from './adapters'
import { TIER_1_PLATFORMS, envCredKeys, platformLabel } from './platforms'
import type { Platform, SocialAdapter, PublishInput, PublishResult, ProviderConnection, AdapterContext } from './types'

export const DEV_MOCK_ON = process.env.SOCIAL_DEV_MOCK === '1'

export type DevFeedPost = {
  id: string
  platform: Platform
  tenantId: number | string
  articleId: number | string
  title: string
  link: string
  description: string
  imageUrl?: string
  tags: string[]
  at: string
}

const feed: DevFeedPost[] = []
export const devFeed = (): DevFeedPost[] => [...feed]
export const clearDevFeed = (): void => { feed.length = 0 }

const mockProvider = (platform: Platform): OAuthProvider => ({
  platform,
  scope: 'mock',
  // Redirect straight back to our own callback (passed in as redirectUri) with a synthetic code, so
  // the OAuth round-trip completes instantly without a real provider or approval screen.
  buildAuthUrl: ({ redirectUri, state }) => `${redirectUri}?code=mock-code&state=${encodeURIComponent(state)}`,
  async exchangeCode() {
    return { access_token: 'mock-access-token', token_type: 'bearer', expires_in: 3600 }
  },
  async listTargets(): Promise<AccountTarget[]> {
    return [{
      remoteAccountId: `mock-${platform}`,
      remoteAccountLabel: `Mock ${platformLabel(platform, 'en')} (dev)`,
      credentials: {
        accessToken: 'mock-access-token',
        // Round-trips through encryptToken; an ISO string keeps the JSON fully string-typed.
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      },
    }]
  },
  async revoke() { return { revoked: true } },
})

const mockAdapter = (platform: Platform): SocialAdapter => ({
  platform,
  capabilities: { text: true, link: true, image: true, video: false },
  async publish(input: PublishInput, _conn: ProviderConnection, _ctx: AdapterContext): Promise<PublishResult> {
    const id = `mock-${platform}-${Date.now()}`
    feed.push({
      id, platform, tenantId: input.tenantId, articleId: input.articleId,
      title: input.title, link: input.link, description: input.description,
      imageUrl: input.imageUrl, tags: input.tags, at: new Date().toISOString(),
    })
    return { outcome: 'published', remoteId: id, remoteUrl: `/api/social/dev/feed` }
  },
})

if (DEV_MOCK_ON) {
  for (const platform of TIER_1_PLATFORMS) {
    const keys = envCredKeys(platform)
    if (keys) {
      process.env[keys[0]] ??= 'mock-client-id'
      process.env[keys[1]] ??= 'mock-client-secret'
    }
    OAUTH_PROVIDERS[platform] = mockProvider(platform)
    registerAdapter(mockAdapter(platform))
  }
}

// Read-only dev feed viewer so you can see what "published" without a real provider. Cleared via
// DELETE. Only mounted when SOCIAL_DEV_MOCK=1 (see payload.config.ts).
export const devMockEndpoints: Endpoint[] = DEV_MOCK_ON
  ? [
      {
        path: '/social/dev/feed',
        method: 'get',
        handler: async (_req: PayloadRequest) => Response.json({ posts: devFeed() }),
      },
      {
        path: '/social/dev/feed',
        method: 'delete',
        handler: async (req: PayloadRequest) => {
          // ponytail: same-origin guard keeps the clear behind the admin session (no CSRF on DELETE).
          const origin = req.headers?.get('origin') ?? ''
          const self = req.url ? new URL(req.url).origin : ''
          if (origin && self && origin !== self) return Response.json({ error: 'Cross-origin not allowed.' }, { status: 403 })
          clearDevFeed()
          return Response.json({ cleared: true })
        },
      },
    ]
  : []
