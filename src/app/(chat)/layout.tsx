import { auth } from '@/lib/auth';
import { ensureUser, getChats } from '@/lib/db/actions';
import { Sidebar } from '@/components/sidebar';
import { redirect } from 'next/navigation';
import { UserMenu } from '@/components/user-menu';
import { ChatSettingsProvider } from '@/components/chat-settings-provider';
import { RightSidebar } from '@/components/right-sidebar';
import { ModelSelectorDropdown } from '@/components/model-selector-dropdown';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    <ChatSettingsProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar chats={chats} />
        <div className="flex-1 flex flex-col h-full">
          <header className="h-14 border-b flex items-center justify-between px-4 gap-3 shrink-0">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold">AI Sandbox</h1>
              <ModelSelectorDropdown />
            </div>
            <UserMenu />
          </header>
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </div>
        <RightSidebar />
      </div>
    </ChatSettingsProvider>
  );
}
