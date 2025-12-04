import { auth } from '@/lib/auth';
import { getChat, getChatMessages } from '@/lib/db/actions';
import { notFound, redirect } from 'next/navigation';
import { Chat } from '@/components/chat';

export default async function ChatPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    console.log('[ChatPage] No session or user ID, redirecting');
    return redirect('/');
  }

  console.log('[ChatPage] Fetching chat:', params.id, 'for user:', session.user.id);
  const chat = await getChat(params.id, session.user.id);
  
  if (!chat) {
    console.log('[ChatPage] Chat not found or access denied');
    return notFound();
  }

  const messages = await getChatMessages(params.id);
  console.log('[ChatPage] Found chat with', messages.length, 'messages');

  return <Chat id={chat.id} initialMessages={messages as any} />;
}
