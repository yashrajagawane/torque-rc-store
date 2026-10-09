# RC MEGA / Fly RC Hobbies

React + TypeScript storefront with an Express API, PostgreSQL, and Drizzle ORM.
The backend supports either local PostgreSQL or a remote PostgreSQL provider such
as Supabase. Database credentials are server-side only.

## Requirements

- Node.js 22 LTS, version 22.12.0 or newer within major version 22 (see the `engines` field in `package.json`). Vite 8 and the bundled Express server use this runtime target.
- Bun (the repository includes `bun.lock`)
- A PostgreSQL database for the API, migrations, and seed scripts

## Local setup

1. Install dependencies using the committed lockfile:

   ```sh
   bun install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env` and set the local PostgreSQL host, port,
   database, user, and password. The example defaults to discrete `SQL_*`
   settings for local development. `DATABASE_URL`, when set, takes precedence.
3. Create an empty local database and a database user with the permissions needed
   by the application. Do not point initial setup commands at a production database.
4. Initialize a genuinely empty, verified local database with the guarded fresh
   database workflow below. Use the regular migration workflow for existing
   databases only after their schema and Drizzle history are verified.

5. Seed baseline reference rows, then add the optional sample catalog if desired:

   ```sh
   bun run db:seed:reference
   bun run db:seed:products
   bun run db:seed:parts
   ```

   These seed commands insert missing rows only. Existing rows with the same
   unique slug are preserved. The product seed scripts currently set
   `IN_STOCK` but omit `stock` and `is_published`; schema defaults leave those
   sample rows at zero stock and unpublished. They are not sellable demo stock.
   Do not invent stock counts or publish products automatically; set inventory
   and publication state deliberately through the owner UI.
6. Start the development server:

   ```sh
   bun run dev
   ```

`bun run lint` runs `tsc --noEmit`; `bun run build` builds the frontend and
production server bundle.

### Production build and start

Build both the Vite frontend and the Express server bundle with:

```sh
bun run build
```

The build writes the browser assets to `dist/` and the Node-compatible ESM
server bundle to `server.js`. Start the built application with:

```sh
NODE_ENV=production bun run start
```

The start script runs `node server.js`; it does not start Vite. Configure the
deployment host with Node.js 22.12 or newer in major version 22, install the
locked dependencies, build during deployment, and run the start command. Set
the required server-side environment variables described below and provide a
reachable PostgreSQL database. The development command remains `bun run dev`,
which runs the TypeScript source through `tsx` with Vite middleware.

## Supabase preparation

1. Create a Supabase project and copy its PostgreSQL connection string from the
   dashboard's **Connect** panel. Keep the string in the server's environment;
   do not prefix it with `VITE_` or put it in frontend source.
2. Set `DATABASE_URL` to that connection string and set `DATABASE_SSL=true`.
   The app verifies remote TLS certificates by default. If the provider's
   certificate chain requires a custom CA, configure the Node runtime trust store
   before deployment rather than disabling verification. The app strips SSL
   query parameters from the URL so `DATABASE_SSL` remains the single SSL policy.
3. Optionally set `MIGRATION_DATABASE_URL` to a separate migration connection
   with DDL permissions. If omitted, Drizzle Kit uses `DATABASE_URL`.
4. Configure the same server-side variables in local/staging/production secrets
   as appropriate. Do not commit `.env` or real credentials.

`DATABASE_SSL` accepts `auto`, `true`, or `false`. `auto` (the default) disables
SSL for `localhost`, `127.0.0.1`, and `::1`, and enables certificate-verified SSL
for other hosts. Use `false` only for local development or a deliberately
unencrypted trusted network.

## Customer authentication and owner access

Customer accounts use Supabase Auth. The browser and Express use the public
publishable/anon key; Express validates access tokens with Supabase. A
service-role/secret key is not needed and must never be added to frontend
environment variables.

Set these values in `.env` for local development and in the matching frontend
and server environment configuration for deployment:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser | Supabase project URL used by the Auth SDK. |
| `VITE_SUPABASE_ANON_KEY` | Browser | Public publishable/anon key, never a service-role key. |
| `SUPABASE_URL` | Express | Project URL used to verify access tokens. |
| `SUPABASE_ANON_KEY` | Express | Non-privileged key used for token verification. |
| `ADMIN_EMAILS` | Express only | Comma-separated owner email allowlist. Addresses are trimmed and lowercased; owner access also requires a verified email. |
| `SUPABASE_SERVICE_ROLE_KEY` | Express only | Supabase Storage upload credential. Never expose it to the browser. |
| `SUPABASE_STORAGE_BUCKET` | Express only | Name of the public bucket used for product images, e.g. `product-images`. |

Configure email confirmation and password recovery in Supabase Auth. Add local
and deployed site origins to the Auth URL allowlist, including `/auth/callback`
for signup confirmation and `/account/reset-password` for recovery. Supabase
configuration is optional during local startup: the frontend explains when it
is not configured, and protected API routes return service-unavailable responses
when server verification is not configured.

The account routes are `/register`, `/login`, `/forgot-password`, and `/account`.
Supabase persists and refreshes browser sessions; Express independently verifies
each protected API bearer token with Supabase. `GET /api/account/me` returns the
verified identity, and `GET /api/owner/test` demonstrates owner-only
authorization. Owner access comes only from the server-side `ADMIN_EMAILS`
allowlist plus Supabase's verified-email timestamp; frontend roles and the legacy
`users.is_admin` column are not used. Normal signup never grants owner access.
This task does not create local user rows or require a database migration.

Signed-in customer carts are stored in PostgreSQL through `/api/cart`. The cart
owner is the UUID from the verified Supabase access token; the API never accepts
a customer ID from the request body. Existing `users` profiles are not
automatically created at sign-up, so cart ownership intentionally uses Supabase
UUIDs directly and does not depend on a local profile row. Guest carts remain in
the browser's `rc-mega-cart` localStorage entry and are merged on sign-in. Cart
requests read current product price, publication state and stock from the
database; adding to a cart does not reserve or deduct inventory. Only published
products explicitly marked `IN_STOCK` with a positive integer stock quantity
can be added or updated. Guest merges carry a persisted UUID idempotency key;
the server stores the customer/key and canonical payload hash in the same
transaction as cart changes, making retries safe and rejecting key reuse with a
different payload. Apply the reviewed `0001_customer-cart.sql` and
`0002_cart-merge-idempotency.sql` migrations only after confirming the existing
catalog schema and migration history. They create the cart table, merge-operation
table, constraints, product reference and unique customer/product and
customer/request-key indexes. They have not been applied to any database.

Run middleware tests with `bun test` (or `bun run test`). They use an injected
token verifier and do not require Supabase credentials or a database. Live login,
email delivery, recovery links, and remote token verification require Supabase
credentials and dashboard email/redirect configuration.

The owner dashboard is available at `/admin`. The browser first checks the
server-verified account endpoint for owner status, and every admin API also
enforces the Supabase token and server-side owner allowlist. Product changes are
created as drafts; existing catalog rows remain published by the publication
migration's backfill. The API never deletes products.

For owner image uploads, create a public Supabase Storage bucket (default name
`product-images`) with image MIME restrictions. Set `SUPABASE_SERVICE_ROLE_KEY`
and `SUPABASE_STORAGE_BUCKET` only in the Express server environment. The bucket
must be public so the storefront can render its returned image URLs; writes still
go through the owner-protected server endpoint. Uploads accept JPEG, PNG, WebP,
and AVIF up to 8 MiB. Do not put the service-role/secret key in any `VITE_*`
variable or client bundle.

## Checkout and orders

Signed-in customers can check out from `/checkout`. Delivery details are
validated by the Express API, and checkout prices and totals are recalculated
from current PostgreSQL products. The API requires a UUID `Idempotency-Key`,
scoped to the verified Supabase customer, and stores the order key, canonical
request hash, order, immutable product-name/slug/unit-price/quantity snapshots,
and inventory reservations in one transaction. On a confirmed order commit,
the exact saved cart is removed in that transaction. Physical product stock is
not decremented at checkout; available stock is physical stock minus active,
unexpired reservations.

Each unpaid order reserves its line quantities for 20 minutes. Reservation
creation locks product rows in ID order and checks active reservation totals in
a separate statement after those locks, so competing checkouts serialize on the
same inventory rows. A failed reservation rolls back the order, idempotency
claim, order items and cart removal together. Cancellation releases only ACTIVE
reservations in the same transaction as the order transition; repeats do not
restore stock twice. Expiration makes the reserved units available as soon as
`expires_at` passes. An owner-protected `POST /api/admin/orders/reservations/expire`
maintenance endpoint marks expired reservations and associated unpaid orders
terminal. For production scheduling, invoke the private server-side CLI command
`bun run db:reservations:expire -- --confirm-cleanup` from the hosting platform's
scheduled-job/worker facility every 1–5 minutes. The command requires both the
`--confirm-cleanup` flag and the exact server-side setting
`RESERVATION_CLEANUP_ENABLED=true`; otherwise it exits before importing the
database module or creating a connection pool. Configure the opt-in only in the
explicitly configured scheduler environment, and keep database credentials in
that platform's secret environment. The command loads the same server-side
`DATABASE_URL` or `SQL_*` settings as the Express runtime, runs the existing
cleanup function in a transaction, closes the pool and exits nonzero on failure
without logging credentials. Configure the chosen platform's scheduler only
after choosing a host; do not call the owner API from a public unauthenticated
scheduler. The owner-protected HTTP maintenance route remains available for
authorized operations and is unchanged.
Product cards, detail/cart APIs, cart writes and checkout preview report stock
after active reservations. Admin stock edits cannot lower physical stock below
currently active reservations.

Checkout creates `PENDING` / `UNPAID` orders and reserves stock for 20 minutes.
Razorpay Test Mode payment orders can be created only for the authenticated
customer's eligible internal order. The amount comes from the saved order total;
the server stores the Razorpay order ID and reuses it on retries. Ambiguous API
timeouts remain locked for manual reconciliation so a retry cannot create a
second provider order blindly.

Razorpay Checkout's browser callback is only a request to verify. The Express
server checks the callback HMAC using the stored Razorpay order ID, fetches the
payment from Razorpay and requires a captured payment with the exact amount and
INR currency. Only then does one transaction consume the reservation and mark
the order paid. The webhook endpoint is registered before JSON parsing, verifies
the exact raw request body, and deduplicates provider event IDs. Failed and
out-of-order events cannot downgrade a paid order. A captured payment whose
reservation expired or no longer matches is stored in owner-visible payment
review cases; it is not marked paid or fulfilled. Refunds are not automated:
the owner must reconcile the payment in Razorpay and arrange any required refund
manually. Mocked tests do not verify real Razorpay Test Mode, browser Checkout,
PostgreSQL transaction rollback, or webhook delivery.

### Opt-in PostgreSQL integration tests

By default, `bun test` remains database-free because the PostgreSQL suite is
skipped without explicit opt-in. Critical checkout/payment integration
scenarios are also available separately with `bun run test:postgres`.
They run only when `RUN_POSTGRES_INTEGRATION_TESTS=true`, a dedicated
`TEST_DATABASE_URL` points to a database whose name includes a clear `test`
segment (for example, `rcmega_test`), and
`POSTGRES_TEST_DATABASE_CONFIRMATION=I_CONFIRM_DISPOSABLE_TEST_DATABASE` is
set. The URL must include an explicit, non-empty username and password. The
test pool receives those parsed credentials directly; it does not use
`PGUSER`, `PGPASSWORD`, or application database credentials as a fallback.
The guard compares normalized host, port, and database name against every
configured `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and discrete `SQL_HOST`,
`SQL_PORT`, `SQL_DB_NAME` target. URL schemes, credentials, and SSL parameters
do not affect this comparison. Malformed or partial configured targets fail
closed; no application or migration credentials are used as a fallback.
`TEST_DATABASE_SSL` accepts `auto`, `true`, or `false` and defaults to `auto`.

Remote test databases are rejected by default. To opt into a remote disposable
database, also set `ALLOW_REMOTE_TEST_DATABASE=true` and
`TEST_DATABASE_EXPECTED_FINGERPRINT` to the exact normalized target
`host:port/database` (IPv6 uses `[address]:port/database`). Independently verify
the connection host and database name in the provider's database console or
with a read-only `SELECT current_database(), inet_server_addr(),
inet_server_port()` connection made by an administrator. Compare that result
with the connection details and fingerprint before enabling the remote opt-in.
Do not use a production or shared database, even if its name contains `test`.

The Drizzle migrations `0000` through `0005` are incremental changes, not a
fresh-database baseline: `0000` and `0003` alter pre-existing catalog/order
tables. Do not apply them to an empty database. For a genuinely empty,
disposable integration-test database, use the test-only
`tests/fixtures/postgres-integration-bootstrap.sql`. It defines the schema
needed by the integration suite from the current Drizzle schema and migrations
through `0005`; it is deliberately outside `drizzle/` and is not production
migration history or a replacement for a reviewed production baseline. Do not
run Drizzle migrations after this bootstrap. The bootstrap inserts no product,
customer, category, brand, or order reference data; test cases create their own
fixtures. It includes empty `users`, `categories`, and `brands` tables to
preserve the schema's foreign-key relationships.

For an existing database, first independently establish that it is a separate,
disposable test target and compare its schema to the bootstrap. Do not bootstrap
over existing objects/data and do not assume migrations `0000` through `0005`
can bring an arbitrary existing schema to the right state. Reconcile or recreate
only a disposable database after reviewing its contents. The test command never
creates a database, applies migrations, truncates tables, or resets data. It
checks for required tables before inserting fixtures. Each scenario uses unique
fixture identifiers and removes only its own fixture records. Never use a
shared, staging, or production database. The database name and confirmation are
safeguards, not proof that a target is disposable.

Example local Docker setup (commands are instructions; inspect the named
container before any removal):

```powershell
docker run --name rcmega-postgres-test `
  --env POSTGRES_USER=rcmega_test `
  --env POSTGRES_PASSWORD=REPLACE_WITH_A_NEW_DISPOSABLE_PASSWORD `
  --env POSTGRES_DB=rcmega_test `
  --publish 127.0.0.1:55432:5432 `
  --detach postgres:16

# Bootstrap only this newly created, empty disposable database. psql prompts
# for the disposable password; do not use a production or application password.
psql -h 127.0.0.1 -p 55432 -U rcmega_test -d rcmega_test -W `
  -v ON_ERROR_STOP=1 `
  -f tests/fixtures/postgres-integration-bootstrap.sql

# Independently verify the actual server target and login identity.
psql -h 127.0.0.1 -p 55432 -U rcmega_test -d rcmega_test -W `
  -c "SELECT current_database(), inet_server_addr(), inet_server_port(), current_user;"
```

Confirm the result is the intended local database (`rcmega_test`, port `55432`,
the expected loopback server address, and user `rcmega_test`). Compare the
normalized host, port, and database name to every configured application and
migration target before enabling tests. Keep the test database distinct from
`DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `SQL_HOST`/`SQL_PORT`/`SQL_DB_NAME`.
The local Docker port is bound to loopback (`127.0.0.1`) rather than all network
interfaces.

Set the required test variables in a dedicated test shell (and both additional
remote variables only when necessary; do not place live or production
credentials in a test environment), then run `bun run test:postgres`. For this
local example, set `TEST_DATABASE_URL` to
`postgresql://rcmega_test:<URL-ENCODED-DISPOSABLE-PASSWORD>@127.0.0.1:55432/rcmega_test`,
`RUN_POSTGRES_INTEGRATION_TESTS=true`,
`POSTGRES_TEST_DATABASE_CONFIRMATION=I_CONFIRM_DISPOSABLE_TEST_DATABASE`, and
`TEST_DATABASE_SSL=false`. The username and password in the URL must both be
explicit and non-empty. Do not use `PGUSER`/`PGPASSWORD` as substitutes. Leave
remote-target settings unset for local testing. Run the independent target query
above before running the test command.

After testing, independently confirm that `rcmega-postgres-test` is the
disposable test container, then remove only that container and its attached
anonymous volume:

```powershell
docker stop rcmega-postgres-test
docker rm --volumes rcmega-postgres-test
```

Do not use broad Docker prune commands for cleanup. The suite uses mocked
Razorpay API responses and signatures but real PostgreSQL transactions and
concurrent HTTP requests. It covers last-unit
checkout contention, payment verification racing with webhook settlement,
duplicate webhook delivery, reservation expiry, and rollback on failed stock
consumption. A successful run is evidence for that prepared test database and
PostgreSQL version only; it is not live Razorpay, production-database, or
browser Checkout validation.

Configure only Razorpay **Test Mode** credentials: `RAZORPAY_KEY_ID` must begin
with `rzp_test_`, and `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` remain
server-only. The public Key ID is returned to the browser for Checkout; neither
secret is sent to the frontend or included in logs. In the Razorpay Test Mode
dashboard, register the public staging HTTPS URL (or a secure webhook tunnel)
ending in `/api/payments/razorpay/webhook`, configure the same webhook secret in
the server environment, and subscribe to `payment.captured` and `payment.failed`.
For local/staging testing, create Test Mode keys and a webhook secret in the
dashboard, set the three variables in the server environment, start the app,
create an order, and pay through Razorpay's test checkout instruments. Confirm
the account order becomes paid only after the server reports verification.
Never put credentials in `VITE_*` variables. Do not switch to live keys in this
task or use live payments.

Customers view their own orders in `/account`; the owner can view all order
details and update allowed fulfillment transitions at `/admin/orders`. Both
order APIs use the Supabase bearer-token middleware, and every owner API uses
the server-side verified-email allowlist. Existing order rows keep their legacy
integer `user_id`; new orders use `customer_auth_id` (verified Supabase UUID).
No legacy customer ownership is inferred or backfilled. The migration backfills
old item name/slug snapshots from the current product catalog where possible;
that cannot reconstruct historical names as they were at original purchase.

Set optional `SHIPPING_FLAT_RATE_INR` in the Express environment to a non-negative
INR amount with up to two decimal places. Unset or `0.00` means free shipping.

Migration `0003_checkout-orders.sql` is additive and has not been applied. It
preserves old order and item rows, adds UUID ownership/idempotency and subtotal,
shipping, currency, and fulfillment fields, and adds item name/slug snapshots.
It assumes the existing `orders`, `order_items`, and `products` tables already
exist. The separate fresh-database baseline already represents the current
schema through `0005`; do not replay this legacy migration after initializing
with that baseline. For an existing database, reconcile schema and migration
history against a backup/staging copy before applying anything. Historic orders
remain visible to the owner; linking them to customer accounts requires a
separately verified mapping, not an inferred migration.

Migration `0004_inventory-reservations.sql` adds a separate reservation table
and constraints/indexes; it does not rewrite product quantities, carts or
existing orders. Existing unpaid orders receive no reservation because their
current payment status or age cannot safely establish inventory ownership. Before
deploying a future payment flow, reconcile any legacy unpaid orders and confirm
that the existing database includes `orders` and `products`. The fresh
application baseline already includes reservations and payment tables through
`0005`; do not replay `0004` on a fresh-baseline database. Review and test
existing-database migrations against a backup/staging copy before applying
anywhere.

Migration `0005_razorpay-test-payments.sql` adds nullable Razorpay IDs and a
creation-state field to orders, plus webhook-event deduplication and owner-visible
payment-review tables. It is additive and does not change existing order/payment
statuses or backfill gateway IDs. Review it only after reconciling the Drizzle
baseline; do not apply it to production without a reviewed backup/staging run.

## Database environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | One of this or all `SQL_*` runtime values | Preferred PostgreSQL URL for the Express runtime; also used by migrations unless a separate migration URL is set. |
| `MIGRATION_DATABASE_URL` | Optional | Separate PostgreSQL URL for Drizzle Kit migrations; takes precedence over `DATABASE_URL` for migrations only. |
| `DATABASE_SSL` | Optional | `auto`, `true`, or `false`; remote hosts use SSL in `auto` mode. |
| `SQL_HOST` | Required if no `DATABASE_URL` | PostgreSQL host. |
| `SQL_PORT` | Optional | PostgreSQL port; defaults to `5432`. |
| `SQL_DB_NAME` | Required if no `DATABASE_URL` | PostgreSQL database name. |
| `SQL_USER` | Required if no `DATABASE_URL` | Runtime PostgreSQL user. |
| `SQL_PASSWORD` | Required if no `DATABASE_URL` | Runtime PostgreSQL password. |
| `SQL_ADMIN_USER` | Optional legacy migration setting | Migration user when using discrete `SQL_*` settings. Must be paired with `SQL_ADMIN_PASSWORD`. |
| `SQL_ADMIN_PASSWORD` | Optional legacy migration setting | Migration password when using discrete `SQL_*` settings. Prefer `MIGRATION_DATABASE_URL` for a separate role. |
| `FRESH_DATABASE_URL` | Required only for fresh initialization | Dedicated target with explicit credentials; never falls back to app or migration credentials. |
| `FRESH_DATABASE_EXPECTED_FINGERPRINT` | Required only for fresh initialization | Exact normalized `host:port/database` target identity. |
| `FRESH_DATABASE_ENABLED` | Required only for fresh initialization | Must equal `true`, together with the exact confirmation value and explicit CLI flag. |
| `FRESH_DATABASE_CONFIRMATION` | Required only for fresh initialization | Must equal `I_CONFIRM_EMPTY_NONPRODUCTION_DATABASE`. |
| `FRESH_DATABASE_SSL` | Optional | `auto`, `true`, or `false`; remote targets use SSL in `auto` mode. |
| `ALLOW_REMOTE_FRESH_DATABASE` | Optional | Must equal `true` plus a matching fingerprint to allow a remote staging target. |
| `PORT` | Optional | Express listening port; defaults to `3000`. |
| `SHIPPING_FLAT_RATE_INR` | Optional | Express checkout shipping charge in INR; defaults to `0.00` (free shipping). |
| `RAZORPAY_KEY_ID` | Required for Test Mode checkout | Test Mode public key ID; must use the `rzp_test_` prefix. Never use a live key in this task. |
| `RAZORPAY_KEY_SECRET` | Required for Test Mode checkout | Server-only Test Mode API secret; never expose it to browser code. |
| `RAZORPAY_WEBHOOK_SECRET` | Required for webhooks | Server-only secret configured on the matching Razorpay Test Mode webhook. |
| `NODE_ENV` | Optional | Set to `production` to serve the built `dist/` frontend; otherwise the server uses Vite development middleware. |
| `DISABLE_HMR` | Optional | Set to `true` to disable Vite HMR/file watching in environments where that is needed. |
| `GEMINI_API_KEY`, `APP_URL` | Optional platform values | Retained for AI Studio deployment compatibility; not used by current storefront source code. |

`DATABASE_URL` takes precedence over discrete `SQL_*` settings for runtime
connections. For migrations, precedence is `MIGRATION_DATABASE_URL`, then
`DATABASE_URL`, then discrete SQL settings (with paired `SQL_ADMIN_*` values
overriding the runtime user/password).

## Drizzle migration workflow

- Change `src/db/schema.ts`.
- Generate a migration: `bun run db:generate`.
- Review the generated SQL and snapshot files under `drizzle/` and commit them.
- Check migration consistency: `bun run db:check`.
- Apply pending migrations only to an explicitly selected database:
  `bun run db:migrate`.

For a **new empty database**, use the separate full application baseline and
guarded initializer described below. Do not apply the legacy incremental
`0000`–`0005` migrations directly to an empty database.

The checked-in `0000_products-publication-status.sql` is a targeted migration for
the existing catalog schema, not a fresh-database baseline. Review it and confirm
the target already has the current `products` table and does not already have
`is_published` before applying it. Adding the column with `DEFAULT true` marks
all existing products as published; changing the default to `false` means future
rows start as drafts. This migration has not been applied to any database.

For an **existing database with data**, do not apply a newly generated initial
migration blindly. First compare the live schema to `src/db/schema.ts`, prepare a
baseline that matches the existing database, and test the migration plan against
a backup/staging copy. The fresh-database baseline is not a baseline for an
existing database, and the repository does not establish the applied migration
history of any external database. No migration is run automatically on app
startup.

The migration command can modify the database selected by its environment
variables. Verify the target and credentials before every `db:migrate` invocation.

### Fresh application database initialization

The `drizzle/0000`–`0005` files remain the legacy incremental history. They alter
tables that must already exist; they are not a fresh database initializer. The
full baseline is generated from `src/db/schema.ts` into `drizzle/fresh/`. It
contains the complete application schema and no sample rows or credentials.
The integration-test bootstrap in `tests/fixtures/` remains a smaller test-only
schema and is not used by this workflow.

Generate and review the baseline once for this schema version (file generation
only; this does not connect to PostgreSQL):

```sh
bun run db:baseline:generate
bun run db:check
```

After committing and using this baseline, keep it immutable. Do not regenerate
it for routine schema changes; generate those as new entries in the normal
`drizzle/` migration history with `bun run db:generate`. The initializer accepts
only the single reviewed baseline entry and fails before creating a database
pool if its journal is changed.

Create a new, empty, non-production database separately. Configure a dedicated
`FRESH_DATABASE_URL` with explicit credentials and its exact normalized target
fingerprint. The target must differ from all configured application and
migration database targets. The initializer rejects non-empty databases and
requires an environment opt-in, an explicit confirmation value, and a command
flag. Remote targets are denied by default. A remote staging target additionally
requires `ALLOW_REMOTE_FRESH_DATABASE=true` and an independently checked
fingerprint. Confirmation and fingerprints are safeguards, not proof that a
database is disposable.

Example local PowerShell setup for a database created separately on loopback
port `55432` (replace placeholders locally; never commit credentials):

```powershell
$env:FRESH_DATABASE_URL = 'postgresql://fresh_user:<URL-ENCODED-PASSWORD>@127.0.0.1:55432/rcmega_fresh'
$env:FRESH_DATABASE_EXPECTED_FINGERPRINT = 'localhost:55432/rcmega_fresh'
$env:FRESH_DATABASE_ENABLED = 'true'
$env:FRESH_DATABASE_CONFIRMATION = 'I_CONFIRM_EMPTY_NONPRODUCTION_DATABASE'
$env:FRESH_DATABASE_SSL = 'false'
bun run db:init:fresh -- --confirm-empty-database
```

The command validates URL syntax, explicit credentials, fingerprint and
collisions before opening a connection. It then verifies the connected database
name and user, and confirms there are no user relations before applying the
baseline. The fingerprint verifies the client connection host, port and database
before connecting. The initializer does not compare `inet_server_port()` with
the URL port: with a Docker mapping such as `127.0.0.1:55433:5432`, the host
connection uses port `55433` while PostgreSQL correctly reports its internal
port `5432`. It uses only `FRESH_DATABASE_URL`; there is no fallback to
`DATABASE_URL`, `MIGRATION_DATABASE_URL` or `SQL_*` credentials. The baseline is
recorded through Drizzle's normal migrator in the same
`drizzle.__drizzle_migrations` table. The installed PostgreSQL migrator compares
the latest recorded migration timestamp with journal entries. The fresh
baseline timestamp is later than legacy `0005`, so the regular migration
workflow skips `0000`–`0005` on a freshly initialized database and applies only
subsequent migrations. Existing migration files and journal entries are not
changed. New migrations must have a later timestamp; verify this with
`bun run db:check` and a disposable PostgreSQL proof-of-concept before adoption.

After initialization, configure the runtime to use that database deliberately;
apply later reviewed migrations with `bun run db:migrate`. Never run the fresh
initializer against an existing database. For an existing database, inspect
and back it up, compare its schema and migration history, then use only the
verified legacy migration path. Documentation alone is not evidence that a
production database is safe to baseline.

Reference rows are optional for schema creation. Local sample products depend
on the reference-data seed creating expected brand and category slugs. Seeds
are separate from initialization and do not replace matching rows. Do not run
sample product seeds automatically in staging; they currently remain drafts
with zero stock despite their `IN_STOCK` availability field.

## Safe catalog scripts

- `bun run db:seed:reference` inserts missing brand and category rows by slug.
- `bun run db:seed:products` inserts missing sample products and preserves
  existing products with matching slugs.
- `bun run db:seed:parts` inserts the spare-parts/accessories categories and
  missing sample products while preserving existing product rows.
- Image maintenance scripts are **dry-run by default**. To intentionally
  overwrite product image fields, use:

  ```sh
  bun run db:images:update -- --apply
  bun run db:images:distribute -- --apply
  ```

These image scripts overwrite image fields for mapped products or products in
the catalog. Review the source and confirm the target database before using
`--apply`. Seed scripts are intended for local or staging initialization, not as
a way to update a live catalog.

## Current feature boundary

The app has public catalog read APIs, Supabase customer authentication, a
protected customer account endpoint, server-side owner authorization, and an
owner product dashboard with draft/publish controls. Checkout, order management,
payments, and persisted contact submissions are not implemented.
