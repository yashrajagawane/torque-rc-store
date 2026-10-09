# RC MEGA / Fly RC Hobbies — Deployment-Readiness Re-Audit

**Audit date:** 2026-10-09  
**Scope:** Read-only final deployment-readiness review  
**Overall status:** **CONDITIONALLY READY FOR STAGING**

The production Node.js entry point started successfully and served the built homepage. Reported disposable-PostgreSQL verification provides useful schema and integration evidence. This does not establish end-to-end behavior with live Supabase or Razorpay, real browser flows, or a hosting provider. Before staging, verify the host's TLS, proxy, secrets, database, domain, and reservation-scheduler configuration.

## Prioritized findings

| Severity | Location | Finding and practical risk | Recommended next action |
|---|---|---|---|
| **High before production** | `server.ts`; hosting configuration | No health/readiness endpoint is evident. The smoke test showed the server can respond while database connectivity was intentionally unavailable; it proves startup and static serving, not readiness for database-backed traffic. | Define separate liveness and database-readiness checks and connect them to the chosen host's health checks. |
| **Medium** | `src/server/contact-routes.ts`; `server.ts` | Inquiry rate limiting is in-memory and per process. `trust proxy` is not configured. Behind a reverse proxy, requests may share the proxy IP bucket; multiple instances will not share limits. The README documents the per-process limitation. | Configure trusted proxy hops for the actual host and use a shared limiter before broad public exposure. |
| **Medium** | `server.ts:108,139` | Product API catch handlers log raw error objects. Depending on the database driver error, diagnostics could contain connection details. This is a potential logging exposure, not evidence that credentials were logged. | Use sanitized structured error logging and verify host log access and retention. |
| **Medium** | `server.ts`; hosting configuration | No application-level CORS policy, security-header middleware, or TLS setup is evident. Same-origin routing may be sufficient for CORS, but TLS and headers depend on the deployment edge and are unverified. | Document and verify HTTPS termination, security headers, allowed origins, and proxy behavior for the chosen host. |
| **Medium** | `README.md`; hosting/runbook configuration | Reservation cleanup is documented as a scheduled command, but no host scheduler is configured. Concrete backup/restore drills and `.tech` DNS/custom-domain steps were not found. | Before accepting real orders, configure cleanup scheduling, establish backups and a restore procedure, and verify DNS/TLS. |
| **Medium** | `src/db/*`, `drizzle/*`, existing database operations | The fresh baseline and `0006` path have reported disposable-database verification. No existing application database was inspected here; applying the migration to an existing database still requires schema/history review and a backup. | Treat existing-database migration as a separate reviewed operation; verify target and backup before applying. |

## Verified by execution or recorded PostgreSQL results

- **Production startup smoke test:** the package start script invoked `node server.js` under Node.js **v22.22.3**. With isolated dummy configuration, the server logged that it was running and `GET /` returned **HTTP 200**. The server was intentionally interrupted with Ctrl+C afterward; that interruption was not a startup failure.
- **Standard tests:** `bun test` exited **0** with **111 passed, 0 failed, 1 skipped**. The skipped suite is opt-in PostgreSQL testing; these results are not live-service tests.
- **Lint/type check:** `bun run lint` exited **0**.
- **Diff whitespace check:** `git diff --check` exited **0**. Git printed line-ending conversion warnings for existing modified files.
- **Previously reported disposable PostgreSQL verification:** the fresh baseline was reported to create 13 tables; `db:migrate` then recorded `0006_contact-inquiries` once without replaying `0000`–`0005`. A separate PostgreSQL integration run was reported as **19 passed, 0 failed, 0 skipped**, including contact inquiry persistence/owner inbox scenarios. PostgreSQL was not accessed or retested during this audit.
- No production database, Docker resource, Supabase service, Razorpay service, migration, seed, payment, or cleanup command was accessed or run during this audit.

## Static source findings

- `package.json` specifies Node `>=22.12.0 <23`, builds the Vite frontend and ESM server bundle, and starts it with `node server.js`. Production serves `dist`; the Vite development server is initialized only outside production.
- The fresh baseline journal is ordered after migrations `0000`–`0005` and before `0006_contact-inquiries`. The initializer retains explicit confirmation, target fingerprint, identity, collision, and remote-target safeguards.
- Contact submission validates fields, applies a per-process rate limit, inserts before returning `201`, and reports that the inquiry was saved without claiming email delivery. The inbox is behind authentication and owner authorization; errors avoid returning database details.
- Server authorization verifies Supabase tokens and requires a verified email in the server-side owner allowlist. Product administration is owner-protected, and public catalogue queries filter to published products.
- Cart visibility and recovery use owner-aware selection and merge safeguards. Checkout derives persisted prices server-side and uses order idempotency; inventory reservations are handled transactionally with expiry and cleanup safeguards.
- Razorpay code is configured for Test Mode, verifies signatures and captured payment details server-side, processes raw webhook bodies, deduplicates events, and routes exceptional captured payments to review rather than treating them as fulfillable. These are source findings and test evidence, not live Razorpay verification.
- `.env.example` distinguishes server-side credentials, and the README documents database, auth, Test Mode payment, contact, initialization, and cleanup configuration. No `.env` values were inspected or printed.
- The repository already had modified and untracked files before this audit. The audit made no source changes.

## Not verified

- Live Supabase login, callbacks, token verification, owner access, or storage.
- Razorpay Test Mode or live payment/webhook behavior.
- Real browser persistence, mobile rendering, or end-to-end checkout/contact flows.
- Startup against reachable PostgreSQL; the smoke test deliberately used dummy loopback settings.
- Any existing application database's schema/history, backups, or migration compatibility.
- Hosting-provider health checks, TLS/reverse proxy, scheduled cleanup, backups, restore, or `.tech` DNS setup.

## Commands and exit codes

| Command | Result |
|---|---|
| `bun run start` with isolated dummy settings | Server started; `GET /` returned **HTTP 200**; later Ctrl+C interruption returned exit **1** intentionally |
| `bun run lint` | **0** |
| `bun test` | **0** — 111 passed, 0 failed, 1 skipped |
| `git diff --check` | **0** — line-ending warnings only |
| `bun run build` | Not run during this audit; the latest prior report supplied by the user says it passed. |

## Staging decision

A focused code change is **not proven necessary before a limited staging deployment**, provided the hosting setup supplies and verifies TLS, correct proxy handling, secrets, database targeting, and scheduled reservation cleanup. The next useful task is a host-specific staging operations checklist and smoke test covering health/readiness, database connectivity, backup/restore, cleanup scheduling, and `.tech` DNS/TLS. Production readiness remains unverified.
 
