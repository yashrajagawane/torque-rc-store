-- TEST ONLY. This is a standalone bootstrap for a newly created, disposable
-- PostgreSQL integration-test database. It is not a Drizzle migration, is not
-- recorded in drizzle/meta, and must never be applied to an existing or
-- production database. Keep table definitions aligned with src/db/schema.ts
-- and the schema after migrations 0000 through 0005.

BEGIN;

CREATE TABLE "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "uid" text NOT NULL UNIQUE,
  "email" text NOT NULL UNIQUE,
  "display_name" text,
  "photo_url" text,
  "is_admin" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE "categories" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "description" text,
  "image" text
);

CREATE TABLE "brands" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "logo" text,
  "description" text
);

CREATE TABLE "products" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL UNIQUE,
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
  "is_published" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "products_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "products_category_id_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "customer_auth_id" uuid,
  "customer_email" text,
  "idempotency_key" uuid,
  "request_hash" text,
  "subtotal" numeric(10, 2) NOT NULL DEFAULT '0.00',
  "shipping_amount" numeric(10, 2) NOT NULL DEFAULT '0.00',
  "currency" text NOT NULL DEFAULT 'INR',
  "total" numeric(10, 2) NOT NULL,
  "status" text DEFAULT 'PENDING',
  "payment_status" text DEFAULT 'UNPAID',
  "fulfillment_status" text NOT NULL DEFAULT 'UNFULFILLED',
  "razorpay_order_id" text,
  "razorpay_payment_id" text,
  "razorpay_order_creation_status" text NOT NULL DEFAULT 'NOT_STARTED',
  "shipping_address" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "orders_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "orders_razorpay_creation_status_valid"
    CHECK ("razorpay_order_creation_status" IN ('NOT_STARTED', 'CREATING', 'CREATED', 'FAILED'))
);

CREATE UNIQUE INDEX "orders_customer_idempotency_unique"
  ON "orders" USING btree ("customer_auth_id", "idempotency_key");
CREATE UNIQUE INDEX "orders_razorpay_order_id_unique"
  ON "orders" USING btree ("razorpay_order_id");
CREATE UNIQUE INDEX "orders_razorpay_payment_id_unique"
  ON "orders" USING btree ("razorpay_payment_id");
CREATE INDEX "orders_customer_auth_id_idx"
  ON "orders" USING btree ("customer_auth_id");

CREATE TABLE "order_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer,
  "product_id" integer,
  "product_name" text NOT NULL DEFAULT '',
  "product_slug" text NOT NULL DEFAULT '',
  "quantity" integer NOT NULL,
  "price" numeric(10, 2) NOT NULL,
  CONSTRAINT "order_items_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "order_items_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "cart_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "product_id" integer NOT NULL,
  "quantity" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "cart_items_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "cart_items_user_product_unique"
  ON "cart_items" USING btree ("user_id", "product_id");

CREATE TABLE "inventory_reservations" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL,
  "product_id" integer NOT NULL,
  "quantity" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_reservations_status_valid"
    CHECK ("status" IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  CONSTRAINT "inventory_reservations_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "inventory_reservations_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "inventory_reservations_order_product_unique"
  ON "inventory_reservations" USING btree ("order_id", "product_id");
CREATE INDEX "inventory_reservations_product_active_expiry_idx"
  ON "inventory_reservations" USING btree ("product_id", "status", "expires_at");
CREATE INDEX "inventory_reservations_expiry_idx"
  ON "inventory_reservations" USING btree ("status", "expires_at");

CREATE TABLE "razorpay_webhook_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "gateway_order_id" text,
  "gateway_payment_id" text,
  "processing_status" text NOT NULL DEFAULT 'RECEIVED',
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at" timestamp with time zone,
  CONSTRAINT "razorpay_webhook_events_event_id_unique" UNIQUE ("event_id"),
  CONSTRAINT "razorpay_webhook_events_status_valid"
    CHECK ("processing_status" IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'REVIEW_REQUIRED'))
);
CREATE INDEX "razorpay_webhook_events_payment_idx"
  ON "razorpay_webhook_events" USING btree ("gateway_payment_id");

CREATE TABLE "payment_review_cases" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer,
  "razorpay_payment_id" text NOT NULL,
  "razorpay_order_id" text NOT NULL,
  "amount_paise" integer NOT NULL,
  "currency" text NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payment_review_cases_razorpay_payment_id_unique" UNIQUE ("razorpay_payment_id"),
  CONSTRAINT "payment_review_cases_amount_positive" CHECK ("amount_paise" > 0),
  CONSTRAINT "payment_review_cases_status_valid" CHECK ("status" IN ('OPEN', 'RESOLVED')),
  CONSTRAINT "payment_review_cases_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "payment_review_cases_order_idx"
  ON "payment_review_cases" USING btree ("order_id", "created_at");

COMMIT;
