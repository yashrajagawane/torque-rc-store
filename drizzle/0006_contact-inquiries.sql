CREATE TABLE "contact_inquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"inquiry_type" text NOT NULL,
	"model" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_inquiries_status_valid" CHECK ("contact_inquiries"."status" IN ('NEW', 'REVIEWED', 'CLOSED'))
);
--> statement-breakpoint
CREATE INDEX "contact_inquiries_created_at_idx" ON "contact_inquiries" USING btree ("created_at");