import { streamText, convertToCoreMessages } from 'ai';
import { auth } from '@/lib/auth';
import { createChat, getChat, saveMessage, ensureUser } from '@/lib/db/actions';
import { resolveLanguageModel, normalizeModelSelection, DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, type ProviderId } from '@/lib/providers';

// Allow streaming responses up to 300 seconds (5 minutes)
export const maxDuration = 300;

const IMAGE_REQUEST_REGEX = /(generate|create|make|draw|render|paint|sketch|design)\s+(an?\s+)?(image|picture|art|illustration|concept|logo|poster)/i;
const IMAGE_TOOL_NUDGE = `The user explicitly requested an image. Select and invoke the best available image generation tool (OpenAI gpt-image-1, xAI Grok-2 Image, or Getimg Seedream v4) instead of replying with text. If their prompt lacks detail, elaborate on their concept with creative descriptors before calling the tool. If they provided detailed instructions, follow them exactly.`;

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      console.log('[chat-api] Unauthorized: No session or user ID');
      return new Response('Unauthorized', { status: 401 });
    }

    // Ensure user exists and get correct ID
    let userId = session.user.id;
    try {
      userId = await ensureUser({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      });
      console.log('[chat-api] User verified:', userId);
    } catch (dbError) {
      console.error('[chat-api] Database error ensuring user:', dbError);
      // Fallback to session ID if DB fails, but this might cause FK errors later
      // We'll proceed and see if we can at least log the error
    }

    const body = await req.json();
    const { messages, id, provider: requestedProvider, model: requestedModel } = body;
    const chatId = id;
    console.log('[chat-api] Processing request for chat:', chatId, 'User:', userId);
    
    if (!messages || !Array.isArray(messages)) {
      console.error('[chat-api] Invalid messages format:', messages);
      return new Response('Invalid messages format', { status: 400 });
    }

    // Check if chat exists, if not create it
    let providerId: ProviderId = DEFAULT_PROVIDER_ID;
    let modelId: string = DEFAULT_MODEL_ID;
    let existingChat: Awaited<ReturnType<typeof getChat>>;

    try {
      existingChat = await getChat(chatId, userId);
      if (!existingChat) {
        console.log('[chat-api] Creating new chat:', chatId);
        const firstMessageContent = messages[0]?.content;
        let title = 'New Chat';
        
        if (typeof firstMessageContent === 'string') {
          title = firstMessageContent.substring(0, 50);
        } else if (Array.isArray(firstMessageContent)) {
          const textPart = firstMessageContent.find((p: any) => p.type === 'text');
          if (textPart && textPart.text) {
            title = textPart.text.substring(0, 50);
          }
        }

        const normalized = normalizeModelSelection(requestedProvider, requestedModel);
        providerId = normalized.providerId;
        modelId = normalized.modelId;
        await createChat(userId, title, chatId, providerId, modelId);
      } else {
        providerId = (existingChat.provider as ProviderId) || DEFAULT_PROVIDER_ID;
        modelId = existingChat.model || DEFAULT_MODEL_ID;
      }
    } catch (chatError) {
      console.error('[chat-api] Error checking/creating chat:', chatError);
      // If this fails, we probably can't save messages either, but let's try to continue
      // to see if it's just a read error or a write error
    }

    let modelHandle;
    try {
      modelHandle = resolveLanguageModel(providerId, modelId);
    } catch (modelError) {
      console.error('[chat-api] Failed to resolve model', { providerId, modelId, error: modelError });
      return new Response('Model provider not available', { status: 500 });
    }

    // Save the user's new message
    const lastMessage = messages[messages.length - 1];
    console.log('[chat-api] Saving user message');
    try {
      await saveMessage(chatId, { 
        ...lastMessage, 
        id: lastMessage.id || crypto.randomUUID(),
        createdAt: new Date() 
      });
    } catch (error) {
      console.error('[chat-api] Error saving user message:', error);
    }

    // Convert to core messages for the AI SDK
    console.log('[chat-api] Normalizing messages for model');

    // Helper to sanitize tool invocations (remove large base64 data)
    const sanitizeToolInvocations = (invocations: any[]) => {
      if (!Array.isArray(invocations)) return undefined;
      return invocations.map((inv) => {
        if (!inv.result || typeof inv.result !== 'object') return inv;
        // Clone result to avoid mutating original
        const result = { ...inv.result };
        if (Array.isArray(result.images)) {
          result.images = result.images.map((img: any) => ({
            ...img,
            dataUrl: img.dataUrl?.startsWith('data:') ? '<base64_data_truncated>' : img.dataUrl
          }));
        }
        return { ...inv, result };
      });
    };

    // Helper to sanitize tool content (remove large base64 data from tool results)
    const sanitizeContent = (content: Array<{ type: 'text'; text: string }>, role: string): Array<{ type: 'text'; text: string }> => {
      if (role !== 'tool') return content;
      
      return content.map(part => {
        if (part.type === 'text' && (part.text.includes('data:image') || part.text.includes('"images"'))) {
          try {
            // Attempt to parse JSON and sanitize images
            const parsed = JSON.parse(part.text);
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.images)) {
              parsed.images = parsed.images.map((img: any) => ({
                ...img,
                dataUrl: img.dataUrl?.startsWith('data:') ? '<base64_data_truncated>' : img.dataUrl
              }));
              return { type: 'text' as const, text: JSON.stringify(parsed) };
            }
          } catch (e) {
            // Not JSON or failed to parse, return original (or maybe truncate if too long?)
            if (part.text.length > 10000) {
               return { type: 'text' as const, text: part.text.substring(0, 1000) + '... <truncated_large_content>' };
            }
          }
        }
        return part;
      });
    };

    let coreMessages = messages.map((m: any) => {
      const normalizedContent = normalizeToTextParts(m.parts ?? m.content);
      const sanitizedContent = sanitizeContent(normalizedContent, m.role);
      
      return {
        role: m.role,
        content: sanitizedContent,
        ...(m.toolInvocations ? { toolInvocations: sanitizeToolInvocations(m.toolInvocations) } : {}),
      };
    });

    if (userExplicitlyRequestedImage(messages)) {
      console.log('[chat-api] Image request detected, injecting tool nudge');
      coreMessages = [
        {
          role: 'system',
          content: [{ type: 'text', text: IMAGE_TOOL_NUDGE }],
        },
        ...coreMessages,
      ];
    }

    const trimmedCoreMessages = trimCoreMessages(coreMessages, 40);

    console.log('[chat-api] Streaming response', {
      totalMessages: coreMessages.length,
      lastRole: coreMessages[coreMessages.length - 1]?.role,
      providerId,
      modelId,
    });

    const result = streamText({
      model: modelHandle,
      messages: convertToCoreMessages(trimmedCoreMessages as any),
      onFinish: async ({ text, toolCalls }) => {
        console.log('[chat-api] Stream finished, saving assistant response');
        try {
          // Save assistant's response
          await saveMessage(chatId, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: text,
            toolInvocations: toolCalls as any,
            createdAt: new Date(),
          });
        } catch (e) {
          console.error('[chat-api] Error saving assistant response:', e);
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('[chat-api] Error processing request:', error);
    // Return a more detailed error response
    return new Response(JSON.stringify({ 
      error: 'Internal Server Error', 
      details: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function userExplicitlyRequestedImage(messages: any[]): boolean {
  const lastUserMessage = [...messages].reverse().find((m) => m?.role === 'user');
  if (!lastUserMessage) {
    return false;
  }

  const text = getPlainTextFromMessage(lastUserMessage);
  if (!text) {
    return false;
  }

  const explicitToolMention = /gpt[- ]?image|grok|getimg|image tool/i.test(text);
  const matched = IMAGE_REQUEST_REGEX.test(text) || explicitToolMention;
  if (matched) {
    console.log('[chat-api] Matched image keywords in user message', { text });
  }
  return matched;
}

function getPlainTextFromMessage(message: any): string {
  const parts = normalizeToTextParts(message?.parts ?? message?.content ?? '');
  return parts.map((part) => part.text).join(' ').trim();
}

function normalizeToTextParts(value: any): Array<{ type: 'text'; text: string }> {
  if (typeof value === 'string' && value.length > 0) {
    return [{ type: 'text', text: value }];
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((part) => {
        if (!part) return null;
        if (typeof part === 'string') {
          return { type: 'text', text: part };
        }
        if (part.type === 'text' && typeof part.text === 'string') {
          return { type: 'text', text: part.text };
        }
        if (typeof part.text === 'string') {
          return { type: 'text', text: part.text };
        }
        return null;
      })
      .filter(Boolean) as Array<{ type: 'text'; text: string }>;

    if (parts.length > 0) {
      return parts;
    }
  }

  return [{ type: 'text', text: '' }];
}

function trimCoreMessages(messages: any[], limit = 40) {
  if (messages.length <= limit) {
    return messages;
  }

  const keepIndexes = new Set<number>();
  const firstSystemIndex = messages.findIndex((message) => message.role === 'system');
  if (firstSystemIndex !== -1) {
    keepIndexes.add(firstSystemIndex);
  }

  const remainingSlots = Math.max(limit - keepIndexes.size, 0);
  const tailIndexes = messages.map((_, index) => index).slice(-remainingSlots);
  tailIndexes.forEach((index) => keepIndexes.add(index));

  return messages.filter((_, index) => keepIndexes.has(index));
}

function sanitizeForLog<T>(value: T): T {
  const seen = new WeakSet();

  const replacer = (_key: string, val: any): any => {
    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[circular]';
      seen.add(val);
    }

    if (Array.isArray(val)) {
      return val.map((item) => replacer('', item));
    }

    if (val && typeof val === 'object') {
      const cloned: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        if (k === 'dataUrl' || k === 'b64_json' || k === 'image') {
          cloned[k] = '[truncated]';
          continue;
        }
        cloned[k] = replacer(k, v);
      }
      return cloned;
    }

    return val;
  };

  return replacer('', value) as T;
}






