'use client';

import { useChat } from '@ai-sdk/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEffect, useRef, useState } from 'react';

export default function ChatPage() {
  const chat = useChat();
  const { messages, sendMessage, status } = chat;
  const isLoading =
    typeof (chat as { isLoading?: boolean }).isLoading === 'boolean'
      ? Boolean((chat as { isLoading?: boolean }).isLoading)
      : status === 'streaming' || status === 'submitted';
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const getMessageText = (message: (typeof messages)[number]) => {
    const base = message as {
      content?: string;
      text?: string;
      parts?: Array<{ type?: string; text?: string } | string>;
    };

    if (typeof base.content === 'string') {
      return base.content;
    }

    if (typeof base.text === 'string') {
      return base.text;
    }

    if (Array.isArray(base.parts)) {
      const text = base.parts
        .map(part => {
          if (typeof part === 'string') {
            return part;
          }

          if (part?.type === 'text' && typeof part.text === 'string') {
            return part.text;
          }

          return '';
        })
        .filter(Boolean)
        .join(' ')
        .trim();

      if (text) {
        return text;
      }
    }

    return '[no content]';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    console.log('[chat-ui] sending message', input);
    await sendMessage({ text: input });
    setInput('');
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    console.log('[chat-ui] messages updated', messages);
    console.log('[chat-ui] status', status);
  }, [messages, status]);

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto p-4">
      <Card className="flex-1 p-4 mb-4 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {messages.map(m => {
              const messageText = getMessageText(m);
              return (
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
                    {messageText}
                  </div>
                </div>
              );
            })}
            {isLoading && (
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

      <form onSubmit={onSubmit} className="flex gap-2">
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
