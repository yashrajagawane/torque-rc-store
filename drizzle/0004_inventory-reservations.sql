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
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reservations_order_product_unique" ON "inventory_reservations" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_product_active_expiry_idx" ON "inventory_reservations" USING btree ("product_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "inventory_reservations_expiry_idx" ON "inventory_reservations" USING btree ("status","expires_at");