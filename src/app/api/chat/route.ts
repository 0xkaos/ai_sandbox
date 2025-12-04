import { openai } from '@ai-sdk/openai';
import { streamText, convertToCoreMessages } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const coreMessages = convertToCoreMessages(messages);

  const result = streamText({
    model: openai('gpt-4o'),
    messages: coreMessages,
  });

  const maybeDataStream = result as typeof result & {
    toDataStreamResponse?: () => Response;
  };

  if (typeof maybeDataStream.toDataStreamResponse === 'function') {
    return maybeDataStream.toDataStreamResponse();
  }

  return result.toTextStreamResponse();
}
