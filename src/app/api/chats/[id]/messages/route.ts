import { auth } from '@/lib/auth';
import { getChatMessages } from '@/lib/db/actions';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;

  try {
    const messages = await getChatMessages(id);
    return Response.json({ messages });
  } catch (error) {
    console.error('[chat-messages-api] Failed to load messages for chat', id, error);
    return new Response('Failed to load messages', { status: 500 });
  }
}
