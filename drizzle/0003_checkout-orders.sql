ALTER TABLE "order_items" ADD COLUMN "product_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_auth_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subtotal" numeric(10, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_amount" numeric(10, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_status" text DEFAULT 'UNFULFILLED' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_idempotency_unique" ON "orders" USING btree ("customer_auth_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_customer_auth_id_idx" ON "orders" USING btree ("customer_auth_id");
--> statement-breakpoint

-- Historic rows have no name/slug snapshot. Backfill from the related product
-- where available; new orders record these values at purchase time.
UPDATE "order_items" AS oi
SET "product_name" = COALESCE((SELECT p."name" FROM "products" AS p WHERE p."id" = oi."product_id"), CASE WHEN oi."product_id" IS NULL THEN 'Product' ELSE 'Product #' || oi."product_id"::text END),
    "product_slug" = COALESCE((SELECT p."slug" FROM "products" AS p WHERE p."id" = oi."product_id"), '')
WHERE oi."product_name" = '' OR oi."product_slug" = '';
