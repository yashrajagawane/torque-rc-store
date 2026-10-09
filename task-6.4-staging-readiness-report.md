# Task 6.4 — Fly RC Hobbies Staging Preparation Report

**Overall status: READY FOR STAGING CONFIGURATION**

The repository now has a Vercel-oriented Express and static-asset path, health/readiness endpoints, and a protected reservation-cleanup route. Local builds and route checks passed.

**No Vercel or Supabase project was independently identified, and no staging deployment or database connection was attempted.** Staging migrations, deployed TLS, live authentication, and payment behavior remain unverified. A Supabase-aware migration path must be resolved before initializing a staging database.

## Changes made

- `vercel.json`: Configures the Express Function entry, generated frontend assets, function duration, and response security headers.
- `package.json`, `scripts/prepare-vercel-assets.mjs`, `vite.config.ts`, `.gitignore`: Add a Vercel frontend build that places Vite output in generated `public/`, while retaining the standalone Node build/start workflow.
- `server.ts`: Exports the Express app for Vercel, retains `app.listen` for standalone Node, preserves raw webhook parsing order, adds health/readiness and protected cleanup routes, and returns JSON API 404s separately from SPA routes.
- `src/server/health-routes.ts`: Adds liveness and bounded, read-only database readiness handlers.
- `src/server/reservation-cron-route.ts`: Adds a `CRON_SECRET`-protected route reusing the existing reservation-expiry logic.
- `src/db/index.ts`: Bounds the Vercel database pool to one connection per process and uses a shorter connection timeout.
- `src/lib/product-upload.ts`, `src/server/admin-product-routes.ts`, `src/pages/AdminProductsPage.tsx`, `tests/admin-products.test.ts`: Limit product image uploads to 4 MiB, below Vercel's 4.5 MB Function request-body limit.
- `.env.example`, `README.md`: Document staging variables, deployment workflow, database considerations, cleanup scheduling, and backup/restore steps.
- `tests/health-routes.test.ts`: Adds mocked health, readiness, and cleanup-route tests.

No database schema, migration, authentication, payment, or reservation business logic was changed. The worktree contains other pre-existing changes from earlier tasks; no commits or pushes were made.

## Vercel routing strategy

Vercel runs the root Express app in a Function. Vite output is generated into `public/` for Vercel static asset delivery; Express handles `/api/*`, and the app returns the SPA entry for client-side routes. The standalone `node server.js` path remains supported. Vercel documents that deployed `express.static()` does not serve static assets, so those files need Vercel static delivery: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express).

The Vercel-mode local smoke test verified the homepage, an emitted static asset, an SPA route refresh, `/api/health`, and a JSON API 404. This was a local harness, **not a Vercel deployment or platform validation**.

## Environment variables

Set **Preview/staging** values independently in Vercel. Do not copy Production values.

| Scope | Variable names | Purpose |
|---|---|---|
| Browser, staging only | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Staging Supabase Auth URL and public key |
| Server, staging only | `DATABASE_URL`, `DATABASE_SSL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS` | Staging PostgreSQL, server token verification, and staging owner account |
| Server, optional privileged storage | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | Server-side product image storage; privileged credentials must never use a `VITE_` prefix |
| Server, Test Mode only | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay Test Mode; public key should have the test-key prefix |
| Server, optional | `SHIPPING_FLAT_RATE_INR` | Shipping calculation configuration |
| Server, scheduled cleanup | `CRON_SECRET` | Independently generated, strong staging-only secret |
| Migration process only | `MIGRATION_DATABASE_URL` | Explicit staging migration target when approved |

`.env.example` contains placeholders only. No environment secrets were supplied or verified. `DATABASE_URL` must identify the dedicated staging database; do not reuse a production URL. Frontend Supabase variables must point to the staging project.

A local bundle scan found none of the checked server-secret and database-variable identifiers in the built client output. This is a static local scan, not a review of deployed Vercel environment configuration.

## Database compatibility and migration gate

The application uses Drizzle's `node-postgres` adapter with `pg`, not `postgres.js`. The Vercel pool is limited to one connection per process, and remote SSL is supported by the current configuration. Supabase offers direct and pooled connection modes; its shared transaction pooler has documented driver-specific caveats, including one for `postgres.js`. The exact staging endpoint and pool mode still need to be selected and tested against transaction-heavy checkout and inventory paths. See [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres) and [Supabase Postgres.js guidance](https://supabase.com/docs/guides/database/postgres-js).

**No staging migration was run.** The fresh initializer requires an empty database and counts non-system relations, while Supabase has platform-managed objects. The staging project reference and target were unavailable for independent verification. Do not bypass the initializer or run legacy migrations blindly: resolve a Supabase-compatible, reviewed initialization path and verify the dedicated project and its application schema/history first.

Earlier reported PostgreSQL results—fresh baseline through `0005`, followed by `0006_contact-inquiries`, and 19 integration tests—were against disposable local PostgreSQL databases. They are not evidence of staging Supabase compatibility.

## Health and reservation cleanup

- `GET /api/health` is lightweight and does not disclose environment or infrastructure details.
- `GET /api/ready` performs a bounded, read-only `SELECT 1`; failures return a generic 503.
- Local mock tests cover successful and failed readiness. A local unavailable-loopback check returned generic 503. **No staging database connectivity was tested.**
- `POST /api/internal/reservations/expire` requires a bearer `CRON_SECRET`, accepts no database target or cleanup parameters, and reuses the existing transactional expiry logic.
- No Vercel Cron schedule was added. Reservation lifetime is 20 minutes, while Vercel Hobby Cron supports at most one run per day; that cadence is insufficient for timely cleanup. Use a suitable external scheduler or a plan that supports more frequent runs. The account plan is unknown. See [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

The cleanup endpoint tests are mocked; no scheduled invocation was made.

## TLS, domain, and backups

- No staging hostname exists in the available evidence. TLS certificates, HTTP-to-HTTPS redirects, deployed API routing, and Supabase Auth redirect allowlists remain **unverified**.
- The `.tech` domain and its DNS were not changed. Begin with the Vercel-provided Preview hostname; after deployment, add that exact hostname to the staging Supabase Auth redirect allowlist.
- The actual Supabase plan is unknown, and no backup/restore drill was performed. The README documents CLI/PostgreSQL export, encryption, off-site storage, restoration to a separate disposable target, and validation. Current Supabase documentation indicates daily platform backups are plan-dependent; do not assume they exist on Free. Database backups do not include Storage objects. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups), [Supabase CLI database dump](https://supabase.com/docs/reference/cli/v0/supabase-db-dump), and [Vercel Node.js runtimes](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## Verification results

| Check | Result |
|---|---|
| `bun run lint` | Exit 0 |
| `bun run build` | Exit 0 |
| `bun run build:vercel` | Exit 0 |
| `bun test` | Exit 0 — 118 passed, 0 failed, 1 skipped |
| `git diff --check` | Exit 0 |
| Vercel config JSON parse | Exit 0; Vercel CLI/schema validation unavailable |
| Local Vercel-mode route/static smoke | Exit 0 — homepage, asset, SPA route, health, and API 404 returned expected responses |
| Local readiness failure check | HTTP 503 with generic response; no real database involved |
| Client bundle secret-identifier scan | No checked identifiers found |
| `bun run test:postgres` | Not run |
| Supabase migration/connectivity | Not run |
| Vercel deployment/TLS | Not performed |

Build warnings remain: Vite reports a future `__dirname` config-loader concern and a JavaScript chunk larger than 500 KB. The build completed successfully. Vercel CLI was unavailable, so the deployment configuration was not validated by Vercel itself.

## Remaining priorities

1. **Before database initialization:** verify the dedicated staging Supabase project reference and establish a reviewed Supabase-compatible initialization/migration path.
2. **Before deployment:** create a dedicated Vercel staging/Preview target, configure its variables separately, and confirm the account plan is appropriate for commercial use and cleanup scheduling.
3. Configure staging Supabase Auth redirect URLs, Storage bucket permissions, Test Mode Razorpay credentials, and a staging owner account.
4. Deploy only to the approved Preview target; then verify its real HTTPS hostname, API routes, readiness, authentication redirects, Test Mode webhook, and database behavior.
5. Complete a backup/restore drill into a separate disposable target.

**Recommended next task:** resolve and review the Supabase-specific staging database initialization and migration plan. Do not run migrations until the project and target schema/history are independently confirmed.

**Recommended commit message:** `Prepare Vercel and Supabase staging deployment path`
