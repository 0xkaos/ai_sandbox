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
const SYSTEM_PROMPT_BASE = `You are an autonomous AI teammate that can read and write the user's Google Calendar.
If the user asks for calendar information, prefer using the calendar tools instead of guessing.
Be explicit about any changes you make.`;

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
  const tools = buildAgentTools(userId);

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
    throw new Error('Agent did not return an assistant message.');
  }

  const finalText = getMessageText(finalAiMessage);
  const toolInvocations = extractToolInvocations(agentState.messages);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(textEncoder.encode(finalText));
      controller.close();
    },
  });

  return { stream, finalText, toolInvocations };
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
