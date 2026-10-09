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
and AVIF up to 4 MiB so the raw request remains below Vercel Functions' 4.5 MB
request-body limit. The admin page rejects larger files before upload. Do not
put the service-role/secret key in any `VITE_*` variable or client bundle.

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
through `0006`; it is deliberately outside `drizzle/` and is not production
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
checked-in `drizzle/fresh/0000_application-baseline.sql` is the immutable fresh
baseline as of the schema through `0005`. It deliberately does not include later
tables such as `contact_inquiries`, which are created by forward migrations.
The test-only bootstrap in `tests/fixtures/` is separate and includes the schema
through `0006`; it is never used by the fresh initializer or production migration
history.

For a fresh database, run the guarded initializer to apply the baseline, then
run `bun run db:migrate` against that same explicitly verified database. The
normal workflow skips `0000`–`0005` using the baseline timestamp and applies
later forward migrations, including `0006_contact-inquiries`. Keep the baseline
SQL, snapshot, and one-entry journal immutable. Routine schema changes must be
new entries in the normal `drizzle/` migration history using
`bun run db:generate`; do not regenerate or replace the fresh baseline for an
ordinary feature migration. The initializer requires exactly its reviewed
single baseline journal entry and fails closed if that journal changes.

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
apply later reviewed migrations with `bun run db:migrate`. The baseline represents
the schema through legacy migration `0005`; run the normal migration workflow
after initialization to apply forward migrations such as `0006_contact-inquiries`.
Never run the fresh
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
owner dashboard for products, orders, payment-review cases, and saved contact
inquiries. Contact submissions are stored in PostgreSQL and visible only through
the owner-protected inbox. No automatic email confirmation or reply is sent.
Checkout and Test Mode payment flows are implemented; live payment processing is
not enabled.

### Contact inquiries

The public contact form saves validated submissions to `contact_inquiries` via
`POST /api/contact-inquiries`. The owner inbox is available at `/admin/inquiries`
and its API requires a verified Supabase owner session. A successful form
confirmation means the database insert completed; it does not mean an email was
sent. Submissions are rate-limited in process by the Express instance. This
limiter resets when the process restarts and is not shared across multiple app
instances; deployments with multiple instances should add a shared rate limiter
before exposing the form broadly. Establish an appropriate retention policy for
the personal contact data stored with inquiries.

## Vercel staging deployment

The app supports Vercel's Express Function model through the exported Express application in `server.ts`. Vercel invokes the app as a Function; it does not start the standalone `node server.js` listener. The ordinary `bun run build` and `bun run start` workflow remains available for standalone Node hosting. Vercel uses `bun run build:vercel`, which builds the Vite frontend and copies its output into the generated `public/` directory without producing the standalone `server.js` bundle. This leaves `server.ts` as the single Express Function entry point. Vercel serves `public/` files from its static delivery layer; Express's `express.static()` is disabled in the Vercel runtime. The Express catch-all returns the included `public/index.html` for client-side routes. API routes remain in Express, and the Razorpay webhook raw-body parser remains registered before `express.json()`.

Use a dedicated Vercel staging project or explicitly approved Preview deployment. Configure Preview variables separately in Vercel; do not copy Production values. Use the Vercel-provided preview hostname and leave the `.tech` DNS and production domain untouched. Verify HTTPS, certificate validity, HTTP-to-HTTPS behavior, SPA refreshes, API calls, and Supabase Auth redirect allowlists on the actual preview hostname. The staging frontend and API are same-origin.

| Variable | Scope | Staging purpose |
| --- | --- | --- |
| `DATABASE_URL` | Server only | Dedicated staging Supabase PostgreSQL URL, never Production. |
| `DATABASE_SSL` | Server only | Set `true` for remote Supabase connections. |
| `VITE_SUPABASE_URL` | Browser bundle | Staging Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Browser bundle | Staging publishable/anon key only. |
| `SUPABASE_URL` | Server only | Same staging project for token verification and Storage. |
| `SUPABASE_ANON_KEY` | Server only | Non-privileged key for server Auth verification. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Optional Storage upload key; never use a `VITE_` prefix. |
| `SUPABASE_STORAGE_BUCKET` | Server only | Public image bucket configured in the staging project. |
| `ADMIN_EMAILS` | Server only | Verified staging owner account email(s). |
| `RAZORPAY_KEY_ID` | Checkout/public key response | Test Mode key only; must begin `rzp_test_`. |
| `RAZORPAY_KEY_SECRET` | Server only | Razorpay Test Mode API secret. |
| `RAZORPAY_WEBHOOK_SECRET` | Server only | Secret configured for the matching Test Mode webhook. |
| `SHIPPING_FLAT_RATE_INR` | Server only | Optional staging shipping price. |
| `CRON_SECRET` | Server only | Independent random secret of at least 32 characters for scheduled cleanup. |

`PORT`, `NODE_ENV`, and `VERCEL` are runtime/platform values. Do not add database, service-role, Razorpay, webhook, or cron secrets to Vite variables. `.env.example` contains placeholders only.

### Vercel database connection considerations

The app uses Drizzle with `drizzle-orm/node-postgres` and `pg` (`Pool`), not `postgres.js`. Checkout, settlement, reservation, and rollback paths use explicit transactions and row locks. Supabase documents a `postgres.js` query-pipelining incompatibility with shared transaction pooling; that specific warning does not apply to this adapter. The Vercel runtime pool is bounded to one connection per warm Function instance, with a 5-second connection timeout; standalone Node retains a pool size of 10. Remote SSL defaults on; set `DATABASE_SSL=true` in Preview.

Copy the connection settings from the dedicated staging project's Supabase Connect dialog. Supabase's shared transaction pooler is IPv4 reachable and uses port 6543; direct Free-plan connections may be IPv6-only. Use the exact dashboard endpoint, do not guess it. Verify transaction and row-lock scenarios against the staging project before relying on its pooler semantics. Keep migration DDL credentials separate from runtime credentials where practical, and never configure Production URLs in Preview.

### Staging database initialization gate

No Supabase project was connected or migrated as part of this setup. The fresh initializer counts relations outside PostgreSQL system schemas; a managed Supabase project contains platform-managed relations and will normally be rejected as non-empty. Do not bypass that guard. Legacy migrations `0000`–`0005` assume the original application tables already exist and are not a blank-database chain. Before initializing Supabase staging, independently verify its project reference and database identity, inspect `public` and `drizzle` for application objects/history, and approve a Supabase-compatible baseline path. If the initializer rejects managed objects, stop and prepare a reviewed Supabase-aware initializer that checks conflicting application tables/history without changing managed schemas. Do not apply migrations until this prerequisite is resolved. Never import Production customer, order, inventory, or inquiry data into staging.

After the target is verified and the appropriate baseline is approved, migrate only that staging target and inspect the schema/history. Expected history is a baseline through `0005`, followed by `0006_contact-inquiries` exactly once. Do not rerun migrations to force a partial result to pass.

#### Guarded Supabase staging commands

`bun run db:init:fresh` remains the generic initializer for a relation-empty, verified non-production PostgreSQL database. It has not been changed to ignore Supabase platform relations. The Supabase-specific commands use a separate guard and must only target a newly created, dedicated staging project after its project reference and connection details have been independently checked in the Supabase Dashboard. These commands are not approved for Production.

Before using either command, obtain the exact host, port, database, and username from the dedicated staging project's **Connect** dialog. Do not construct a pooler hostname from its region. The direct host embeds the project reference; the shared pooler hostname is shared across projects, so the shared-pooler username must carry the expected staging project reference. A URL fingerprint is a mistake-prevention safeguard, not proof that a project is disposable. Never put credentials in source files, `.env.example`, chat, or logs.

Required environment names:

| Variable | Purpose |
|---|---|
| `SUPABASE_STAGING_ENABLED` | Explicit opt-in; exact value `true`. |
| `SUPABASE_STAGING_PROJECT_REF` | Owner-verified staging project reference. |
| `SUPABASE_PRODUCTION_PROJECT_REF` | Owner-verified Production project reference; must differ from staging. |
| `SUPABASE_STAGING_DATABASE_URL` | Explicit staging-only migration URL with username/password and SSL required. |
| `SUPABASE_STAGING_DATABASE_HOST` | Exact host copied from the staging Connect dialog. |
| `SUPABASE_STAGING_DATABASE_PORT` | Exact port copied from that connection mode. |
| `SUPABASE_STAGING_DATABASE_NAME` | Expected connected database name. |
| `SUPABASE_STAGING_DATABASE_USER` | Expected connected role; shared-pooler usernames include the project reference. |
| `SUPABASE_STAGING_DATABASE_EFFECTIVE_USER` | Expected PostgreSQL `current_user` after connection; set independently because a shared-pooler login name may differ from the database role. |
| `SUPABASE_STAGING_SCHEMA` | Must be `public` for the current unqualified baseline SQL. |
| `SUPABASE_STAGING_TARGET_FINGERPRINT` | Exact normalized `host:port/database/user` confirmation value. |
| `SUPABASE_STAGING_INITIALIZATION_CONFIRMATION` | Must equal `I_CONFIRM_NEW_SUPABASE_STAGING_SCHEMA` for baseline initialization. |
| `SUPABASE_STAGING_MIGRATION_CONFIRMATION` | Must equal `I_CONFIRM_SUPABASE_STAGING_MIGRATION` for forward migrations. |

Do not set generic `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `FRESH_DATABASE_URL`, or discrete `SQL_*` settings to the same target when invoking these commands. The staging scripts use only `SUPABASE_STAGING_DATABASE_URL` and fail on configured target collisions or uncomparable targets. Each command validates target identity again. The PostgreSQL server's internal port is not compared to the host/pooler URL port. The connection explicitly starts with `search_path=public` and verifies `current_schema()` and the effective path before schema operations.

For a new, verified staging project, the intended order is:

1. `bun run db:init:supabase-staging -- --confirm-staging-initialize` applies the immutable fresh baseline through `0005`, then verifies the baseline history marker and application objects.
2. `bun run db:migrate:supabase-staging -- --confirm-staging-migrate` validates the baseline and any known forward-history prefix, then applies pending migrations using Drizzle's normal `drizzle.__drizzle_migrations` history table. The current expected next migration is `0006_contact-inquiries`, once. Later migrations must retain timestamps later than their predecessors.
3. Independently verify the schema and history before configuring the Vercel Preview runtime.

The scripts reject conflicting `public` objects, any existing Drizzle schema/history at baseline initialization, inconsistent Drizzle records, and a present `supabase_migrations` schema. Any such target requires manual review; do not retry after a partial failure or repair history by manually inserting rows. The initializer only reads catalog information before applying the baseline, and its baseline SQL does not modify Supabase-managed schemas. Platform extension-owned objects in `public` are allowed; other non-extension objects fail closed. Do not run Supabase CLI `db push` against this application database: Drizzle is the current migration authority, and Supabase CLI maintains a separate history table.

These safeguards do not establish a target as safe by themselves. Before the first hosted schema mutation, independently confirm the project reference in the Dashboard, verify that it is distinct from Production, inspect the application schema/history read-only, establish a staging-only backup/recovery path, and have a second reviewer verify the target. If a command fails after connection or leaves migration metadata, stop for manual inspection; do not rerun until the actual schema and history are reconciled.

The staging runner's real PostgreSQL operations can be exercised locally without
using the Supabase CLI guard. This is a separate, opt-in test-only injection and
is not available through either staging command. It accepts only a dedicated
database named `rcmega_staging_runner_test` on `127.0.0.1:55434`, requires an
explicit disposable-database confirmation, and refuses configured application
target collisions. Create a new disposable local database; do not reuse a
Supabase target. Set `RUN_SUPABASE_STAGING_PG_TESTS=true`,
`SUPABASE_STAGING_PG_TEST_CONFIRMATION=I_CONFIRM_LOCAL_DISPOSABLE_POSTGRES`,
and `SUPABASE_STAGING_PG_TEST_DATABASE_URL` for that local database, then run
`bun run test:supabase-staging-postgres`. With opt-in absent, ordinary `bun test`
skips this suite without opening a connection. The integration test applies the
actual baseline and forward migrations, so use only a newly created disposable
database and remove only the resources created for that test afterward.

The application tables are in `public`. Current browser code uses Supabase Auth, while catalog, cart, customer orders, contact inquiries, and administration use Express APIs; no browser-side `supabase.from(...)` table access was found. The baseline does not enable RLS. Supabase documents that SQL-created `public` tables can be reachable through its Data API, so before staging is exposed, separately decide and verify whether to enable RLS without browser-access policies or remove `public` from Data API exposure. Do not add blanket policies: carts, orders, inquiries, and payment records must not be exposed. This task does not change RLS or grants.

### Health and readiness

`GET /api/health` is a lightweight liveness response and does not access the database. `GET /api/ready` runs a read-only `SELECT 1` through the shared pool, with a 3-second query timeout and bounded connection timeout. It returns only a generic 503 on failure. Neither route runs writes, migrations, seeds, or cleanup. Local tests do not prove staging connectivity.

### Reservation cleanup scheduling

`POST /api/internal/reservations/expire` is protected by a constant-time-checked `Authorization: Bearer <CRON_SECRET>` token. It calls the existing transactional/idempotent expiry helper, accepts no database target or caller-supplied cleanup parameters, and returns only an aggregate count. Missing secret configuration fails closed. Keep the secret in the Vercel Preview server environment and configure an external scheduler to invoke the endpoint over HTTPS every 1–5 minutes. Never place the secret in a URL, client bundle, or scheduler logs.

Do not configure this as a Vercel Hobby Cron: Hobby supports only once-daily schedules, potentially any time within the selected hour, while reservations expire after 20 minutes. Expired reservations are excluded from available-stock calculations using PostgreSQL wall-clock time, and payment settlement refuses expired reservations, so delayed housekeeping does not make expired stock unavailable forever or allow late fulfillment. Expired unpaid order rows can remain pending until cleanup, however, so daily cleanup is operationally too slow. Use an external scheduler with a 1–5-minute cadence or a plan supporting that frequency. The actual plan and scheduler are not configured yet.

### Backup and restore runbook

The staging Supabase plan has not been independently verified. Current Supabase documentation states automatic daily database backups are available on Pro, Team, and Enterprise; Free projects are advised to make regular CLI exports and maintain off-site backups. Database backups do not include Storage API objects. Do not assume Free includes daily backups.

For staging-only logical backups, use Supabase CLI `db dump` with the verified staging project or PostgreSQL-native tools with an approved connection mode. The Supabase CLI excludes managed schemas by default and requires Docker. Keep files outside the repository/deployment artifact, encrypt with an approved key before off-site transfer, restrict access, and verify checksums. Example placeholders only:

```sh
supabase db dump --db-url "$STAGING_DATABASE_URL" -f /secure-backups/rcmega-staging-schema.sql
supabase db dump --db-url "$STAGING_DATABASE_URL" -f /secure-backups/rcmega-staging-data.sql --use-copy --data-only
```

Restore only into a separate disposable target, never over the source. Validate application tables, constraints, indexes, Drizzle history, products, inventory reservations, orders/order items, payment-review cases, and contact inquiries. Plan downtime, recovery-point/time objectives, access controls, and ownership. Storage objects need a separate backup plan. No backup or restore drill was performed for this task.

Official platform references for this deployment section:
- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Postgres.js compatibility](https://supabase.com/docs/guides/database/postgres-js)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)

For Vercel, set the project Function/Build Node.js version to `22.x`, matching the supported major in `package.json` (`>=22.12.0 <23`). Vercel detects the checked-in `bun.lock` for installation; the deployed Express Function itself uses Vercel's Node.js runtime.
