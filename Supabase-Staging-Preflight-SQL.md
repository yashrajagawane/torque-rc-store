# Supabase Staging Preflight SQL

Read-only inspection queries for the Fly RC Hobbies Supabase staging project. Run these in the Supabase SQL Editor for the staging project you selected. Every SQL statement below is a `SELECT`; none changes database state. The queries do not inspect customer records, password hashes, secrets, or connection URLs.

> SQL results can confirm the connected database and role, but cannot independently prove the Supabase project reference or Data API setting. Confirm the selected project reference and Data API configuration in the Supabase Dashboard as well.

## 1. Connection identity and expected schemas

```sql
SELECT
  current_database() AS database_name,
  session_user AS login_role,
  current_user AS effective_role,
  current_schema() AS current_schema,
  current_setting('search_path') AS search_path,
  inet_server_port() AS postgres_internal_port;

WITH expected(schema_name) AS (
  VALUES
    ('public'),
    ('drizzle'),
    ('supabase_migrations'),
    ('auth'),
    ('storage')
)
SELECT
  expected.schema_name,
  (actual.oid IS NOT NULL) AS schema_exists
FROM expected
LEFT JOIN pg_namespace AS actual
  ON actual.nspname = expected.schema_name
ORDER BY expected.schema_name;
```

`inet_server_port()` is PostgreSQL’s internal port; it may differ from the port in a client connection string. The staging runner separately sets and checks `search_path=public`. The SQL Editor’s search path may differ from the runner’s.

## 2. Relations in `public` and `drizzle`

This lists tables, views, materialized views, sequences, foreign tables, and indexes. Extension ownership is included because the staging guard allows extension-owned public objects but rejects other pre-existing public objects.

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS object_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized view'
    WHEN 'S' THEN 'sequence'
    WHEN 'f' THEN 'foreign table'
    WHEN 'i' THEN 'index'
    WHEN 'I' THEN 'partitioned index'
    ELSE c.relkind::text
  END AS object_type,
  pg_get_userbyid(c.relowner) AS object_owner,
  EXISTS (
    SELECT 1
    FROM pg_depend AS d
    WHERE d.classid = 'pg_class'::regclass
      AND d.objid = c.oid
      AND d.deptype = 'e'
  ) AS extension_owned
FROM pg_class AS c
JOIN pg_namespace AS n
  ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'drizzle')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I')
ORDER BY n.nspname, object_type, c.relname;
```

## 3. Other public objects checked by the initializer

The guard also considers routines, user-defined types, operators and related objects. This inventories those object kinds so a non-table object in `public` does not go unnoticed.

```sql
WITH public_objects AS (
  SELECT
    p.proname AS object_name,
    'routine' AS object_type,
    EXISTS (
      SELECT 1 FROM pg_depend AS d
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid
        AND d.deptype = 'e'
    ) AS extension_owned
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT
    t.typname,
    'type',
    EXISTS (
      SELECT 1 FROM pg_depend AS d
      WHERE d.classid = 'pg_type'::regclass
        AND d.objid = t.oid
        AND d.deptype = 'e'
    )
  FROM pg_type AS t
  JOIN pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typrelid = 0
    AND t.typtype IN ('c', 'd', 'e', 'r', 'm')

  UNION ALL

  SELECT o.oprname, 'operator',
    EXISTS (
      SELECT 1 FROM pg_depend AS d
      WHERE d.classid = 'pg_operator'::regclass
        AND d.objid = o.oid
        AND d.deptype = 'e'
    )
  FROM pg_operator AS o
  JOIN pg_namespace AS n ON n.oid = o.oprnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT o.opcname, 'operator class',
    EXISTS (
      SELECT 1 FROM pg_depend AS d
      WHERE d.classid = 'pg_opclass'::regclass
        AND d.objid = o.oid
        AND d.deptype = 'e'
    )
  FROM pg_opclass AS o
  JOIN pg_namespace AS n ON n.oid = o.opcnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT c.collname, 'collation',
    EXISTS (
      SELECT 1 FROM pg_depend AS d
      WHERE d.classid = 'pg_collation'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    )
  FROM pg_collation AS c
  JOIN pg_namespace AS n ON n.oid = c.collnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT c.conname, 'conversion',
    EXISTS (
      SELECT 1 FROM pg_depend AS d
      WHERE d.classid = 'pg_conversion'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    )
  FROM pg_conversion AS c
  JOIN pg_namespace AS n ON n.oid = c.connamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT c.cfgname, 'text search configuration',
    EXISTS (
      SELECT 1 FROM pg_depend AS d
      WHERE d.classid = 'pg_ts_config'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    )
  FROM pg_ts_config AS c
  JOIN pg_namespace AS n ON n.oid = c.cfgnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT d.dictname, 'text search dictionary',
    EXISTS (
      SELECT 1 FROM pg_depend AS dep
      WHERE dep.classid = 'pg_ts_dict'::regclass
        AND dep.objid = d.oid
        AND dep.deptype = 'e'
    )
  FROM pg_ts_dict AS d
  JOIN pg_namespace AS n ON n.oid = d.dictnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT p.prsname, 'text search parser',
    EXISTS (
      SELECT 1 FROM pg_depend AS dep
      WHERE dep.classid = 'pg_ts_parser'::regclass
        AND dep.objid = p.oid
        AND dep.deptype = 'e'
    )
  FROM pg_ts_parser AS p
  JOIN pg_namespace AS n ON n.oid = p.prsnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT t.tmplname, 'text search template',
    EXISTS (
      SELECT 1 FROM pg_depend AS dep
      WHERE dep.classid = 'pg_ts_template'::regclass
        AND dep.objid = t.oid
        AND dep.deptype = 'e'
    )
  FROM pg_ts_template AS t
  JOIN pg_namespace AS n ON n.oid = t.tmplnamespace
  WHERE n.nspname = 'public'
)
SELECT object_type, object_name, extension_owned
FROM public_objects
ORDER BY object_type, object_name;
```

## 4. Migration-history table existence and columns

This is safe whether either schema or table exists; it returns `false` or no column rows rather than referencing a missing table.

```sql
SELECT
  'drizzle.__drizzle_migrations' AS history_table,
  to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS table_exists
UNION ALL
SELECT
  'supabase_migrations.schema_migrations',
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL;

SELECT
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type
FROM information_schema.columns
WHERE (table_schema = 'drizzle' AND table_name = '__drizzle_migrations')
   OR (table_schema = 'supabase_migrations' AND table_name = 'schema_migrations')
ORDER BY table_schema, table_name, ordinal_position;
```

Only if the first result says `drizzle.__drizzle_migrations` exists **and** the column listing confirms `id`, `hash`, and `created_at`, run:

```sql
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at, id;
```

Do not run that last query if the table is missing or its columns differ. Any existing `drizzle` schema or `supabase_migrations` schema is a stop condition for this initializer, even if the corresponding history table is empty.

## 5. Supabase API roles and role memberships

This shows role attributes and schema privileges without exposing password fields. The membership result compares each API role to the SQL Editor’s current role; compare it with the effective role configured for the staging migration if those differ.

```sql
SELECT
  expected.role_name,
  r.oid IS NOT NULL AS role_exists,
  r.rolcanlogin,
  r.rolsuper,
  r.rolinherit,
  r.rolcreaterole,
  r.rolcreatedb,
  r.rolbypassrls,
  CASE WHEN r.oid IS NOT NULL
    THEN has_schema_privilege(r.oid, 'public', 'USAGE')
  END AS public_schema_usage,
  CASE WHEN r.oid IS NOT NULL
    THEN has_schema_privilege(r.oid, 'public', 'CREATE')
  END AS public_schema_create,
  CASE WHEN r.oid IS NOT NULL
    THEN pg_has_role(r.oid, current_user, 'MEMBER')
  END AS member_of_sql_editor_role
FROM (VALUES ('anon'), ('authenticated')) AS expected(role_name)
LEFT JOIN pg_roles AS r
  ON r.rolname = expected.role_name
ORDER BY expected.role_name;

SELECT
  member.rolname AS member_role,
  granted.rolname AS granted_role,
  m.admin_option
FROM pg_auth_members AS m
JOIN pg_roles AS member ON member.oid = m.member
JOIN pg_roles AS granted ON granted.oid = m.roleid
WHERE member.rolname IN ('anon', 'authenticated')
   OR granted.rolname IN ('anon', 'authenticated')
ORDER BY member.rolname, granted.rolname;
```

## 6. Expected application tables, RLS, policies, and effective privileges

This checks the 14 table names currently declared in `src/db/schema.ts`. Missing tables return `table_exists = false` and null privilege results rather than causing an error.

```sql
WITH expected(table_name, sequence_name) AS (
  VALUES
    ('brands', 'brands_id_seq'),
    ('cart_items', 'cart_items_id_seq'),
    ('cart_merge_operations', 'cart_merge_operations_id_seq'),
    ('categories', 'categories_id_seq'),
    ('contact_inquiries', 'contact_inquiries_id_seq'),
    ('inventory_reservations', 'inventory_reservations_id_seq'),
    ('order_items', 'order_items_id_seq'),
    ('orders', 'orders_id_seq'),
    ('payment_review_cases', 'payment_review_cases_id_seq'),
    ('products', 'products_id_seq'),
    ('razorpay_webhook_events', 'razorpay_webhook_events_id_seq'),
    ('reviews', 'reviews_id_seq'),
    ('users', 'users_id_seq'),
    ('wishlist', 'wishlist_id_seq')
),
api_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT
  e.table_name,
  api.role_name,
  t.oid IS NOT NULL AS table_exists,
  t.relrowsecurity AS rls_enabled,
  t.relforcerowsecurity AS force_rls,
  COALESCE((
    SELECT string_agg(p.policyname, ', ' ORDER BY p.policyname)
    FROM pg_policies AS p
    WHERE p.schemaname = 'public'
      AND p.tablename = e.table_name
  ), '(none)') AS policies,
  CASE WHEN r.oid IS NOT NULL AND t.oid IS NOT NULL
    THEN has_table_privilege(r.oid, t.oid, 'SELECT')
  END AS table_select,
  CASE WHEN r.oid IS NOT NULL AND t.oid IS NOT NULL
    THEN has_table_privilege(r.oid, t.oid, 'INSERT')
  END AS table_insert,
  CASE WHEN r.oid IS NOT NULL AND t.oid IS NOT NULL
    THEN has_table_privilege(r.oid, t.oid, 'UPDATE')
  END AS table_update,
  CASE WHEN r.oid IS NOT NULL AND t.oid IS NOT NULL
    THEN has_table_privilege(r.oid, t.oid, 'DELETE')
  END AS table_delete,
  CASE WHEN r.oid IS NOT NULL AND t.oid IS NOT NULL
    THEN has_table_privilege(r.oid, t.oid, 'TRUNCATE')
  END AS table_truncate,
  CASE WHEN r.oid IS NOT NULL AND t.oid IS NOT NULL
    THEN has_any_column_privilege(r.oid, t.oid, 'SELECT')
  END AS any_column_select,
  s.oid IS NOT NULL AS id_sequence_exists,
  CASE WHEN r.oid IS NOT NULL AND s.oid IS NOT NULL
    THEN has_sequence_privilege(r.oid, s.oid, 'USAGE')
  END AS sequence_usage,
  CASE WHEN r.oid IS NOT NULL AND s.oid IS NOT NULL
    THEN has_sequence_privilege(r.oid, s.oid, 'SELECT')
  END AS sequence_select,
  CASE WHEN r.oid IS NOT NULL AND s.oid IS NOT NULL
    THEN has_sequence_privilege(r.oid, s.oid, 'UPDATE')
  END AS sequence_update
FROM expected AS e
CROSS JOIN api_roles AS api
LEFT JOIN pg_roles AS r
  ON r.rolname = api.role_name
LEFT JOIN pg_namespace AS n
  ON n.nspname = 'public'
LEFT JOIN pg_class AS t
  ON t.relnamespace = n.oid
  AND t.relname = e.table_name
  AND t.relkind IN ('r', 'p')
LEFT JOIN pg_class AS s
  ON s.oid = to_regclass(format('%I.%I', 'public', e.sequence_name))
ORDER BY e.table_name, api.role_name;
```

PostgreSQL’s privilege inquiry functions account for effective privileges, including privileges inherited through role membership. See the [PostgreSQL privilege inquiry documentation](https://www.postgresql.org/docs/16/functions-info.html).

## Expected results and stop conditions

For a newly created staging project, expect `public`, `auth`, and `storage` schemas and the `anon` and `authenticated` roles. The application tables and both migration-history schemas should not yet exist. The application-table query should therefore show all 14 tables as absent.

Stop before initialization if:

- Any non-extension-owned object exists in `public`, including a relation, routine, type, or operator.
- The `drizzle` schema exists, or any Drizzle migration-history table or entry exists.
- The `supabase_migrations` schema exists. The current staging guard rejects the schema itself, not just a populated history table.
- Either expected API role is missing, or either role inherits the configured migration-owner role.
- Application tables already exist, have unexpected policies or privileges, or any API role has effective table, column, or sequence access.
- The SQL Editor’s database identity does not match the staging project selected in the Dashboard.

The connected SQL Editor role and host name do **not** independently establish the project reference. Compare the selected project’s reference and connection endpoint with the staging settings obtained from the Dashboard. The current staging runner explicitly sets `search_path=public`; a different SQL Editor search path alone does not prove that the runner’s configured connection is wrong.

The README still contains an older paragraph saying a Supabase-aware initializer must be prepared, followed later by newer instructions describing the implemented staging runner. Treat that paragraph as stale and reconcile the documentation before using it as an operational runbook.

No query in this file was executed as part of its preparation.
