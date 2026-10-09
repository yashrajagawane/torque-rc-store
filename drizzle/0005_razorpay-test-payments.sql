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
ALTER TABLE "orders" ADD COLUMN "razorpay_order_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "razorpay_payment_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "razorpay_order_creation_status" text DEFAULT 'NOT_STARTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_review_cases" ADD CONSTRAINT "payment_review_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_review_cases_order_idx" ON "payment_review_cases" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "razorpay_webhook_events_payment_idx" ON "razorpay_webhook_events" USING btree ("gateway_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_razorpay_order_id_unique" ON "orders" USING btree ("razorpay_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_razorpay_payment_id_unique" ON "orders" USING btree ("razorpay_payment_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_razorpay_creation_status_valid" CHECK ("orders"."razorpay_order_creation_status" IN ('NOT_STARTED', 'CREATING', 'CREATED', 'FAILED'));
