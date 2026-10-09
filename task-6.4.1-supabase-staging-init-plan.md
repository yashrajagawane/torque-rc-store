# Task 6.4.1 — Supabase Staging Database Initialization Plan

**Review type:** Read-only design review  
**Readiness:** Initialization path unresolved; do not run it against Supabase yet.

## Recommendation

Use a **separate, Supabase-aware, one-time staging initializer** for a newly created staging project. Keep the current generic PostgreSQL initializer unchanged, and make the new path fail closed unless the owner explicitly identifies the staging project and the database has no conflicting application schema or Drizzle migration history.

The new path should apply the existing baseline representing the application schema through `0005`, then use the existing Drizzle migration workflow to apply `0006_contact-inquiries` exactly once. Keep Drizzle as the single migration-history authority; do not mix in Supabase CLI migrations for this database unless the project deliberately adopts and reconciles that second migration system.

This is a design recommendation only. **No files were changed, and no database command or remote connection was run.**

## Repository findings

### Schema and migration layout

The Drizzle schema defines **13 application tables through `0005`**: brands, cart items, cart-merge operations, categories, inventory reservations, order items, orders, payment review cases, products, Razorpay webhook events, reviews, users, and wishlist. The `contact_inquiries` table is introduced afterward by `0006_contact-inquiries`.

The fresh baseline SQL creates those 13 tables, their indexes, constraints, and foreign keys. Its table statements are unqualified, so they depend on PostgreSQL's `search_path`; its foreign-key references explicitly name `public`. It does not create reference/demo rows, and it does not contain `CREATE`, `ALTER`, `DROP`, policies, grants, or data operations against Supabase's `auth` or `storage` schemas.

The baseline and normal migrations use different journals:

- `drizzle/fresh/meta/_journal.json` has one marker, `0000_application-baseline`, at timestamp `1791551917290`.
- The normal journal has migrations `0000` through `0006`. Migration `0005` is `1791546915228`; `0006_contact-inquiries` is `1791560527016`.
- The baseline timestamp is deliberately later than `0005` and earlier than `0006`.

The installed Drizzle ORM PostgreSQL migrator defaults to `drizzle.__drizzle_migrations`. It reads the latest recorded `created_at` and applies journal entries with later timestamps. The fresh initializer explicitly uses that same schema and table. Thus, when the history contains the baseline marker, the expected order is: skip `0000`–`0005`, apply `0006` once, and keep later migrations eligible by giving them later timestamps.

The Drizzle history is **not** Supabase CLI history. Supabase tracks its own migrations in `supabase_migrations.schema_migrations`; using Supabase CLI `db push` alongside the existing Drizzle workflow would introduce a second tracking system that must be reconciled. Supabase documents its own migration tracking and warns that history and schema must stay synchronized. [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)

### What the generic initializer considers “empty”

The initializer's emptiness query counts relations (`r`, `p`, `v`, `m`, `S`, `f`) in every namespace except `pg_catalog`, `information_schema`, and `pg_toast*`. It does not mean “no Fly RC Hobbies application tables”; it means no matching relations in the queried schemas.

Supabase projects include managed schemas and database relations. Therefore, the generic initializer will normally reject a Supabase database before it applies the baseline. That refusal is protective. **Do not loosen its relation check or reuse it unchanged for Supabase.**

The initializer also verifies database name and user against the values parsed from the same configured URL. Its fingerprint is `host:port/database`; it does not include an independently supplied Supabase project reference, expected database user, schema, or migration-history state. Those checks are useful safeguards, but by themselves they do not prove the target is the intended staging project.

### Main migrations and history table

The historical migrations are not a full empty-database chain:

- `0000_products-publication-status.sql` alters an existing `products` table.
- `0001` and `0002` create cart tables.
- `0003_checkout-orders.sql` alters existing `orders` and `order_items`.
- `0004` creates inventory reservations.
- `0005` creates payment/webhook review tables and alters orders.
- `0006` creates contact inquiries.

The normal Drizzle migration config selects the migration database through `MIGRATION_DATABASE_URL`, then `DATABASE_URL`, then discrete SQL settings. The migration history table is `drizzle.__drizzle_migrations`, with `id`, `hash`, and `created_at`. The Drizzle runner's timestamp selection considers the latest history timestamp, so a future initializer must inspect for **unexpected or inconsistent history before mutation**, rather than assuming the latest row is sufficient evidence.

## Supabase-specific implications

Supabase Auth uses the managed `auth` schema, while Storage maintains metadata in `storage`. Supabase advises treating Storage's schema as read-only and warns that changing ownership or assumptions in managed `auth`/`storage` objects can break platform services. [Auth architecture](https://supabase.com/docs/guides/auth/architecture), [Storage schema](https://supabase.com/docs/guides/storage/schema/design), [Supabase permissions](https://supabase.com/docs/guides/platform/permissions)

A database that is “empty for this application” can therefore still have platform schemas, relations, extensions, grants, and migration records. The current initializer cannot distinguish those from an application-created relation.

There is also a separate security issue to address before making staging available: application tables are created in `public`, and the baseline does not enable RLS or define policies. Supabase documents that `public` tables are reachable through its Data API and that SQL-created tables require deliberate RLS configuration. The current browser client uses Supabase Auth; catalog and business data are accessed through Express, so direct browser Data API access appears unnecessary. Before staging is exposed, either enable RLS with no browser-access policies for these tables, or explicitly remove `public` from Data API exposure after reviewing consequences. This should be a reviewed security migration/configuration decision—not an unreviewed initializer side effect. [Supabase tables and RLS](https://supabase.com/docs/guides/database/tables?database-method=sql&queryGroups=database-method&queryGroups=language)

## Initialization options

| Option | Compatibility | Safeguards and failure modes | Assessment |
|---|---|---|---|
| Reuse generic fresh initializer unchanged | Incompatible with a normal Supabase-managed database because its all-schema relation check will reject managed relations. | Safely stops before baseline execution; changing the guard to ignore relations broadly would weaken protection. | **Do not use.** |
| Add a separate Supabase-aware staging initializer | Fits the existing Drizzle baseline and history sequence while allowing known Supabase platform schemas to exist. | Must verify the project reference and exact target independently; inspect `public` and `drizzle`; fail on unknown/conflicting objects, schema, owner, or history; never modify managed schemas. | **Recommended**, after guard design is reviewed and tested against disposable PostgreSQL and a dedicated staging project. |
| Replace with Supabase CLI migrations or another baseline mechanism | Supported Supabase migration workflows exist, but the repository currently uses Drizzle and has no `supabase/migrations` history. Adopting CLI creates a second migration ledger and requires a carefully reviewed baseline/history bridge. | Risks duplicate history, replaying SQL, and disagreement between Drizzle and Supabase migration tracking. Supabase `migration repair` changes history only and must not be treated as proof the schema is correct. | Viable only as an intentional migration-system change; **not the smallest safe path** for this task. |

## Proposed guarded staging initializer

The recommended implementation should be a separate command and guard. It should not add a bypass option to `db:init:fresh`.

Before connecting, require explicit enablement and confirmation, plus independent expected-target configuration. Candidate variable names for review:

- `SUPABASE_STAGING_PROJECT_REF`: owner-provided staging project reference.
- `SUPABASE_STAGING_DATABASE_HOST`, `SUPABASE_STAGING_DATABASE_PORT`, `SUPABASE_STAGING_DATABASE_NAME`, `SUPABASE_STAGING_DATABASE_USER`: independently confirmed expected identity components.
- `SUPABASE_STAGING_SCHEMA`: expected application schema, explicitly `public` under the current code.
- `SUPABASE_STAGING_DATABASE_URL`: migration-only initialization connection with explicit credentials.
- A dedicated enable flag, confirmation value, and target fingerprint for the Supabase-specific initializer.
- `DATABASE_URL` and `DATABASE_SSL=true`: Vercel Preview runtime connection only.
- `MIGRATION_DATABASE_URL`: separately configured migration connection when applying normal migrations.

These are proposed names, not existing settings. Secrets should be set only in the appropriate local secret store or Vercel environment; never paste them into chat or reports.

The initializer should validate before opening a connection, then verify:

1. The expected project reference and exact host/port/database/user match the owner-approved Supabase Dashboard Connect settings.
2. The effective connected database/user and `current_schema()`/`search_path` match expected values. Ensure baseline table DDL resolves to `public`; the current SQL is not schema-qualified.
3. The `public` schema contains no Fly RC Hobbies application tables or conflicting objects from the baseline's expected object set.
4. The `drizzle` schema/history is absent. Any existing history, unexpected row, or timestamp inconsistency should stop the operation for manual reconciliation.
5. Other schemas are not altered. Known Supabase-owned schemas and their objects are left intact. Unknown ownership/object state should fail closed.
6. The baseline migration and normal migration target cannot fall back to application or Production credentials.
7. Backup/recovery expectations and staging project identity are recorded before the first schema mutation.

Project identity cannot safely be inferred from a generic pooler host alone. Supabase distinguishes direct, session-pooler, and transaction-pooler endpoints; pooler hosts and usernames differ, and the exact endpoint should be copied from the project's Connect dialog. The shared transaction pooler is designed for serverless workloads, does not support prepared statements or query pipelining, and its endpoint metadata may not expose the same host/port as the actual Postgres server. Therefore, compare the configured endpoint against independently confirmed project settings, and treat server-side `inet_server_port()` as an internal port—not the URL's pooler port. [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)

The app uses `drizzle-orm/node-postgres` with `pg`; it does not use `postgres.js`. The existing runtime pool is bounded to one connection per Vercel Function process and remote SSL defaults on. Supabase recommends SSL and documents transaction-pooler restrictions; the exact chosen endpoint/driver combination still needs staging validation. [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)

## Required migration order and expected history

For a genuinely new, independently verified staging project:

1. Preflight must find no conflicting application relations in `public` and no existing Drizzle history in `drizzle`.
2. Apply the immutable fresh baseline through Drizzle's fresh journal. It creates the 13 application tables through `0005` and records `0000_application-baseline` in `drizzle.__drizzle_migrations`.
3. Verify that the baseline marker exists once and has the expected timestamp; verify the expected baseline-owned schema objects.
4. Run the normal Drizzle migration command against the **same explicitly verified staging target**.
5. Verify that entries for `0000`–`0005` were not added/replayed; verify `0006_contact-inquiries` is recorded once and the table matches its migration/schema.
6. Verify all baseline tables remain intact and that future journal entries can run because their timestamps are later than the baseline and `0006`.

Do not insert migration-history rows manually just to make a command proceed. The baseline marker should be created by the reviewed baseline migrator. Do not use `supabase migration repair` to conceal a schema mismatch.

## Security, recovery, and plan notes

- Use a migration-only credential for schema changes and a least-privilege runtime credential for Vercel where practical. Do not assume the Supabase `postgres` role is appropriate for long-lived application traffic.
- The migration account needs privileges to create the `drizzle` schema/history and application objects in `public`; do not grant or alter ownership in managed schemas.
- Before mutation, take a staging-only backup or confirm the project is genuinely new and disposable. Never import Production customer, order, inventory, payment, or inquiry data.
- The Supabase plan is unknown. Current documentation says daily automated backups are available on Pro, Team, and Enterprise; Free projects should make regular CLI exports and maintain off-site backups. Database backups do not include Storage objects. [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- Test restoration into a separate disposable target and verify schema, migration history, application tables, and Storage-object handling.

## Likely source changes in a future implementation

No changes were made in this review. A future implementation would likely need:

- `src/db/supabase-staging-guard.ts`: Supabase-specific expected-project and schema/history checks, separate from the generic empty-database guard.
- `scripts/initialize-supabase-staging.ts`: Explicitly enabled one-time initialization using the existing baseline through Drizzle.
- Tests for target/project mismatch, direct and pooler endpoint identity, managed schemas, conflicting `public` tables, unexpected `drizzle` history, and no-connect behavior on invalid configuration.
- README updates documenting the separate command and manual staging verification.
- A reviewed follow-up security migration/configuration for `public` Data API/RLS behavior, if needed after security review.
- Potential migration config changes only if required to make the Drizzle history schema/table explicit and consistent; avoid altering history conventions casually.

## Safe future verification sequence

1. Owner creates and positively identifies a **dedicated new staging Supabase project**, distinct from Production, and records its project reference.
2. Owner copies the exact connection settings from that project's Supabase Connect dialog and confirms endpoint mode, database, user, and TLS settings. Do not derive or guess pooler hosts.
3. Independently inspect the target's schema and migration state read-only, with credentials held outside chat and logs. Confirm no application table conflicts or Drizzle history.
4. Confirm a staging-only backup/recovery route and the intended migration credential.
5. Review the new Supabase-specific guard and initializer, including behavior against platform-managed schemas, before approval to execute.
6. Run the initializer only against the verified staging target; capture sanitized results.
7. Run `bun run db:migrate` with `MIGRATION_DATABASE_URL` explicitly scoped to that same target. Verify baseline and `0006` history and schema.
8. Configure Vercel Preview runtime variables separately, using staging Auth keys, staging `DATABASE_URL`, Test Mode Razorpay credentials, and the staging owner account.
9. Run read-only readiness and staging API checks, then test browser Auth redirects and transaction-heavy checkout/reservation behavior against staging before any customer use.

## Blockers and owner inputs

The following are unknown and must be confirmed before implementation or execution:

- Dedicated staging project reference and proof it is separate from Production.
- Exact staging database endpoint mode and Connect settings.
- Whether the staging database is genuinely new and has no application schema or migration history.
- Intended Supabase plan and backup expectations.
- Whether Vercel runtime and migration credentials will be separate.
- Approval of how the app's `public` tables will be protected from direct Supabase Data API access.

## Official documentation consulted

- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres): direct/session/transaction endpoints, IPv4/IPv6, credentials, and transaction-pooler restrictions.
- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations): migration tracking, safe workflow, and history repair semantics.
- [Supabase Auth architecture](https://supabase.com/docs/guides/auth/architecture): Auth uses a managed database schema.
- [Supabase Storage schema](https://supabase.com/docs/guides/storage/schema/design): Storage metadata is in a managed schema and should be treated as read-only.
- [Supabase platform permissions](https://supabase.com/docs/guides/platform/permissions): managed Auth and Storage ownership expectations.
- [Supabase tables and RLS](https://supabase.com/docs/guides/database/tables?database-method=sql&queryGroups=database-method&queryGroups=language): public Data API exposure and RLS requirements for SQL-created tables.
- [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement): PostgreSQL SSL enforcement and certificate verification.
- [Supabase backups](https://supabase.com/docs/guides/platform/backups): plan-dependent backup availability, CLI exports for Free, and Storage exclusion.

**Recommended commit message for a later implementation:** `Add guarded Supabase staging database initialization`

**Read-only review complete. No repository files were modified, and no database connection, initialization, migration, seed, or external service operation was performed.**
