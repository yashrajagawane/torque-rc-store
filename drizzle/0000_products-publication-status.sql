-- Existing products receive TRUE via the DEFAULT and remain visible.
-- New products are inserted as drafts by the owner API.
ALTER TABLE "products"
ADD COLUMN "is_published" boolean DEFAULT true NOT NULL;
--> statement-breakpoint

ALTER TABLE "products"
ALTER COLUMN "is_published" SET DEFAULT false;
