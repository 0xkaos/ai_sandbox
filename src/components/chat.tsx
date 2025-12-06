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
import { getModelMetadata } from '@/lib/providers';
import { TextStreamChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type TextLikePart = { type?: string; text?: string };

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
  const modelMetadata = useMemo(() => getModelMetadata(provider, model), [model, provider]);
  const markdownPlugins = useMemo(() => [remarkGfm], []);

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
      if (!id) {
        window.history.replaceState({}, '', `/chat/${activeChatId}`);
        syncFromChat({ chatId: activeChatId });
      }
      // Do not router.refresh() here; let streaming state stay in the client
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
      return msg.content;
    }

    const parts = (Array.isArray(msg.content) ? msg.content : msg.parts) as TextLikePart[] | undefined;
    if (!Array.isArray(parts)) return '';

    return parts
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('');
  };

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-4 w-full">
      <Card className="flex-1 p-4 mb-4 overflow-hidden flex flex-col min-h-0">
        <ScrollArea className="flex-1 pr-4 min-h-0">
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="uppercase tracking-wide">Model</span>
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span>{modelMetadata?.label ?? model}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground border px-1.5 py-0.5 rounded">
                  {modelMetadata?.providerId ?? provider}
                </span>
              </div>
            </div>
            {messages.map((m: UIMessage) => {
              const text = getMessageText(m);
              const toolInvocations = (m as any).toolInvocations;
              const hasImageOutputs = hasImageResult(toolInvocations);
              if (m.role !== 'user' && !text.trim() && !hasImageOutputs) {
                return null;
              }

              return (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`rounded-lg px-4 py-2 max-w-[80%] break-words ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {text}
                      </p>
                    ) : (
                      <div className="text-sm leading-relaxed whitespace-pre-wrap break-words [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>a]:underline">
                        <ReactMarkdown remarkPlugins={markdownPlugins}>{text}</ReactMarkdown>
                        <ImageToolOutputs rawInvocations={toolInvocations} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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

type ToolInvocationLike = {
  name?: string | null;
  args?: Record<string, unknown> | null;
  result?: unknown;
  error?: string;
};

type ImageGenerationResult = {
  key: string;
  provider: string;
  model: string;
  prompt?: string | null;
  revisedPrompt?: string | null;
  images: Array<{ url: string; index: number; revisedPrompt?: string | null }>;
};

function ImageToolOutputs({ rawInvocations }: { rawInvocations: unknown }) {
  const results = useMemo(() => extractImageResults(rawInvocations), [rawInvocations]);

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-3">
      {results.map((result) => (
        <div key={result.key} className="rounded-md border border-border bg-background/80 text-foreground p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>{result.provider}</span>
            <span className="text-[11px] font-medium">{result.model}</span>
          </div>
          {(result.prompt || result.revisedPrompt) && (
            <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
              <strong className="font-semibold text-foreground">Prompt:</strong>{' '}
              {result.revisedPrompt ?? result.prompt}
            </p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {result.images.map((image) => (
              <div key={`${result.key}-${image.index}`} className="overflow-hidden rounded-md border bg-background">
                <img src={image.url} alt={result.revisedPrompt ?? result.prompt ?? 'Generated image'} className="w-full h-auto object-cover" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function extractImageResults(rawInvocations: unknown): ImageGenerationResult[] {
  const invocations = normalizeToolInvocations(rawInvocations);
  const results: ImageGenerationResult[] = [];

  invocations.forEach((invocation, index) => {
    if (!invocation || invocation.error) {
      return;
    }

    const parsed = parseToolResult(invocation.result);
    if (!parsed || !Array.isArray(parsed.images) || parsed.images.length === 0) {
      return;
    }

    const images = parsed.images
      .map((image: any, imageIndex: number) => {
        const url = typeof image?.dataUrl === 'string' ? image.dataUrl : typeof image?.url === 'string' ? image.url : null;
        if (!url) {
          return null;
        }
        return {
          url,
          index: typeof image?.index === 'number' ? image.index : imageIndex,
          revisedPrompt: image?.revisedPrompt ?? parsed?.revisedPrompt ?? null,
        };
      })
      .filter(Boolean) as Array<{ url: string; index: number; revisedPrompt?: string | null }>;

    if (images.length === 0) {
      return;
    }

    results.push({
      key: `${invocation.name ?? 'image'}-${index}`,
      provider: String(parsed.provider ?? invocation.name ?? 'image-tool').toUpperCase(),
      model: String(parsed.model ?? 'unknown'),
      prompt: parsed.prompt ?? (invocation.args && typeof invocation.args.prompt === 'string' ? invocation.args.prompt : null),
      revisedPrompt: parsed.revisedPrompt ?? images[0]?.revisedPrompt ?? null,
      images,
    });
  });

  return results;
}

function hasImageResult(rawInvocations: unknown) {
  return extractImageResults(rawInvocations).length > 0;
}

function normalizeToolInvocations(raw: unknown): ToolInvocationLike[] {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw as ToolInvocationLike[];
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ToolInvocationLike[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function parseToolResult(result: unknown) {
  if (!result) {
    return null;
  }

  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  if (typeof result === 'object') {
    return result as Record<string, unknown>;
  }

  return null;
}
