CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"description" text,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_quantity_positive" CHECK ("cart_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "cart_merge_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"rejected" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"image" text,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("inventory_reservations"."quantity" > 0),
	CONSTRAINT "inventory_reservations_status_valid" CHECK ("inventory_reservations"."status" IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer,
	"product_id" integer,
	"product_name" text DEFAULT '' NOT NULL,
	"product_slug" text DEFAULT '' NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"customer_auth_id" uuid,
	"customer_email" text,
	"idempotency_key" uuid,
	"request_hash" text,
	"subtotal" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"shipping_amount" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'PENDING',
	"payment_status" text DEFAULT 'UNPAID',
	"fulfillment_status" text DEFAULT 'UNFULFILLED' NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"razorpay_order_creation_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "orders_razorpay_creation_status_valid" CHECK ("orders"."razorpay_order_creation_status" IN ('NOT_STARTED', 'CREATING', 'CREATED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "payment_review_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer,
	"razorpay_payment_id" text NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_review_cases_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id"),
	CONSTRAINT "payment_review_cases_amount_positive" CHECK ("payment_review_cases"."amount_paise" > 0),
	CONSTRAINT "payment_review_cases_status_valid" CHECK ("payment_review_cases"."status" IN ('OPEN', 'RESOLVED'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"brand_id" integer,
	"category_id" integer,
	"description" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"compare_at_price" numeric(10, 2),
	"currency" text DEFAULT 'INR',
	"images" jsonb NOT NULL,
	"thumbnail" text NOT NULL,
	"scale" text,
	"terrain" text,
	"drive_type" text,
	"battery_type" text,
	"battery_size" text,
	"skill_level" text,
	"age" text,
	"material" text,
	"stock" integer DEFAULT 0,
	"availability" text DEFAULT 'IN_STOCK',
	"featured" boolean DEFAULT false,
	"new_arrival" boolean DEFAULT false,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "razorpay_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"gateway_order_id" text,
	"gateway_payment_id" text,
	"processing_status" text DEFAULT 'RECEIVED' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "razorpay_webhook_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "razorpay_webhook_events_status_valid" CHECK ("razorpay_webhook_events"."processing_status" IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'REVIEW_REQUIRED'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"product_id" integer,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"photo_url" text,
	"is_admin" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_uid_unique" UNIQUE("uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wishlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"product_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_review_cases" ADD CONSTRAINT "payment_review_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_user_product_unique" ON "cart_items" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_merge_operations_user_key_unique" ON "cart_merge_operations" USING btree ("user_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reservations_order_product_unique" ON "inventory_reservations" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_product_active_expiry_idx" ON "inventory_reservations" USING btree ("product_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "inventory_reservations_expiry_idx" ON "inventory_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_idempotency_unique" ON "orders" USING btree ("customer_auth_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_razorpay_order_id_unique" ON "orders" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_razorpay_payment_id_unique" ON "orders" USING btree ("razorpay_payment_id");--> statement-breakpoint
CREATE INDEX "orders_customer_auth_id_idx" ON "orders" USING btree ("customer_auth_id");--> statement-breakpoint
CREATE INDEX "payment_review_cases_order_idx" ON "payment_review_cases" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "razorpay_webhook_events_payment_idx" ON "razorpay_webhook_events" USING btree ("gateway_payment_id");