import { EventEmitter } from 'node:events';
import { NextRequest } from 'next/server';

type AgentEvent =
  | { type: 'tool-start'; name?: string | null; args?: Record<string, unknown> | null; ts?: number }
  | { type: 'tool-result'; name?: string | null; images?: string[]; text?: string | null; error?: string | null; durationMs?: number; ts?: number }
  | { type: 'final'; text?: string | null; ts?: number };

function getGlobalEmitter() {
  const g = globalThis as unknown as { __agentEmitter?: EventEmitter };
  if (!g.__agentEmitter) {
    const instance = new EventEmitter();
    instance.setMaxListeners(0);
    g.__agentEmitter = instance;
  }
  return g.__agentEmitter;
}

const emitter = getGlobalEmitter();

export function emitAgentEvent(chatId: string, event: AgentEvent) {
  emitter.emit(chatId, event);
}

export function sseSubscribe(_req: NextRequest, chatId: string) {
  const encoder = new TextEncoder();
  let keepAlive: NodeJS.Timeout | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const onEvent = (event: AgentEvent) => send(event);
      emitter.on(chatId, onEvent);

      // Initial ping
      send({ type: 'final', text: null });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        emitter.off(chatId, onEvent);
        if (keepAlive) clearInterval(keepAlive);
      };

      // Keep-alive to prevent timeouts
      keepAlive = setInterval(() => {
        if (closed) {
          if (keepAlive) clearInterval(keepAlive);
          return;
        }
        // If the stream is no longer writable, stop.
        if ((controller as any).desiredSize === null) {
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          cleanup();
        }
      }, 15000);

      // Expose cleanup so cancel() can call it.
      (controller as any)._cleanup = cleanup;
    },
    cancel() {
      const cleanup = (this as any)?._cleanup as (() => void) | undefined;
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}