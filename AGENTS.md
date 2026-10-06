# Permitline dashboard

This is the frontend and its server-side API adapter. The permit collector is a separate service on the existing Google Cloud VM.

- Preserve the Manrope typography, restrained light layout, pure black theme and responsive permit cards.
- Use standard Next.js/Vercel. Do not reintroduce Cloudflare Worker or ChatGPT identity dependencies.
- Keep the server password/session gate on every protected API route. Initial account setup comes from `WORKSPACE_PASSWORD`; public visitors cannot choose it.
- Workspace data lives in the private `permitline_dashboard` Postgres schema. Permit records belong to the collector. Preserve private notes and sales states when source data changes.
- Keep database credentials, collector bearer tokens and model keys exclusively in server environment variables. No secret values in code, tests, logs or chat. Keep `.env.local` ignored.
- Read README and `lib/types.ts` before implementing backend integration. Apply backend filters/sorts before pagination. Unknown source fields remain unknown. Never label sample records as live coverage.
- Keep Jev optional and collection independent of model availability. Display priority as service fit, not a sale probability.
- Run `pnpm typecheck`, `pnpm test` and `pnpm build` after changes that affect application behavior. `pnpm db:check` verifies the configured production connection; disposable local tests do not prove hosted connectivity.
- Do not add outreach sending to this dashboard without a separate request.
