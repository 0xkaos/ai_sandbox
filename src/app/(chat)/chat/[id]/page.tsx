import { auth } from '@/lib/auth';
import { ensureUser, getChat, getChatMessages } from '@/lib/db/actions';
import { notFound, redirect } from 'next/navigation';
import { Chat } from '@/components/chat';
import type { ProviderId } from '@/lib/providers';
import { headers } from 'next/headers';

type ChatParams = { id: string };

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ChatPage({ params }: { params: ChatParams | Promise<ChatParams> }) {
  const headerList = await headers();
  const matchedPath = headerList.get('x-matched-path');
  const nextUrl = headerList.get('next-url');
  const referer = headerList.get('referer');

  const resolvedParams = await params;
  const chatId = resolvedParams?.id;

  if (!chatId) {
    console.warn('[ChatPage] Missing chat id', { matchedPath, nextUrl, referer, params: resolvedParams });
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

  console.log('[ChatPage] Fetching chat:', chatId, 'for user:', userId);
  const chat = await getChat(chatId, userId);
  
  if (!chat) {
    console.log('[ChatPage] Chat not found or access denied');
    return notFound();
  }

  const messages = await getChatMessages(chatId);
  console.log('[ChatPage] Found chat with', messages.length, 'messages');

  return (
    <Chat
      id={chat.id}
      initialMessages={messages as any}
      initialProvider={chat.provider as ProviderId}
      initialModel={chat.model}
    />
  );
}
