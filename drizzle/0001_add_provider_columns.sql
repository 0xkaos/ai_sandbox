ALTER TABLE "chats" ADD COLUMN "provider" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "model" text DEFAULT 'gpt-4o' NOT NULL;