# Social auto-publishing: provider app setup

Last verified against the provider documentation: **2026-08-09**.

This guide explains how an operator creates the provider-owned developer apps whose client IDs and
client secrets are required by the CMS. These are application credentials, not credentials supplied
by each tenant. They are configured once. Afterward, each tenant administrator clicks **Connect**,
signs in on the provider's own site, grants the requested permissions, and the CMS stores that
tenant's resulting token encrypted at rest.

Never ask a tenant for a social account password. Never paste an app secret or user token into a
ticket, chat, source file, or committed configuration.

## What is supported

| Platform | OAuth connection | Current publishing behavior | Developer approval caveat |
| --- | --- | --- | --- |
| Facebook | Yes | Facebook Page link or image post | Advanced access/app review is normally needed for Pages not owned by app-role users |
| Instagram | Yes | Single-image post to a professional account | Professional account linked to a Facebook Page; Advanced Access/app review for outside users |
| X | Yes, OAuth 2.0 PKCE | Text/link post, optionally with an image | API usage is pay-per-use and requires funded credits |
| Threads | Yes | Text or single-image post | `threads_content_publish` requires review for public users |
| YouTube | Yes | Connection works, but publishing currently skips | The CMS has no owned-video upload field/adapter implementation yet |
| LinkedIn | Yes | Member link or image share | Publishes as the connected member, not a Company Page |
| TikTok | Yes | Direct photo post from a public URL | App review, Content Posting audit, and media URL ownership verification are needed |
| Snapchat | No | Explicitly reported as unavailable | Public Profile API access is allowlist-gated; no self-serve OAuth flow is implemented |

The source of truth for this list is `src/social/platforms.ts`. The OAuth implementation and exact
requested scopes are in `src/social/oauth/providers.ts`.

## Shared preparation

Do this before creating any provider app:

1. Make sure the CMS is publicly reachable over HTTPS. OAuth providers cannot redirect to an
   internal hostname.
2. Keep `SOCIAL_REDIRECT_BASE` stable. Changing it means updating every provider's allowlisted
   callback URI.
3. Publish public pages for the app home page, privacy policy, terms of service, support contact, and
   account/data-deletion instructions. Meta, Google, TikTok, and LinkedIn can require these during
   review.
4. Use an organization-controlled developer account and password manager. Add at least one backup
   administrator in each provider console.
5. Use separate provider projects/apps for production and local/staging when possible. Do not put a
   production secret into an untrusted preview deployment.

The current CMS configuration is:

```text
SOCIAL_REDIRECT_BASE=https://3001.bitrail.dev
SOCIAL_SITE_URL=https://4321.bitrail.dev
SOCIAL_MEDIA_BASE=https://3001.bitrail.dev
```

Therefore, register these callback URLs exactly, including the scheme and path and without a query
string:

```text
https://3001.bitrail.dev/api/social/callback/facebook
https://3001.bitrail.dev/api/social/callback/instagram
https://3001.bitrail.dev/api/social/callback/x
https://3001.bitrail.dev/api/social/callback/threads
https://3001.bitrail.dev/api/social/callback/youtube
https://3001.bitrail.dev/api/social/callback/linkedin
https://3001.bitrail.dev/api/social/callback/tiktok
```

If the deployed hostname changes, update `SOCIAL_REDIRECT_BASE` and every registered callback before
testing. Redirect URI matching is exact on most providers.

## Environment variables

Put the resulting values in `cms/.env` for local use and in the deployment platform's secret store
for production. `cms/.env` is gitignored.

```dotenv
SOCIAL_FB_CLIENT_ID=
SOCIAL_FB_CLIENT_SECRET=

SOCIAL_IG_CLIENT_ID=
SOCIAL_IG_CLIENT_SECRET=

SOCIAL_X_CLIENT_ID=
SOCIAL_X_CLIENT_SECRET=

SOCIAL_THREADS_CLIENT_ID=
SOCIAL_THREADS_CLIENT_SECRET=

SOCIAL_YOUTUBE_CLIENT_ID=
SOCIAL_YOUTUBE_CLIENT_SECRET=

SOCIAL_LINKEDIN_CLIENT_ID=
SOCIAL_LINKEDIN_CLIENT_SECRET=

SOCIAL_TIKTOK_CLIENT_ID=
SOCIAL_TIKTOK_CLIENT_SECRET=
```

Restart the CMS after changing environment variables. Client credentials are read by the server;
they are never returned to the browser.

## Facebook Pages

Official references: [Meta app creation](https://developers.facebook.com/docs/development/create-an-app/),
[Pages API](https://developers.facebook.com/docs/pages-api/), and
[Page access tokens](https://developers.facebook.com/docs/pages-api/getting-started/).

### Create and configure the Meta app

1. Sign in at [Meta for Developers](https://developers.facebook.com/apps/) with the organization's
   Meta developer account and select **Create app**.
2. Choose the business-oriented app/use case that permits Facebook Login and Pages API access. Meta
   changes the dashboard wording periodically; the required outcome is a Meta app with Facebook
   Login for Business and Pages permissions.
3. Associate the app with the correct verified Meta Business Portfolio when the dashboard asks.
4. In **App settings > Basic**, complete the app display name, app icon, contact email, app domain,
   privacy policy URL, terms URL, and data-deletion URL/instructions.
5. Add/configure **Facebook Login for Business**. Enable client OAuth and web OAuth login.
6. Add this exact **Valid OAuth Redirect URI**:

   ```text
   https://3001.bitrail.dev/api/social/callback/facebook
   ```

7. Request these permissions/features in the app dashboard:

   ```text
   pages_show_list
   pages_read_engagement
   pages_manage_posts
   ```

   The CMS asks for exactly these scopes. `pages_show_list` discovers Pages the user manages,
   `pages_read_engagement` permits the required Page access, and `pages_manage_posts` permits Page
   publishing.
8. While the app is in development mode, add the people who will test it under **App roles**. A test
   person must also have sufficient Facebook access to the Page, including content creation rights.
9. Copy **App ID** and **App secret** from **App settings > Basic** into:

   ```dotenv
   SOCIAL_FB_CLIENT_ID=<Meta App ID>
   SOCIAL_FB_CLIENT_SECRET=<Meta App secret>
   ```

### Move Facebook beyond test users

For tenants who are not app administrators/developers/testers, complete Meta Business Verification
when requested, request **Advanced Access** for all three permissions, and submit App Review. The
review submission should show, in one continuous recording:

1. A tenant administrator opening Social connections.
2. Clicking **Connect** for Facebook.
3. The Meta consent dialog showing the requested permissions.
4. Selecting a Page when more than one is returned.
5. Creating an Article and the resulting Page post.
6. Disconnecting the account and explaining the app's data-deletion path.

Do not switch the app to Live until its public URLs, app branding, permission descriptions, and test
instructions are complete.

## Instagram professional accounts

The current CMS implements **Instagram API with Facebook Login**, not the newer Instagram Login
variant. The connected Instagram account must be a Business or Creator account linked to a Facebook
Page. Personal/consumer Instagram accounts cannot be connected by this implementation.

Official references: [Meta's Instagram API collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api),
[Instagram API with Facebook Login](https://www.postman.com/meta/instagram/folder/23987686-3a75357f-e106-47ef-a8d9-af1aadf85365),
and [content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/).

### Prepare the Instagram account

1. Convert the Instagram profile to a **Business** or **Creator** professional account.
2. Link it to a Facebook Page.
3. Ensure the person used for OAuth has access to that Page and the linked Instagram account in the
   Business Portfolio.

### Configure the Meta app

You can reuse the Facebook Meta app above. This is usually simpler. The repo keeps separate Facebook
and Instagram variables so different apps can be used if policy or ownership requires it.

1. Add the Instagram API/Facebook Login for Business use case to the Meta app.
2. Add this exact valid OAuth redirect URI alongside the Facebook callback:

   ```text
   https://3001.bitrail.dev/api/social/callback/instagram
   ```

3. Request Advanced Access for:

   ```text
   instagram_basic
   instagram_content_publish
   pages_show_list
   ```

4. For Meta review and broader API compatibility, also request `pages_read_engagement`. The current
   CMS authorization URL does not yet request that extra scope, so it must be added in code before it
   can be relied upon at runtime.
5. Add test users/app roles while the app is in development mode. Each tester must have a role on the
   app and access to the Page and professional Instagram account.
6. If sharing the Facebook app, use the same App ID and secret in both pairs:

   ```dotenv
   SOCIAL_IG_CLIENT_ID=<same Meta App ID>
   SOCIAL_IG_CLIENT_SECRET=<same Meta App secret>
   ```

   If using a separate Meta app, use that app's credentials instead.

Instagram publishes only when an Article has an eligible, publicly fetchable image. This CMS does
not publish Instagram video/Reels yet.

## Threads

Threads uses a Meta developer app, but its OAuth flow uses the **Threads App ID** and **Threads App
secret** shown for the Threads use case. Do not assume the general Facebook App ID is interchangeable.

Official references: [Threads API documentation](https://developers.facebook.com/docs/threads/),
[Threads getting started](https://developers.facebook.com/docs/threads/get-started/), and
[Meta's official Threads API collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api).

1. In [Meta for Developers](https://developers.facebook.com/apps/), create a Meta app with the
   **Access the Threads API** use case.
2. Complete the app's basic information, public policy URLs, domain, icon, and contact details.
3. Open the Threads use case settings and add this exact redirect/callback URL:

   ```text
   https://3001.bitrail.dev/api/social/callback/threads
   ```

4. Enable/request:

   ```text
   threads_basic
   threads_content_publish
   ```

5. Add the Threads accounts used for development as testers, then have each account accept its
   tester invitation.
6. Copy the **Threads App ID** and **Threads App secret** displayed for the Threads configuration:

   ```dotenv
   SOCIAL_THREADS_CLIENT_ID=<Threads App ID>
   SOCIAL_THREADS_CLIENT_SECRET=<Threads App secret>
   ```

7. Test the full consent and publish flow with a tester. Submit App Review for
   `threads_content_publish` before enabling arbitrary tenant accounts.

The CMS exchanges the initial token for a long-lived Threads token and refreshes it before expiry.

## YouTube

Official references: [YouTube OAuth 2.0](https://developers.google.com/youtube/v3/guides/authentication),
[OAuth for server-side web apps](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps),
and [Google OAuth app verification](https://support.google.com/cloud/answer/13461325).

### Create the Google Cloud OAuth client

1. Sign in to the [Google Cloud Console](https://console.cloud.google.com/) with an organization-owned
   Google account.
2. Create a dedicated production project, or select the intended project.
3. Open **APIs & Services > Library**, find **YouTube Data API v3**, and enable it.
4. Open **Google Auth Platform** (formerly **OAuth consent screen**) and configure:

   - Branding: app name, support email, logo, home page, privacy policy, and terms.
   - Audience: choose **External** for tenants outside one Google Workspace organization.
   - Data access/scopes: add `https://www.googleapis.com/auth/youtube.upload`.
   - Test users: add the Google accounts that will connect during development.

5. Open **APIs & Services > Credentials**, select **Create credentials > OAuth client ID**, and choose
   **Web application**.
6. Add this exact **Authorized redirect URI**:

   ```text
   https://3001.bitrail.dev/api/social/callback/youtube
   ```

7. Copy the generated client ID and client secret into:

   ```dotenv
   SOCIAL_YOUTUBE_CLIENT_ID=<Google OAuth client ID>
   SOCIAL_YOUTUBE_CLIENT_SECRET=<Google OAuth client secret>
   ```

No API key is needed for this OAuth flow.

### Testing and production notes

- In External/Testing mode, only listed test users can authorize. Authorizations involving this
  YouTube scope expire after seven days in testing, including offline refresh tokens.
- Move the consent screen to **In production** and complete Google verification for public tenant
  use. Google requires ownership verification for domains used by the home page, policy pages, and
  redirect URIs.
- The CMS requests offline access and `prompt=consent`, so Google can return a refresh token.
- Google separately restricts uploads from unverified API projects to private visibility until the
  project passes the applicable YouTube API audit.

Important: the current YouTube adapter intentionally returns `skipped: no_owned_video` for every
Article. OAuth can be configured and connected now, but actual uploading requires an owned video
field/storage pipeline and a resumable `videos.insert` implementation.

## TikTok

Official references: [register a TikTok app](https://developers.tiktok.com/doc/getting-started-create-an-app),
[Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web),
[Content Posting API getting started](https://developers.tiktok.com/doc/content-posting-api-get-started/),
and [Direct Post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post).

1. Create an organization-controlled account at [TikTok for Developers](https://developers.tiktok.com/)
   and create or join a developer organization.
2. Under **Manage apps**, select **Connect an app**. Configure the app in Sandbox first and create a
   Production configuration for review.
3. Complete the app name, icon, category, description, official website, privacy policy, and terms.
4. Add the **Web** platform.
5. Add/configure **Login Kit** and register this exact HTTPS redirect URI:

   ```text
   https://3001.bitrail.dev/api/social/callback/tiktok
   ```

6. Add the **Content Posting API** product and enable **Direct Post**.
7. Request these scopes:

   ```text
   user.info.basic
   video.publish
   ```

   Despite its name, `video.publish` is also the scope used by the Content Posting API direct photo
   flow implemented by this CMS.
8. Use TikTok's **URL properties** control to verify ownership of:

   - The website/privacy/terms domains used in the app configuration.
   - The domain or URL prefix from which TikTok will pull media. For the current configuration, begin
     with `3001.bitrail.dev`; if Article images are served from another host, verify that host too.

   TikTok does not follow redirects for `PULL_FROM_URL`; the final image URL must be public, directly
   downloadable, and under a verified domain/prefix.
9. Copy **Client key** and **Client secret** from the app's Credentials section. TikTok calls the ID a
   client key, but it goes into the CMS's client-ID variable:

   ```dotenv
   SOCIAL_TIKTOK_CLIENT_ID=<TikTok Client key>
   SOCIAL_TIKTOK_CLIENT_SECRET=<TikTok Client secret>
   ```

10. Test with Sandbox-authorized accounts, then submit the production app and each product/scope for
    review. Explain each scope and include a recording of consent, creator/account selection,
    publishing options, explicit publish confirmation, result, and disconnect.
11. After functional testing, request the Content Posting API audit. Direct posts from unaudited
    clients are restricted to private/`SELF_ONLY` visibility.

The current adapter publishes a photo using `PULL_FROM_URL`; it does not upload an owned video binary.

## X

Official references: [getting X API access](https://docs.x.com/x-api/getting-started/getting-access),
[OAuth 2.0 Authorization Code with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code),
and [X API pricing](https://docs.x.com/x-api/getting-started/pricing).

1. Sign in to the [X Developer Console](https://console.x.com/), accept the developer agreement, and
   complete the developer use-case profile.
2. Create a new app and describe the multi-tenant social-publishing use case accurately.
3. Configure **User authentication settings** for OAuth 2.0:

   - App type: **Web App** or **Automated App/Bot** so it is a confidential client and receives a
     client secret.
   - App permissions: **Read and write**.
   - Callback/redirect URI:

     ```text
     https://3001.bitrail.dev/api/social/callback/x
     ```

   - Website URL: the public application/CMS website.

4. Ensure the app can request the scopes used by the CMS:

   ```text
   tweet.read
   tweet.write
   users.read
   media.write
   offline.access
   ```

5. In **Keys and tokens**, copy the OAuth 2.0 **Client ID** and **Client Secret**. Do not substitute
   the API Key/API Key Secret, bearer token, or OAuth 1.0a access token:

   ```dotenv
   SOCIAL_X_CLIENT_ID=<OAuth 2.0 Client ID>
   SOCIAL_X_CLIENT_SECRET=<OAuth 2.0 Client Secret>
   ```

6. Purchase API credits in the Developer Console and configure a spending limit/alerts. X currently
   bills API operations on a pay-per-use basis, including post creation.

The CMS uses S256 PKCE, stores the refresh token, and requests `offline.access` so an account can stay
connected until the grant is revoked.

## LinkedIn

The current CMS publishes as the connected LinkedIn **member** using `w_member_social`. It does not
discover or publish as a LinkedIn Company Page. Organization publishing would require a separate
implementation and `w_organization_social` access.

Official references: [create a LinkedIn developer app](https://www.linkedin.com/help/linkedin/answer/a1667239),
[getting API access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access),
[three-legged OAuth](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow),
and [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).

1. Create or identify the organization's LinkedIn Page. The person creating the app must be able to
   associate the developer app with that Page.
2. Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps), select **Create
   app**, and supply the app name, associated LinkedIn Page, privacy policy URL, and logo.
3. Complete the Page/app ownership verification request if LinkedIn presents one. A Page super admin
   may need to approve the association.
4. Under **Products**, add **Share on LinkedIn**. This grants the open `w_member_social` permission.
5. Under **Auth**, add this exact authorized redirect URL:

   ```text
   https://3001.bitrail.dev/api/social/callback/linkedin
   ```

6. Confirm `w_member_social` appears in the app's available OAuth scopes.
7. Copy the **Client ID** and **Primary Client Secret** from the Auth tab:

   ```dotenv
   SOCIAL_LINKEDIN_CLIENT_ID=<LinkedIn Client ID>
   SOCIAL_LINKEDIN_CLIENT_SECRET=<LinkedIn Primary Client Secret>
   ```

LinkedIn member access tokens expire. Programmatic refresh tokens are available only to some
partners, and this CMS does not implement LinkedIn refresh. A tenant must reconnect when its token
expires. The publishing adapter also uses LinkedIn's older `assets`/`ugcPosts` endpoints; plan a
migration to the current versioned Posts and Images APIs before treating the integration as a
long-lived production integration.

## Snapchat

Do not look for `SOCIAL_SNAPCHAT_CLIENT_ID`; the CMS intentionally has no Snapchat OAuth credentials
or Connect flow. Snapchat Public Profile publishing is allowlist-gated rather than a generally
self-serve API. Use an approved/allowlisted marketing partner or post manually until a qualifying
integration is available and implemented.

## Test each connection

After configuring one or more apps:

1. Restart the CMS:

   ```bash
   cd cms
   npm run dev
   ```

2. Sign in to Payload as a super-admin or tenant admin.
3. Select the tenant, open **Social connections**, and click **Connect** for the platform.
4. Confirm the browser lands on the provider's real HTTPS domain and shows the expected app name and
   requested permissions.
5. Approve access. If multiple Pages/accounts are available, select the intended target on the CMS
   selection page.
6. Confirm the platform row shows **connected** and the expected remote-account label.
7. Enable auto-publishing and include the platform in the tenant's **Included platforms** field.
8. Create a test Article with an eligible public image where the adapter requires one.
9. Run/drain the configured Payload jobs worker and check the platform row's last-publish status.
10. Click **Disconnect** and confirm the connection disappears. Reconnect before production testing.

Use provider-role/test accounts until review is complete. Development-mode success does not prove
that an unrelated tenant account can authorize the production app.

## Common failures

### `<platform> is not configured. Set its client id/secret.`

One or both environment variables are empty, were added to the wrong service, or the CMS was not
restarted after changing them.

### Redirect URI mismatch / URL blocked

Compare the URI shown in the provider error with the provider console and `SOCIAL_REDIRECT_BASE`.
Scheme, hostname, port, path, and sometimes a trailing slash must match exactly. The callbacks in this
CMS do not have a trailing slash.

### Consent works only for the developer

The provider app is still in development/testing mode, the user was not added as a tester, or the app
does not have production/Advanced Access for the requested scopes.

### No Facebook or Instagram accounts found

- The Facebook user does not have sufficient Page access.
- `pages_show_list` was not granted.
- For Instagram, the account is personal rather than professional, is not linked to a Facebook Page,
  or the OAuth user lacks access to the linked assets.

### YouTube says connected but never publishes

This is expected until the CMS gains owned-video upload support and a YouTube upload adapter.

### TikTok posts are private or media pull fails

Private posts indicate an unaudited Content Posting client or a creator whose allowed privacy options
do not include public. Pull failures usually mean the final image URL is not public, redirects, or is
outside TikTok's verified domain/URL prefix.

### LinkedIn later requires reconnecting

The member token expired. This CMS has no LinkedIn programmatic refresh flow.

## Security and production checklist

- [ ] Every secret is stored only in `cms/.env` locally and a deployment secret manager in production.
- [ ] `PAYLOAD_SECRET` is a stable, random value of at least 32 bytes; changing it makes stored social
      tokens undecryptable.
- [ ] Production and staging use separate provider apps where practical.
- [ ] The provider app has two organization-controlled administrators.
- [ ] Home, privacy, terms, support, and deletion pages are public and accurate.
- [ ] Every production domain is verified where the provider requires it.
- [ ] Only the scopes listed for the implemented feature are requested.
- [ ] App review/audit has been completed before inviting unrelated tenant accounts.
- [ ] Provider billing/quota alerts are enabled, especially for X and YouTube.
- [ ] Token revocation and reconnect behavior have been tested.
- [ ] A test Article has produced a real post on every enabled, publish-capable platform.

Provider consoles and review policies change more frequently than the CMS. If a dashboard label no
longer matches this guide, follow the linked official documentation while preserving the exact
callback URI, scopes, and credential mapping described above.
