import { openai } from '@ai-sdk/openai';
import { streamText, convertToCoreMessages, Message } from 'ai';
import { auth } from '@/lib/auth';
import { createChat, getChat, saveMessage } from '@/lib/db/actions';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages, id } = await req.json();
  const chatId = id;

  // Check if chat exists, if not create it
  const existingChat = await getChat(chatId, session.user.id);
  if (!existingChat) {
    const title = messages[0]?.content.substring(0, 50) || 'New Chat';
    await createChat(session.user.id, title, chatId);
  }

  // Save the user's new message
  const lastMessage = messages[messages.length - 1];
  await saveMessage(chatId, { ...lastMessage, createdAt: new Date() });

  const coreMessages = convertToCoreMessages(messages);

  console.log('[chat-api] received request', {
    totalMessages: coreMessages.length,
    lastRole: coreMessages[coreMessages.length - 1]?.role,
  });

  const result = streamText({
    model: openai('gpt-4o'),
    messages: coreMessages,
    onFinish: async ({ text, toolCalls }) => {
      // Save assistant's response
      await saveMessage(chatId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: text,
        toolInvocations: toolCalls as any,
        createdAt: new Date(),
      } as Message);
    },
  });

  return result.toDataStreamResponse();
}
