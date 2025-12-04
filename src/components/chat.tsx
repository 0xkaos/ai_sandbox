'use client';

import { useChat } from '@ai-sdk/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEffect, useRef, useState } from 'react';
import { UIMessage } from '@ai-sdk/react';
import { useRouter } from 'next/navigation';

interface ChatProps {
  id?: string;
  initialMessages?: UIMessage[];
}

export function Chat({ id, initialMessages = [] }: ChatProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Generate a stable ID for new chats if one isn't provided
  const [chatId] = useState(() => id || crypto.randomUUID());

  const { messages, input, handleInputChange, handleSubmit, status } = useChat({
    id: chatId,
    initialMessages,
    onFinish: () => {
      // If we're on the home page (no ID prop), navigate to the chat page
      if (!id) {
        window.history.replaceState({}, '', `/chat/${chatId}`);
        router.refresh(); // Refresh to update sidebar
      }
    },
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const getMessageText = (message: UIMessage) => {
    if (message.content) return message.content;
    return message.parts
      ?.filter(part => part.type === 'text')
      .map(part => (part as any).text)
      .join('') || '';
  };

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-4 w-full">
      <Card className="flex-1 p-4 mb-4 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {messages.map((m: UIMessage) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`rounded-lg px-4 py-2 max-w-[80%] ${
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {getMessageText(m)}
                </div>
              </div>
            ))}
            {status === 'submitted' && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-2">
                  Thinking...
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
      </Card>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Say something..."
          disabled={isLoading}
        />
        <Button type="submit" disabled={isLoading}>
          Send
        </Button>
      </form>
    </div>
  );
}
