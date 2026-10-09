DO $hardening$
DECLARE
	app_table text;
	app_sequence text;
	api_role text;
	app_tables text[] := ARRAY[
		'brands','cart_items','cart_merge_operations','categories','contact_inquiries',
		'inventory_reservations','order_items','orders','payment_review_cases','products',
		'razorpay_webhook_events','reviews','users','wishlist'
	];
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = ANY (app_tables)
	) THEN
		RAISE EXCEPTION 'Existing application-table policies require manual review before API hardening';
	END IF;

	-- Membership in the owner role would bypass the intended grant boundary
	-- and could affect future tables. Do not alter Supabase role memberships.
	IF EXISTS (
		SELECT 1 FROM pg_roles
		WHERE rolname IN ('anon', 'authenticated')
			AND pg_has_role(rolname, current_user, 'MEMBER')
	) THEN
		RAISE EXCEPTION 'A Data API role inherits migration-owner privileges; manual review is required';
	END IF;

	-- Schema-specific defaults can be revoked below. PostgreSQL does not allow
	-- a schema-specific REVOKE to cancel global defaults, so reject those if
	-- they already grant future application objects to API roles or PUBLIC.
	IF EXISTS (
		SELECT 1
		FROM pg_default_acl d
		CROSS JOIN LATERAL aclexplode(d.defaclacl) a
		WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
			AND d.defaclnamespace = 0
			AND d.defaclobjtype IN ('r', 'S')
			AND (a.grantee = 0 OR a.grantee IN (
				SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
			))
	) THEN
		RAISE EXCEPTION 'Global default privileges expose future objects; manual review is required';
	END IF;

	FOREACH app_table IN ARRAY app_tables LOOP
		EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
		FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
			IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
				EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', app_table, api_role);
			END IF;
		END LOOP;
	END LOOP;

	FOREACH app_sequence IN ARRAY ARRAY[
		'brands_id_seq','cart_items_id_seq','cart_merge_operations_id_seq','categories_id_seq',
		'contact_inquiries_id_seq','inventory_reservations_id_seq','order_items_id_seq','orders_id_seq',
		'payment_review_cases_id_seq','products_id_seq','razorpay_webhook_events_id_seq',
		'reviews_id_seq','users_id_seq','wishlist_id_seq'
	] LOOP
		EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC', app_sequence);
		FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
			IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
				EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM %I', app_sequence, api_role);
			END IF;
		END LOOP;
	END LOOP;

	FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
			EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', current_user, api_role);
			EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', current_user, api_role);
		END IF;
	END LOOP;
	ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
	ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;

	-- Fail closed if an indirect grant still gives either API role access.
	IF EXISTS (
		SELECT 1
		FROM unnest(ARRAY['anon', 'authenticated']) AS roles(role_name)
		CROSS JOIN unnest(app_tables) AS tables(table_name)
		WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = roles.role_name)
			AND (
				has_table_privilege(roles.role_name, format('public.%I', tables.table_name), 'SELECT')
				OR has_table_privilege(roles.role_name, format('public.%I', tables.table_name), 'INSERT')
				OR has_table_privilege(roles.role_name, format('public.%I', tables.table_name), 'UPDATE')
				OR has_table_privilege(roles.role_name, format('public.%I', tables.table_name), 'DELETE')
				OR has_table_privilege(roles.role_name, format('public.%I', tables.table_name), 'TRUNCATE')
				OR has_table_privilege(roles.role_name, format('public.%I', tables.table_name), 'REFERENCES')
				OR has_table_privilege(roles.role_name, format('public.%I', tables.table_name), 'TRIGGER')
				OR has_sequence_privilege(roles.role_name, format('public.%I_id_seq', tables.table_name), 'USAGE')
				OR has_sequence_privilege(roles.role_name, format('public.%I_id_seq', tables.table_name), 'SELECT')
				OR has_sequence_privilege(roles.role_name, format('public.%I_id_seq', tables.table_name), 'UPDATE')
			)
	) THEN
		RAISE EXCEPTION 'Effective Data API privileges remain on application objects; manual review is required';
	END IF;
END
$hardening$;--> statement-breakpoint
ALTER TABLE public."brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."cart_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."cart_merge_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."contact_inquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."inventory_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."payment_review_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."razorpay_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public."wishlist" ENABLE ROW LEVEL SECURITY;
