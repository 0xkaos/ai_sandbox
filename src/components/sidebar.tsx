'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MessageSquare, Plus } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface SidebarProps {
  chats: {
    id: string;
    title: string;
    createdAt: Date;
  }[];
}

export function Sidebar({ chats }: SidebarProps) {
  const pathname = usePathname();

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
            <Link key={chat.id} href={`/chat/${chat.id}`} className="block">
              <Button 
                variant={isActive ? "secondary" : "ghost"} 
                className="w-full justify-start h-auto py-3 px-4"
              >
                <MessageSquare className="h-4 w-4 mr-2 shrink-0" />
                <span className="truncate text-sm font-normal">{chat.title}</span>
              </Button>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
