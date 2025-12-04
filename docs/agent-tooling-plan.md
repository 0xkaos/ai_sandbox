# Agent Tooling Plan

## Current Chat Flow Snapshot
- The client uses `useChat` with `TextStreamChatTransport` to POST to `/api/chat` and render the streaming response.
- `/api/chat` authenticates, ensures a `users` row exists, stores each inbound user message, resolves a model via `resolveLanguageModel`, and streams text back with `streamText`.
- Message persistence happens before (user) and after (assistant) the model call, but there is no concept of tool invocations yet.

## Target Architecture Overview
1. **Execution modes:**
   - `direct`: keep the existing `streamText` response for providers/models that should bypass LangChain.
   - `agent`: run a LangChain `AgentExecutor` that can call structured tools (Google Calendar, later others) while still emitting a streaming response compatible with the Vercel AI transport.
2. **Agent runtime module:** create `src/lib/agent/runtime.ts` that orchestrates LangChain. It accepts `{ userId, chatId, messages, modelSelection }` and returns a `ReadableStream<Uint8Array>` plus structured metadata (tool traces, final text).
3. **Tool registry:** introduce `src/lib/agent/tools/index.ts` exporting typed LangChain tools. Tools receive the authenticated `userId` so they can look up credentials/tokens per user.
4. **Request routing:** update `/api/chat` so that, after resolving the provider/model, it branches:
   - If `providerId === 'openai'` (or whichever list supports the agent) **and** the feature flag `process.env.AGENT_TOOLS_ENABLED === 'true'`, call the agent runtime.
   - Otherwise fall back to the existing `streamText` call.

## LangChain Runtime Details
- **LLM binding:** use `@langchain/openai` and instantiate `new ChatOpenAI({ model: modelId, temperature, streaming: true })`. This lets us reuse the same OpenAI credentials already required for the Vercel AI SDK.
- **Message handoff:** convert the incoming `coreMessages` to LangChain `BaseMessage` objects. A small helper (e.g. `src/lib/agent/langchain-adapters.ts`) can map roles and ensure the system prompt includes guidance about available tools and safety rails.
- **Streaming bridge:** use `AgentExecutor.streamLog()` to tap into LangChain's event stream. Repackage those events into the format expected by `TextStreamChatTransport`:
  - Emit `text-delta` events for incremental LLM tokens.
  - Emit synthetic `tool-call` chunks whenever the agent schedules a tool, and `tool-result` chunks once the tool resolves.
  - When the executor finishes, emit a final `text` chunk and close the stream.
- **Persistence hooks:** capture the final assistant text plus an array of `{ toolName, args, result, startedAt, finishedAt }` from the LangChain callbacks. Pass that object to `saveMessage` so `messages.toolInvocations` is populated.

## Google Calendar Tooling Plan
1. **Storage recap:** `users` already has `googleAccessToken`, `googleRefreshToken`, `googleTokenExpiresAt`, and `googleScopes`.
2. **Google client helper:**
   - Create `src/lib/google/oauth.ts` with `getGoogleCredentialsForUser(userId)` that queries the DB and throws if tokens are missing.
   - Add `refreshGoogleAccessToken(userId)` that exchanges the refresh token with Google, updates the `users` row, and returns the new access token + expiry.
   - Expose `getValidGoogleAccessToken(userId)` which checks `googleTokenExpiresAt` with a safety buffer (e.g. 2 minutes) and refreshes when needed.
3. **Calendar client:** implement `src/lib/google/calendar.ts` exporting functions like `listUpcomingEvents`, `createEvent`, `updateEvent`, and `deleteEvent`. Each function:
   - Calls `getValidGoogleAccessToken`.
   - Instantiates a `google.calendar({ version: 'v3', auth })` client from the `googleapis` package.
   - Accepts normalized parameters (ISO timestamps in UTC, optional `calendarId`, etc.).
4. **LangChain tools:** define structured tools that wrap the calendar client:
   - `ListCalendarEventsTool`
     - Schema: `calendarId?: string`, `timeMin?: string`, `timeMax?: string`, `maxResults?: number`.
     - Returns a concise JSON summary (title, start/end, attendees) for up to `maxResults` events.
   - `CreateCalendarEventTool`
     - Schema: `calendarId?: string`, `summary: string`, `description?: string`, `startTime: string`, `endTime: string`, `timeZone?: string`, `attendees?: { email: string }[]`.
     - Returns the created event metadata/link.
   - Future tools can extend this pattern (update/delete) once read/write basics are proven.
5. **Error handling:** tools should `throw` LangChain `ToolExecutionError`s with user-friendly messages (e.g., "No Google Calendar access. Please re-authenticate."). These errors are surfaced to the LLM so it can gracefully explain the problem to the user.
6. **Security considerations:** never echo access tokens. All tool functions operate server-side with per-user auth; results sent back to the client should contain only necessary event data.

## Implementation Steps
1. Add dependencies: `langchain`, `@langchain/openai`, and `googleapis`.
2. Build the Google OAuth + Calendar helper modules (`src/lib/google/*`).
3. Implement calendar tool functions and export them via a registry consumed by the agent runtime.
4. Create the agent runtime wrapper that:
   - Converts chat history to LangChain messages.
   - Creates the `AgentExecutor` with the calendar tools.
   - Streams results back to the client transport while logging tool invocations.
5. Update `/api/chat` to select between direct streaming and agent mode. Add telemetry so we know when tools run, how long they take, and whether refresh logic was needed.
6. Extend the UI later (optional) to surface tool actions (e.g., "Created calendar event..." chips) using the saved `toolInvocations` payload.

This architecture keeps the existing client contract intact, isolates tool-specific code under `src/lib/agent` and `src/lib/google`, and leverages the stored OAuth tokens for per-user Calendar access.
