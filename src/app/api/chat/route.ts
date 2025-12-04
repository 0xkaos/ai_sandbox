import { openai } from '@ai-sdk/openai';
import { streamText, convertToCoreMessages } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const coreMessages = convertToCoreMessages(messages);

  console.log('[chat-api] received request', {
    totalMessages: coreMessages.length,
    lastRole: coreMessages[coreMessages.length - 1]?.role,
  });

  const result = streamText({
    model: openai('gpt-4o'),
    messages: coreMessages,
  });

  try {
    console.log('[chat-api] returning UI message stream response');
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('[chat-api] ui stream unavailable, falling back', error);
    return result.toTextStreamResponse();
  }
}
