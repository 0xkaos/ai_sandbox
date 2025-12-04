import { openai } from '@ai-sdk/openai';
import { streamText, convertToCoreMessages } from 'ai';
import { auth } from '@/lib/auth';
import { createChat, getChat, saveMessage, ensureUser } from '@/lib/db/actions';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

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
    const { messages, id } = body;
    const chatId = id;
    console.log('[chat-api] Processing request for chat:', chatId, 'User:', userId);
    
    if (!messages || !Array.isArray(messages)) {
      console.error('[chat-api] Invalid messages format:', messages);
      return new Response('Invalid messages format', { status: 400 });
    }

    // Check if chat exists, if not create it
    try {
      const existingChat = await getChat(chatId, userId);
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
        
        await createChat(userId, title, chatId);
      }
    } catch (chatError) {
      console.error('[chat-api] Error checking/creating chat:', chatError);
      // If this fails, we probably can't save messages either, but let's try to continue
      // to see if it's just a read error or a write error
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
    console.log('[chat-api] Converting messages');
    let coreMessages;
    try {
      coreMessages = convertToCoreMessages(messages.map((m: any) => {
        // Handle both content string and parts array
        const content = m.parts ? m.parts : m.content;
        return {
          role: m.role,
          content: content,
          toolInvocations: m.toolInvocations,
        };
      }) as any);
    } catch (convertError) {
      console.error('[chat-api] Error converting messages:', convertError);
      throw convertError;
    }

    console.log('[chat-api] Streaming response', {
      totalMessages: coreMessages.length,
      lastRole: coreMessages[coreMessages.length - 1]?.role,
    });

    const result = streamText({
      model: openai('gpt-4o'),
      messages: coreMessages,
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
