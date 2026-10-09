CREATE TABLE "cart_merge_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"rejected" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cart_merge_operations_user_key_unique" ON "cart_merge_operations" USING btree ("user_id","request_key");