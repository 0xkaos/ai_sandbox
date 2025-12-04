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

  const maybeDataStream = result as typeof result & {
    toDataStreamResponse?: () => Response;
  };

  const hasDataStream = typeof maybeDataStream.toDataStreamResponse === 'function';
  console.log('[chat-api] stream capabilities', { hasDataStream });

  if (hasDataStream) {
    console.log('[chat-api] using data stream response');
    return maybeDataStream.toDataStreamResponse();
  }

  console.log('[chat-api] falling back to text stream response');
  return result.toTextStreamResponse();
}
