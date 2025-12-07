CREATE TABLE IF NOT EXISTS "videos" (
    "id" text PRIMARY KEY NOT NULL,
    "chat_id" text NOT NULL REFERENCES "chats"("id") ON DELETE cascade,
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
    "source_url" text NOT NULL,
    "content_type" text,
    "size_bytes" integer,
    "data" bytea NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
