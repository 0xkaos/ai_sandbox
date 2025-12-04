import { auth } from '@/lib/auth';
import { getChat, getChatMessages } from '@/lib/db/actions';
import { notFound, redirect } from 'next/navigation';
import { Chat } from '@/components/chat';

export default async function ChatPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return redirect('/');

  const chat = await getChat(params.id, session.user.id);
  if (!chat) return notFound();

  const messages = await getChatMessages(params.id);

  return <Chat id={chat.id} initialMessages={messages as any} />;
}
