import { randomUUID } from 'node:crypto';
import { createAgent } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { ChatXAI } from '@langchain/xai';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { ProviderId } from '@/lib/providers';
import { buildAgentTools } from '@/lib/agent/tools';

const textEncoder = new TextEncoder();
const AGENT_ALLOWED_PROVIDERS: ProviderId[] = ['openai', 'xai'];
const DEFAULT_AGENT_TIMEZONE = 'America/New_York';
const SYSTEM_PROMPT_BASE = `You are an autonomous AI teammate that can read and write the user's Google Calendar and generate images via OpenAI (gpt-image-1), xAI (Grok-2 Image), or Getimg (Seedream v4).

Tooling policies:
- If the user asks for calendar information, always consult the calendar tools instead of guessing and clearly describe any modifications you make.
- If the user asks for an image, you must call the most appropriate image generation tool. When their prompt is vague, synthesize a vivid, detailed prompt that reflects their intent (style, subject, lighting, medium). When the user already provides specific guidance, follow it precisely.
- After every tool invocation, summarize the result so the user knows what happened.`;

export type CoreTextPart = { type: 'text'; text: string };
export type CoreChatMessage = {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | CoreTextPart[];
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
};

export function agentToolsEnabled() {
  return process.env.AGENT_TOOLS_ENABLED === 'true';
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
}): Promise<AgentRunResult> {
  const { userId, providerId, modelId, messages } = params;
  const imageStore = new Map<string, string>();
  const tools = buildAgentTools(userId, imageStore);

  if (tools.length === 0) {
    throw new Error('No tools are currently configured for the agent.');
  }

  const model = createAgentLanguageModel(providerId, modelId);

  const agent = createAgent({
    model,
    tools,
    systemPrompt: buildSystemPrompt(),
  });

  const lcMessages = convertMessagesToLangChain(messages);
  const agentState = await agent.invoke({ messages: lcMessages });

  const finalAiMessage = extractLatestAiMessage(agentState.messages);

  if (!finalAiMessage) {
    throw new Error('Agent did not return a response.');
  }

  const toolInvocations = extractToolInvocations(agentState.messages);
  hydrateToolImageResults(toolInvocations, imageStore);

  const finalText = getMessageText(finalAiMessage);
  const { text: cleanedText, strippedStoredToken } = stripStoredImagePlaceholders(
    finalText,
    toolInvocations,
    imageStore
  );
  const safeFinalText = buildAgentResponseText(cleanedText, toolInvocations, {
    strippedStoredToken,
  });

  return { stream: buildTextStream(safeFinalText), finalText: safeFinalText, toolInvocations };
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
      let result: unknown = getMessageText(message);
      try {
        if (typeof result === 'string') {
          const parsed = JSON.parse(result);
          result = parsed;
        }
      } catch {
        // ignore
      }

      logs.push({
        toolCallId: message.tool_call_id ?? null,
        name: message.name ?? callMeta?.name ?? null,
        args: callMeta?.args,
        result,
        error: message.status === 'error' ? getMessageText(message) : undefined,
      });
    }
  }

  return logs;
}

function buildAgentResponseText(
  text: string,
  toolInvocations: AgentToolInvocationLog[],
  options?: { strippedStoredToken?: boolean }
) {
  const trimmed = text?.trim();
  if (trimmed) {
    if (options?.strippedStoredToken && hasImageResults(toolInvocations)) {
      return `${trimmed}\n\nImages attached below.`.trim();
    }
    return trimmed;
  }

  if (!toolInvocations || toolInvocations.length === 0) {
    console.warn('[agent-runtime] No final text or tool invocations returned; using generic completion message.');
    return 'Completed the requested action.';
  }

  if (hasImageResults(toolInvocations)) {
    return 'Generated image results are attached below.';
  }

  const summaries = toolInvocations.map((invocation) => {
    const name = invocation.name ?? 'tool';
    if (invocation.error) {
      return `${name} failed: ${invocation.error}`;
    }
    
    const resultObj = invocation.result as any;
    if (resultObj?.provider && resultObj?.model) {
      return `Generated output with ${resultObj.provider} (${resultObj.model}).`;
    }
    
    return `${name} completed successfully.`;
  });

  const synthesized = summaries.join('\n');
  console.warn('[agent-runtime] Synthesized response from tool activity', synthesized);
  return synthesized;
}

function stripStoredImagePlaceholders(
  text: string,
  toolInvocations: AgentToolInvocationLog[],
  imageStore?: Map<string, string>
) {
  if (!text) {
    return { text: '', strippedStoredToken: false };
  }

  let strippedStoredToken = false;
  const replaced = text.replace(/<stored:([a-zA-Z0-9-]+)>/g, (_match, imageId) => {
    strippedStoredToken = true;
    // We intentionally avoid inlining base64 back into the text to keep messages small.
    // Presence in the store or invocations indicates we can render the image elsewhere.
    if (imageStore?.has(imageId)) {
      return '';
    }

    const hasInvocationImage = toolInvocations.some((inv) => {
      const result = inv?.result as any;
      return Array.isArray(result?.images) && result.images.some((img: any) => img?.imageId === imageId);
    });

    return hasInvocationImage ? '' : _match;
  });

  return { text: replaced.trim(), strippedStoredToken };
}

function hydrateToolImageResults(toolInvocations: AgentToolInvocationLog[], imageStore: Map<string, string>) {
  toolInvocations.forEach((inv) => {
    if (inv.result && typeof inv.result === 'object' && 'images' in inv.result && Array.isArray((inv.result as any).images)) {
      (inv.result as any).images.forEach((img: any) => {
        if (img.imageId && imageStore.has(img.imageId)) {
          img.dataUrl = imageStore.get(img.imageId);
        }
      });
    }
  });
}

function hasImageResults(toolInvocations: AgentToolInvocationLog[]) {
  return toolInvocations.some((inv) => {
    const result = inv?.result as any;
    return Array.isArray(result?.images) && result.images.length > 0;
  });
}

function buildTextStream(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(textEncoder.encode(text));
      controller.close();
    },
  });
}

function buildAgentErrorText(error: unknown) {
  const base = 'Tool-assisted response failed.';
  if (!error) return base;
  if (error instanceof Error) {
    return `${base} ${error.message}`.trim();
  }
  return `${base} ${String(error)}`.trim();
}

function createAgentLanguageModel(providerId: ProviderId, modelId: string) {
  const commonConfig = {
    model: modelId,
    temperature: 0,
    streaming: false,
  } as const;

  if (providerId === 'openai') {
    const normalizedModel = normalizeOpenAiAgentModel(modelId);
    return new ChatOpenAI({ ...commonConfig, model: normalizedModel });
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

function normalizeOpenAiAgentModel(modelId: string) {
  const fallback = process.env.AGENT_OPENAI_MODEL || 'gpt-4o';
  const allowedChatModels = new Set([
    'gpt-5.1',
    'gpt-5.1-mini',
    'gpt-5',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-3.5-turbo',
  ]);

  if (allowedChatModels.has(modelId)) {
    return modelId;
  }

  console.warn('[agent-runtime] Model not chat-compatible for tools, falling back', {
    requested: modelId,
    fallback,
  });
  return fallback;
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
