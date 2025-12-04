import { auth } from '@/lib/auth';
import { ensureUser, getChat, deleteChat } from '@/lib/db/actions';

type RouteContext = {
  params: { id: string } | Promise<{ id: string }>;
};

export async function DELETE(
  req: Request,
  { params }: RouteContext
) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return new Response('Unauthorized', { status: 401 });
    }

    const resolvedParams = await params;
    const chatId = resolvedParams?.id;
    if (!chatId) {
      return new Response('Chat ID is required', { status: 400 });
    }

    const userId = await ensureUser({
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });

    const chat = await getChat(chatId, userId);
    if (!chat) {
      return new Response('Chat not found', { status: 404 });
    }

    await deleteChat(chatId, userId);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[chat-delete] Failed to delete chat:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete chat' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
