import { pgTable, text, timestamp, jsonb, integer, bytea } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Matches Google ID
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  googleAccessToken: text('google_access_token'),
  googleRefreshToken: text('google_refresh_token'),
  googleTokenExpiresAt: timestamp('google_token_expires_at'),
  googleScopes: text('google_scopes'),
});

export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  title: text('title').notNull(),
  provider: text('provider').notNull().default('openai'),
  model: text('model').notNull().default('gpt-4o'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  role: text('role', { enum: ['user', 'assistant', 'system', 'data'] }).notNull(),
  content: text('content').notNull(),
  toolInvocations: jsonb('tool_invocations'), // Store tool calls/results
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const videos = pgTable('videos', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sourceUrl: text('source_url').notNull(),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  data: bytea('data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
