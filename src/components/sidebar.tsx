'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

interface SidebarProps {
  chats: {
    id: string;
    title: string;
    createdAt: Date;
  }[];
}

export function Sidebar({ chats }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const handleDelete = async (chatId: string) => {
    setPendingDelete(chatId);
    try {
      const response = await fetch(`/api/chat/${chatId}`, { method: 'DELETE' });
      if (!response.ok) {
        console.error('Failed to delete chat', await response.text());
        return;
      }

      if (pathname === `/chat/${chatId}`) {
        router.push('/');
      }
      router.refresh();
    } catch (error) {
      console.error('Error deleting chat', error);
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="w-64 border-r h-full flex flex-col bg-muted/10 hidden md:flex">
      <div className="p-4 h-14 flex items-center border-b">
        <Link href="/" className="w-full">
          <Button variant="outline" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </Link>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {chats.map((chat) => {
          const isActive = pathname === `/chat/${chat.id}`;
          return (
            <div key={chat.id} className="flex items-center gap-1">
              <Link href={`/chat/${chat.id}`} className="flex-1 block">
                <Button 
                  variant={isActive ? "secondary" : "ghost"} 
                  className="w-full justify-start h-auto py-3 px-4"
                >
                  <MessageSquare className="h-4 w-4 mr-2 shrink-0" />
                  <span className="truncate text-sm font-normal">{chat.title}</span>
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleDelete(chat.id);
                }}
                disabled={pendingDelete === chat.id}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete chat</span>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
