# Permitline — Florida permit dashboard

Standard Next.js application prepared for GitHub and Vercel. The light and pure black themes, permit filters, detail drawer, saved leads, private notes, CSV export, source health and optional Jev controls are included. The dashboard uses its own password login.

The collector runs separately on the existing Google Cloud VM. It fetches sources every 20 minutes and stores permits in Supabase. This app reads that collector's authenticated API; its server routes keep API tokens and model keys private.

## First deployment

1. Put this project's contents at the root of a GitHub repository. Give OpenMausBot access to that repository so it can inspect the frontend API contract and coordinate changes.
2. Use the same Supabase project as the collector. Copy its transaction-pooler connection string from **Connect**, including the correct host and username; replace the password placeholder privately. The app disables prepared statements and uses one database connection per instance. No Supabase frontend API key is required by this implementation.
3. Install dependencies with the pinned pnpm version, copy `.env.example` to `.env.local`, and set `DATABASE_URL`. Run `pnpm db:migrate`, followed by `pnpm db:check`. Alternatively, run `db/schema.sql` in the Supabase SQL editor. The setup creates only the five tables in the private `permitline_dashboard` schema. It does not alter collector tables.
4. Set `WORKSPACE_PASSWORD` privately to a password of 10–200 characters. This seeds the account on its first login; arbitrary public visitors cannot set the initial password. Change the password later through Settings. Changing this environment variable does not replace an existing stored password.
5. Import the GitHub repository into Vercel. Framework: **Next.js**; root directory: repository root; build command: `pnpm build`. Let Vercel select the output directory. Set the server environment variables below, then deploy.
6. Open the Vercel URL and log in with your configured password. Until the collector origin is connected, permit views show 36 explicitly synthetic sample records and source connections are marked not connected.

Vercel can redeploy commits to the connected production branch. GitHub repository access and access to the password-protected website are separate: the bot can inspect code through GitHub without a ChatGPT session. Give it website credentials only if browser testing is necessary.

## Environment variables

Set values in Vercel's environment settings, not in GitHub source or public browser variables.

| Variable | Use |
| --- | --- |
| `DATABASE_URL` | Required: Supabase Postgres transaction-pooler connection for the schema owner, normally `postgres`. |
| `WORKSPACE_PASSWORD` | Required for first login: privately configured initial password. |
| `WORKSPACE_ID` | Optional stable workspace identifier; default `permitline-owner`. Use a different ID for an isolated preview workspace. |
| `WORKSPACE_NAME` | Optional name shown in the account menu. |
| `DATABASE_CA_CERT` | Optional PEM override for a custom database CA. Supabase hosts automatically use the bundled public Supabase CA; certificate and hostname verification remain enabled. |
| `PERMIT_API_URL` | Optional HTTPS collector origin, without a trailing `/api`; empty uses demo data. |
| `PERMIT_API_TOKEN` | Collector bearer token, required when its API requires authentication. |
| `AIMLAPI_KEY` | Optional AI/ML API server key for Jev assessments. |

Passwords use salted PBKDF2-SHA256. Sessions use random tokens, store token hashes in Postgres, expire after 12 hours and use HttpOnly/SameSite cookies. HTTPS cookies are Secure. The server checks the password session on every protected route. Five incorrect login attempts trigger a persisted five-minute lock. Password changes revoke previous sessions. The private database schema has RLS enabled, client grants revoked and no public client policies. The database connection must use its owner role.

Workspace notes/passwords from the earlier ChatGPT-hosted version are not automatically transferred to this separate Postgres workspace. This source archive contains no user records or database credentials.

## Local development and verification

Requires Node.js 22.13+ (verified on Node 24) and pnpm 11.25.0.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
# Set private values in .env.local, then:
pnpm db:migrate
pnpm db:check
pnpm dev
```

```bash
pnpm typecheck
pnpm test
pnpm build
```

The API tests use a disposable PGlite Postgres database and mock only the connection factory. They execute the application handlers, real SQL queries, schema permissions and persistence after a database restart. They never connect to production or call a paid model. A successful local build does not establish production Supabase connectivity or visual browser QA; run `pnpm db:check` against your configured project before deployment.

## Collector API contract

The app sends `Authorization: Bearer <PERMIT_API_TOKEN>` from server routes. Implement these endpoints in the collector backend:

| Endpoint | Response |
| --- | --- |
| `GET /api/permits` | `{ permits, total, stats?, updatedAt? }` |
| `GET /api/permits/:id` | `{ permit }` or a permit object |
| `GET /api/sources` | `{ sources }` |
| `GET /api/permits/export` | Filtered CSV with formula cells neutralized |

List requests send one-based `page`, `pageSize`/`limit` (up to 50), `q`, `county`, `trade`, `status`, `propertyType`, `age`, `sort`, `minimumValue`, `onlyServiceArea`, `profile`, optional `ids` for the saved view, and `dismissedIds`. Apply filters/sorting before pagination and return the filtered total. Date groups use America/New_York calendar days. `age` is `all`, `today`, `yesterday`, `two-days`, `week` (0–7 days inclusive) or `older` (more than 7 days). Sorting is `newest`, `oldest`, `priority` or `value`.

`profile` is JSON containing `company`, `trades`, `counties`, `commercialOnly`, `minimumValue` and `jevEnabled`. Priority ordering uses the service profile. `ids` is a comma-separated allowlist; an explicitly empty allowlist means zero matches. `dismissedIds` are excluded unless `hideDismissed=false`.

`stats`, when available, contains overall `total`, `today`, `yesterday`, `twoDays`, `week`, `older`, `commercial`, `open` and `strongFit`. Missing statistics are displayed as unavailable. Saved-view requests supply only the IDs that match the selected private sales state.

Permit fields and enum values are in `lib/types.ts`. Stable IDs are mandatory. The server accepts camelCase and common snake_case aliases. Unavailable fields stay null. Preserve exact source status in `rawStatus`; an empty completion date does not establish that a permit is open. Owner, applicant and contractor roles stay separate. Real permits have `demo: false`.

Source entries contain `id`, `name`, `county`, `url`, `format`, `status`, `lastSuccessAt`, `newestRecordAt`, `note`. Dashboard status is `not-connected`, `healthy`, `stale` or `error`; explain blocked/credentials-required conditions in the note. County sources may not cover independently permitting cities. Six feeds do not establish statewide coverage.

The dashboard owns private saved/contacted/won/dismissed states and notes in its workspace schema. It does not overwrite or duplicate collector permit records. Demo/selected CSV includes private notes; the upstream full CSV uses the collector's own fields.

## Jev

Optional assessments call `POST https://api.aimlapi.com/v1/decisions` with `typesafe/jev` and typed questions for service fit, scope clarity and trade. Responses are validated and cached per provider, model, permit and profile. Set `AIMLAPI_KEY` privately in Vercel and redeploy. Enable Jev in Settings, then choose Assess with Jev in a permit drawer. Collection keeps working without Jev. Priority and model confidence are not probabilities of winning a sale.

## References

- Next.js/Vercel: https://vercel.com/docs/frameworks/full-stack/nextjs
- GitHub deployments: https://vercel.com/docs/git/vercel-for-github
- Supabase database connections: https://supabase.com/docs/guides/database/connecting-to-postgres
- AI/ML API Jev: https://docs.aimlapi.com/api-references/decision-models/typesafe/jev
