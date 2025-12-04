ALTER TABLE "users" ADD COLUMN "google_access_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_refresh_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_scopes" text;