import { randomUUID } from 'node:crypto';
import { createAgent } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { ChatXAI } from '@langchain/xai';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { emitAgentEvent } from '@/lib/agent/events';
import { cacheDataUrl } from '@/lib/images/cache';
import type { ProviderId } from '@/lib/providers';
import { buildAgentTools } from '@/lib/agent/tools';

const textEncoder = new TextEncoder();
const AGENT_ALLOWED_PROVIDERS: ProviderId[] = ['openai', 'xai'];
const DEFAULT_AGENT_TIMEZONE = 'America/New_York';
const AGENT_INVOKE_TIMEOUT_MS = 25000;
const DATA_URL_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
const HTTP_VIDEO_REGEX = /https?:[^\s"']+\.(?:mp4|webm|mov|mkv|m4v)/i;
const SYSTEM_PROMPT_BASE = `You are an autonomous AI teammate that can read and write the user's Google Calendar, generate images, and generate short videos from text.
If the user asks for calendar information, prefer using the calendar tools instead of guessing and summarize any changes you make.
If the user asks for images, use the best image generation tool available.
If the user asks for video, call the Replicate text-to-video tool (wan-video/wan-2.5-t2v) with their prompt and optional tweaks (duration, size). Always summarize the video link returned.`;

export type CoreTextPart = { type: 'text'; text: string };
export type CoreChatMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: CoreTextPart[];
  toolInvocations?: unknown;
};

export type AgentToolInvocationLog = {
  toolCallId: string | null;
  name: string | null;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

export type AgentRunResult = {
  stream: ReadableStream<Uint8Array>;
  finalText: string;
  toolInvocations: AgentToolInvocationLog[];
  displayText?: string;
};

// Default to enabled; allow opting out with AGENT_TOOLS_ENABLED=false
export function agentToolsEnabled() {
  const flag = process.env.AGENT_TOOLS_ENABLED;
  return flag === undefined || flag === null || flag.toLowerCase() !== 'false';
}

export function isAgentEligible(providerId: ProviderId) {
  if (!agentToolsEnabled() || !AGENT_ALLOWED_PROVIDERS.includes(providerId)) {
    return false;
  }

  if (providerId === 'xai') {
    return Boolean(process.env.XAI_API_KEY);
  }

  return true;
}

export async function runAgentWithTools(params: {
  userId: string;
  providerId: ProviderId;
  modelId: string;
  messages: CoreChatMessage[];
  chatId?: string;
}): Promise<AgentRunResult> {
  const { userId, providerId, modelId, messages, chatId } = params;
  const toolEventsEnabled = Boolean(chatId);
  const tools = buildAgentTools(userId);
  const toolEventsFlag = { value: false };
  const instrumentedTools = toolEventsEnabled ? instrumentToolsWithEvents(tools, chatId!, toolEventsFlag) : tools;

  if (tools.length === 0) {
    throw new Error('No tools are currently configured for the agent.');
  }

  const model = createAgentLanguageModel(providerId, modelId);

  const agent = createAgent({
    model,
    tools: instrumentedTools,
    systemPrompt: buildSystemPrompt(),
  });

  const lcMessages = convertMessagesToLangChain(messages);

  const started = Date.now();
  const agentState = await withTimeout(
    agent.invoke({ messages: lcMessages }),
    AGENT_INVOKE_TIMEOUT_MS,
    `Agent invocation timed out after ${AGENT_INVOKE_TIMEOUT_MS}ms`
  );
  const durationMs = Date.now() - started;
  const finalAiMessage = extractLatestAiMessage(agentState.messages);

  if (!finalAiMessage) {
    throw new Error('Agent did not return an assistant message.');
  }

  const finalText = sanitizeText(getMessageText(finalAiMessage));
  const toolInvocations = extractToolInvocations(agentState.messages);

  if (chatId) {
    emitAgentEvents(chatId, toolInvocations, finalText, durationMs, toolEventsFlag.value);
  }

  const media = extractMedia(toolInvocations);
  const displayText =
    media.videos.length > 0
      ? `Generated video ready. ${media.videos[0]}`
      : media.images.length > 0
      ? 'Generated image ready.'
      : finalText;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(textEncoder.encode(displayText));
      controller.close();
    },
  });

  return { stream, finalText, toolInvocations, displayText };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function convertMessagesToLangChain(messages: CoreChatMessage[]): BaseMessage[] {
  const converted: BaseMessage[] = [];

  messages.forEach((message, index) => {
    const text = flattenParts(message.content);

    switch (message.role) {
      case 'system':
        converted.push(new SystemMessage(text));
        break;
      case 'assistant':
        converted.push(new AIMessage(text));
        break;
      case 'user':
        converted.push(new HumanMessage(text));
        break;
      case 'tool':
        converted.push(
          new ToolMessage({
            content: text,
            tool_call_id: message.id ?? `tool-${index}`,
            name: 'historical-tool',
          })
        );
        break;
      default:
        break;
    }
  });

  return converted;
}

function flattenParts(parts: CoreTextPart[] | string | undefined) {
  if (typeof parts === 'string') {
    return parts;
  }

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
    .join('')
    .trim();
}

function extractLatestAiMessage(messages: BaseMessage[]): AIMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message instanceof AIMessage) {
      return message;
    }
  }
  return null;
}

function getMessageText(message: BaseMessage) {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }

  if ('text' in message && typeof message.text === 'string') {
    return message.text;
  }

  return '';
}

function extractToolInvocations(messages: BaseMessage[]): AgentToolInvocationLog[] {
  const toolCallsById = new Map<string, { name?: string | null; args?: Record<string, unknown> }>();

  for (const message of messages) {
    if (message instanceof AIMessage && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (!call) continue;
        const callId = call.id ?? randomUUID();
        toolCallsById.set(callId, {
          name: call.name,
          args: call.args as Record<string, unknown>,
        });
      }
    }
  }

  const logs: AgentToolInvocationLog[] = [];

  for (const message of messages) {
    if (message instanceof ToolMessage) {
      const callMeta = toolCallsById.get(message.tool_call_id);
      logs.push({
        toolCallId: message.tool_call_id ?? null,
        name: message.name ?? callMeta?.name ?? null,
        args: callMeta?.args,
        result: getMessageText(message),
        error: message.status === 'error' ? getMessageText(message) : undefined,
      });
    }
  }

  return logs;
}

function emitAgentEvents(
  chatId: string,
  toolInvocations: AgentToolInvocationLog[],
  finalText: string,
  durationMs: number,
  toolEventsEmitted: boolean
) {
  // Emit aggregated tool-result only if no per-tool event was sent
  if (!toolEventsEmitted && toolInvocations.length) {
    const media = extractMedia(toolInvocations);
    emitAgentEvent(chatId, {
      type: 'tool-result',
      name: toolInvocations[toolInvocations.length - 1]?.name,
      images: media.images,
      videos: media.videos,
      text: media.videos.length ? 'Video generated' : media.images.length ? 'Image generated' : 'Tool completed',
      durationMs,
      ts: Date.now(),
    });
  }

  if (finalText) {
    emitAgentEvent(chatId, { type: 'final', text: sanitizeText(finalText), ts: Date.now() });
  }
}

function instrumentToolsWithEvents(tools: StructuredToolInterface[], chatId: string, toolEventsFlag: { value: boolean }): StructuredToolInterface[] {
  return tools.map((tool) => {
    const runnable: any = tool as any;
    if (runnable.__instrumented || typeof runnable.invoke !== 'function') {
      return tool;
    }

    runnable.__instrumented = true;
    const originalInvoke = runnable.invoke.bind(runnable);
    const toolName = runnable.name ?? 'tool';

    runnable.invoke = async (input: unknown, options?: unknown) => {
      const startTs = Date.now();
      emitAgentEvent(chatId, {
        type: 'tool-start',
        name: toolName,
        args: coerceArgs(input),
        ts: startTs,
      });

      try {
        const result = await originalInvoke(input, options);
        const durationMs = Date.now() - startTs;
        const media = extractMediaFromResult(result);

        emitAgentEvent(chatId, {
          type: 'tool-result',
          name: toolName,
          text: media.videos.length ? 'Video generated' : media.images.length ? 'Image generated' : 'Tool completed',
          images: media.images,
          videos: media.videos,
          durationMs,
          ts: Date.now(),
        });

        if (media.images.length || media.videos.length) {
          console.log('[agent-events] tool-result media', {
            chatId,
            tool: toolName,
            images: media.images,
            videos: media.videos,
          });
        }

        toolEventsFlag.value = true;

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTs;
        emitAgentEvent(chatId, {
          type: 'tool-result',
          name: toolName,
          error: error instanceof Error ? error.message : String(error),
          durationMs,
          ts: Date.now(),
        });
        toolEventsFlag.value = true;
        throw error;
      }
    };

    return runnable as StructuredToolInterface;
  });
}

function coerceArgs(input: unknown): Record<string, unknown> | undefined {
  if (!input) return undefined;
  try {
    const cloned = JSON.parse(JSON.stringify(input));
    if (cloned && typeof cloned === 'object') {
      return cloned as Record<string, unknown>;
    }
  } catch {
    // ignore serialization errors
  }
  return undefined;
}

function extractMediaFromResult(result: unknown): { images: string[]; videos: string[] } {
  if (!result) return { images: [], videos: [] };
  return extractMedia([
    {
      toolCallId: null,
      name: null,
      result,
    },
  ]);
}

function extractMedia(toolInvocations: AgentToolInvocationLog[]): { images: string[]; videos: string[] } {
  const images: string[] = [];
  const videos: string[] = [];

  for (const invocation of toolInvocations) {
    const result = invocation.result;
    if (!result) continue;

    let payload: any = result;

    if (typeof result === 'string') {
      try {
        payload = JSON.parse(result);
      } catch {
        const maybeImage = normalizeImageReference(result) || extractHttpImage(result);
        if (maybeImage) images.push(maybeImage);

        const maybeVideo = normalizeVideoReference(result) || extractHttpVideo(result);
        if (maybeVideo) videos.push(maybeVideo);
        continue;
      }
    }

    if (Array.isArray(payload?.images)) {
      for (const img of payload.images) {
        const normalized = normalizeImageReference(
          typeof img === 'string'
            ? img
            : typeof img === 'object'
            ? (typeof (img as any).dataUrl === 'string'
                ? (img as any).dataUrl
                : typeof (img as any).url === 'string'
                ? (img as any).url
                : null)
            : null
        );
        if (normalized) {
          images.push(normalized);
        }
      }
    }

    if (Array.isArray(payload?.videos)) {
      for (const vid of payload.videos) {
        const normalizedVid = normalizeVideoReference(
          typeof vid === 'string'
            ? vid
            : typeof vid === 'object'
            ? (typeof (vid as any).url === 'string'
                ? (vid as any).url
                : typeof (vid as any).videoUrl === 'string'
                ? (vid as any).videoUrl
                : null)
            : null
        );
        if (normalizedVid) {
          videos.push(normalizedVid);
        }
      }
    }

    if (payload && typeof payload === 'object') {
      const maybeUrl = typeof (payload as any).url === 'string' ? (payload as any).url : typeof (payload as any).image === 'string' ? (payload as any).image : null;
      const normalizedImage = normalizeImageReference(maybeUrl) || extractHttpImage(JSON.stringify(payload));
      if (normalizedImage) {
        images.push(normalizedImage);
      }

      const maybeVideo =
        typeof (payload as any).videoUrl === 'string'
          ? (payload as any).videoUrl
          : typeof (payload as any).video === 'string'
          ? (payload as any).video
          : Array.isArray((payload as any).output)
          ? (payload as any).output.find((v: unknown) => typeof v === 'string' && v.startsWith('http'))
          : null;
      const normalizedVideo = normalizeVideoReference(maybeVideo) || extractHttpVideo(JSON.stringify(payload));
      if (normalizedVideo) {
        videos.push(normalizedVideo);
      }
    }
  }

  return { images, videos };
}

function extractHttpImage(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/https?:[^\s"']+\.(?:png|jpg|jpeg|gif|webp)/i);
  return match ? match[0] : null;
}

function extractHttpVideo(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(HTTP_VIDEO_REGEX);
  return match ? match[0] : null;
}

function normalizeImageReference(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('data:image/')) {
    const id = cacheDataUrl(value);
    if (!id) return null;
    return `/api/images/${id}`;
  }
  return value;
}

function normalizeVideoReference(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith('http') ? value : null;
}

function sanitizeText(text: string) {
  if (!text) return '';
  return text.replace(DATA_URL_REGEX, '[image]');
}

function createAgentLanguageModel(providerId: ProviderId, modelId: string) {
  const commonConfig = {
    model: modelId,
    temperature: 0,
    streaming: false,
  } as const;

  if (providerId === 'openai') {
    return new ChatOpenAI(commonConfig);
  }

  if (providerId === 'xai') {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error('XAI_API_KEY must be set to run the agent with xAI models.');
    }
    return new ChatXAI({ ...commonConfig, apiKey });
  }

  throw new Error(`Provider ${providerId} is not supported by the agent runtime.`);
}

function buildSystemPrompt() {
  const now = new Date();
  const timeZone = process.env.AGENT_TIMEZONE || DEFAULT_AGENT_TIMEZONE;
  const { readable, label } = formatDateInTimeZone(now, timeZone);

  return `${SYSTEM_PROMPT_BASE}
Current date/time: ${readable} (${label}, ${timeZone}).
Reference UTC timestamp: ${now.toISOString()}.
Interpret any relative date references (e.g., "tomorrow", "this weekend") using this timestamp unless the user specifies another date.`;
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const readable = formatter.format(date);
  const label = extractTimeZoneName(formatter, date) || timeZone;
  return { readable, label };
}

function extractTimeZoneName(formatter: Intl.DateTimeFormat, date: Date) {
  if (typeof formatter.formatToParts !== 'function') {
    return null;
  }

  const parts = formatter.formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === 'timeZoneName');
  return timeZoneName?.value ?? null;
}
