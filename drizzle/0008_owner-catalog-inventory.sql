ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "low_stock_threshold" integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "supplier_name" text,
  ADD COLUMN IF NOT EXISTS "supplier_sku" text,
  ADD COLUMN IF NOT EXISTS "cost_price" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "seo_title" text,
  ADD COLUMN IF NOT EXISTS "seo_description" text,
  ADD COLUMN IF NOT EXISTS "social_image" text;

CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" integer NOT NULL REFERENCES "products"("id") ON DELETE restrict,
  "owner_auth_id" text NOT NULL,
  "delta" integer NOT NULL,
  "previous_stock" integer NOT NULL,
  "new_stock" integer NOT NULL,
  "reason" text NOT NULL,
  "order_id" integer REFERENCES "orders"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "inventory_movements_product_created_idx" ON "inventory_movements" ("product_id", "created_at");
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "inventory_movements" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory_movements" TO postgres;
GRANT USAGE, SELECT ON SEQUENCE "inventory_movements_id_seq" TO postgres;
