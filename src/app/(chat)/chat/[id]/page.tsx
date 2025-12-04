import { auth } from '@/lib/auth';
import { ensureUser, getChat, getChatMessages } from '@/lib/db/actions';
import { notFound, redirect } from 'next/navigation';
import { Chat } from '@/components/chat';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ChatPage({ params }: { params: { id: string } }) {
  const headerList = await headers();
  const matchedPath = headerList.get('x-matched-path');
  const nextUrl = headerList.get('next-url');
  const referer = headerList.get('referer');

  if (!params?.id) {
    console.warn('[ChatPage] Missing chat id', { matchedPath, nextUrl, referer, params });
    return redirect('/');
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    console.log('[ChatPage] No session or user ID, redirecting');
    return redirect('/');
  }

  const userId = await ensureUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  console.log('[ChatPage] Fetching chat:', params.id, 'for user:', userId);
  const chat = await getChat(params.id, userId);
  
  if (!chat) {
    console.log('[ChatPage] Chat not found or access denied');
    return notFound();
  }

  const messages = await getChatMessages(params.id);
  console.log('[ChatPage] Found chat with', messages.length, 'messages');

  return <Chat id={chat.id} initialMessages={messages as any} />;
}
