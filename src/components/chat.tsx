'use client';

import { useChat } from '@ai-sdk/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEffect, useMemo, useRef, useState } from 'react';
import { UIMessage } from '@ai-sdk/react';
import { useRouter } from 'next/navigation';
import { useChatSettings } from '@/components/chat-settings-provider';
import type { ProviderId } from '@/lib/providers';
import { TextStreamChatTransport } from 'ai';

type TextLikePart = { type?: string; text?: string };

const stripWrappingQuotes = (value: string) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseSsePayloadToText = (raw: string) => {
  if (!raw) return null;
  const normalized = stripWrappingQuotes(raw).replace(/\\n/g, '\n');
  if (!normalized.includes('data:')) {
    return null;
  }

  const segments = normalized
    .split('data:')
    .map((segment) => segment.trim())
    .filter(Boolean);

  let buffer = '';

  for (const segment of segments) {
    if (!segment || segment === '[DONE]') {
      continue;
    }

    const cleaned = segment.replace(/,$/, '');
    try {
      const payload = JSON.parse(cleaned);
      if (payload?.type === 'text-delta' && typeof payload.delta === 'string') {
        buffer += payload.delta;
      } else if (payload?.type === 'text' && typeof payload.text === 'string') {
        buffer += payload.text;
      }
    } catch {
      // Ignore non-JSON chunks (e.g., keep-alive pings)
      continue;
    }
  }

  if (buffer) {
    return buffer;
  }

  return segments.filter((segment) => segment !== '[DONE]').join(' ').trim() || null;
};

const collapseTextParts = (parts?: TextLikePart[]) => {
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
};

interface ChatProps {
  id?: string;
  initialMessages?: UIMessage[];
  initialProvider?: ProviderId;
  initialModel?: string;
}

export function Chat({ id, initialMessages = [], initialProvider, initialModel }: ChatProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const { provider, model, syncFromChat } = useChatSettings();

  // Generate a stable ID for new chats if one isn't provided
  const [generatedChatId] = useState(() => id || crypto.randomUUID());
  const activeChatId = id || generatedChatId;

  const transport = useMemo(
    () =>
      new TextStreamChatTransport({
        api: '/api/chat',
        body: () => ({
          provider,
          model,
        }),
      }),
    [model, provider]
  );

  const { messages, sendMessage, status } = useChat({
    id: activeChatId,
    messages: initialMessages,
    transport,
    onFinish: () => {
      // If we're on the home page (no ID prop), navigate to the chat page
      if (!id) {
        window.history.replaceState({}, '', `/chat/${activeChatId}`);
        syncFromChat({ chatId: activeChatId });
        router.refresh(); // Refresh to update sidebar
      }
    },
  });

  useEffect(() => {
    if (id) {
      syncFromChat({
        chatId: id,
        provider: initialProvider,
        model: initialModel,
      });
      return;
    }

    syncFromChat({ chatId: null });
  }, [id, initialModel, initialProvider, syncFromChat]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    const value = input;
    setInput('');
    
    // Use sendMessage which is available in this SDK version
    // We construct a user message object
    await sendMessage({
      role: 'user', 
      content: value 
    } as any);
  };

  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const getMessageText = (message: UIMessage) => {
    const msg = message as any;
    if (typeof msg.content === 'string') {
      const decoded = parseSsePayloadToText(msg.content);
      return decoded ?? msg.content;
    }

    const fromContent = collapseTextParts(msg.content);
    if (fromContent) {
      return fromContent;
    }

    return collapseTextParts(msg.parts);
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
