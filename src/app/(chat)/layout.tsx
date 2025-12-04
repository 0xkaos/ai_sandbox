import { auth } from '@/lib/auth';
import { ensureUser, getChats } from '@/lib/db/actions';
import { Sidebar } from '@/components/sidebar';
import { redirect } from 'next/navigation';
import { UserMenu } from '@/components/user-menu';

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    redirect('/api/auth/signin');
  }

  const userId = await ensureUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const chats = await getChats(userId);
  console.log('[ChatLayout] Loaded', chats.length, 'chats for user', userId);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar chats={chats} />
      <div className="flex-1 flex flex-col h-full">
        <header className="h-14 border-b flex items-center justify-between px-4 shrink-0">
          <h1 className="text-lg font-semibold">AI Sandbox</h1>
          <UserMenu />
        </header>
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
