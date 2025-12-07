'use client';

import { useChat } from '@ai-sdk/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEffect, useMemo, useRef, useState } from 'react';
import { UIMessage } from '@ai-sdk/react';
import { useChatSettings } from '@/components/chat-settings-provider';
import type { ProviderId } from '@/lib/providers';
import { getModelMetadata } from '@/lib/providers';
import { TextStreamChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type TextLikePart = { type?: string; text?: string };

type ToolInvocation = {
  result?: unknown;
};

type AgentEvent = {
  type: 'tool-start' | 'tool-result' | 'final';
  name?: string | null;
  images?: string[];
  videos?: string[];
  text?: string | null;
  args?: Record<string, unknown>;
  error?: string | null;
  durationMs?: number;
  ts?: number;
};

const stripWrappingQuotes = (value: string) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const DATA_URL_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
const HTTP_IMAGE_REGEX = /(https?:\/\/\S+\.(?:png|jpe?g|webp|gif))/gi;
const HTTP_VIDEO_REGEX = /(https?:\/\/\S+\.(?:mp4|webm|mov|m4v|mkv))/gi;

const parseSsePayloadToText = (raw: string) => {
  if (!raw || raw.indexOf('data:') === -1) {
    return null;
  }

  const normalized = stripWrappingQuotes(raw).replace(/\n/g, '\n');
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
    if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) {
      continue;
    }

    try {
      const payload = JSON.parse(cleaned);
      if (payload?.type === 'text-delta' && typeof payload.delta === 'string') {
        buffer += payload.delta;
      } else if (payload?.type === 'text' && typeof payload.text === 'string') {
        buffer += payload.text;
      }
    } catch {
      continue;
    }
  }

  return buffer || null;
};

const isLikelySsePayload = (value: string) => {
  if (!value.includes('data:')) return false;
  if (value.trim().startsWith('data:image/')) return false;
  // Heuristic: any SSE-style JSON frame with a type field (start/text/text-delta/error/etc.).
  return /data:\s*\{[^}]*"type"\s*:\s*"[A-Za-z0-9_-]+"/.test(value);
};

const formatDuration = (ms?: number) => {
  if (ms === undefined || ms === null) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatTimestamp = (ts?: number) => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const decodeTextSnippet = (value?: string) => {
  if (typeof value !== 'string') {
    return '';
  }

  const decoded = parseSsePayloadToText(value);
  if (decoded !== null) {
    return decoded;
  }

  // Do not hide data URLs or plain strings that happen to contain "data:"
  if (isLikelySsePayload(value)) {
    return '';
  }

  return value;
};

const collapseTextParts = (parts?: TextLikePart[]) => {
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => decodeTextSnippet(part.text))
    .join('');
};

const extractImagesFromText = (value: string) => {
  const images: string[] = [];
  for (const match of value.matchAll(DATA_URL_REGEX)) {
    images.push(match[0]);
  }
  for (const match of value.matchAll(HTTP_IMAGE_REGEX)) {
    images.push(match[0]);
  }
  return images;
};

const extractImagesFromToolInvocations = (toolInvocations: unknown): string[] => {
  if (!Array.isArray(toolInvocations)) return [];

  const images: string[] = [];

  for (const invocation of toolInvocations as ToolInvocation[]) {
    const result = invocation?.result;
    if (!result) continue;

    let payload: any = result;
    if (typeof result === 'string') {
      try {
        payload = JSON.parse(result);
      } catch {
        // If it is just a raw data URL string, handle directly.
        if (typeof result === 'string' && result.startsWith('data:image/')) {
          images.push(result);
        }
        continue;
      }
    }

    if (Array.isArray(payload?.images)) {
      for (const img of payload.images) {
        if (typeof img === 'string' && img.startsWith('data:image/')) {
          images.push(img);
        }
        if (img && typeof img === 'object' && typeof img.dataUrl === 'string') {
          images.push(img.dataUrl);
        }
        if (img && typeof img === 'object' && typeof img.url === 'string') {
          images.push(img.url);
        }
        if (typeof img === 'string' && /^https?:\/\//.test(img)) {
          images.push(img);
        }
      }
    }
  }

  return images;
};

const extractVideosFromText = (value: string) => {
  const videos: string[] = [];
  for (const match of value.matchAll(HTTP_VIDEO_REGEX)) {
    videos.push(match[0]);
  }
  return videos;
};

const extractVideosFromToolInvocations = (toolInvocations: unknown): string[] => {
  if (!Array.isArray(toolInvocations)) return [];

  const videos: string[] = [];

  for (const invocation of toolInvocations as ToolInvocation[]) {
    const result = invocation?.result;
    if (!result) continue;

    let payload: any = result;
    if (typeof result === 'string') {
      try {
        payload = JSON.parse(result);
      } catch {
        if (typeof result === 'string' && result.startsWith('http')) {
          videos.push(result);
        }
        continue;
      }
    }

    if (Array.isArray(payload?.videos)) {
      for (const vid of payload.videos) {
        if (typeof vid === 'string' && vid.startsWith('http')) {
          videos.push(vid);
        }
        if (vid && typeof vid === 'object' && typeof vid.url === 'string') {
          videos.push(vid.url);
        }
        if (vid && typeof vid === 'object' && typeof (vid as any).videoUrl === 'string') {
          videos.push((vid as any).videoUrl);
        }
      }
    }

    if (payload && typeof payload === 'object') {
      if (typeof (payload as any).videoUrl === 'string') {
        videos.push((payload as any).videoUrl);
      }
      if (typeof (payload as any).video === 'string') {
        videos.push((payload as any).video);
      }
      if (typeof (payload as any).url === 'string' && (payload as any).url.startsWith('http') && HTTP_VIDEO_REGEX.test((payload as any).url)) {
        videos.push((payload as any).url);
      }
    }
  }

  return videos;
};

const normalizeMessage = (message: UIMessage) => {
  const msg = message as any;

  const collectText = () => {
    if (typeof msg.content === 'string') {
      return decodeTextSnippet(msg.content);
    }

    const fromContent = collapseTextParts(msg.content);
    if (fromContent) {
      return fromContent;
    }

    return collapseTextParts(msg.parts);
  };

  const text = collectText();
  const images = [
    ...extractImagesFromText(text),
    ...extractImagesFromToolInvocations(msg.toolInvocations),
  ];
  const videos = [
    ...extractVideosFromText(text),
    ...extractVideosFromToolInvocations(msg.toolInvocations),
  ];
  const textWithoutMedia = images.length || videos.length
    ? text
        .replace(DATA_URL_REGEX, '')
        .replace(HTTP_IMAGE_REGEX, '')
        .replace(HTTP_VIDEO_REGEX, '')
        .trim()
    : text;

  return { text: textWithoutMedia, images, videos };
};

interface ChatProps {
  id?: string;
  initialMessages?: UIMessage[];
  initialProvider?: ProviderId;
  initialModel?: string;
}

export function Chat({ id, initialMessages = [], initialProvider, initialModel }: ChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [ephemeralImages, setEphemeralImages] = useState<string[]>([]);
  const [ephemeralVideos, setEphemeralVideos] = useState<string[]>([]);
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
      // Rely on SSE + stream for live updates; no router refresh
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

  useEffect(() => {
    if (!activeChatId) return;
    const es = new EventSource(`/api/agent-events/${activeChatId}`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as AgentEvent;
        if (!data || !data.type) return;
        if (data.type === 'tool-result' && Array.isArray(data.images) && data.images.length > 0) {
          // Debug visibility: log tool-result images for live inline rendering issues
          console.debug('[agent-events] tool-result images', data.images);
          setEphemeralImages((prev) => {
            const next = new Set(prev);
            data.images?.forEach((img) => next.add(img));
            return Array.from(next);
          });
        }
        if (data.type === 'tool-result' && Array.isArray(data.videos) && data.videos.length > 0) {
          console.debug('[agent-events] tool-result videos', data.videos);
          setEphemeralVideos((prev) => {
            const next = new Set(prev);
            data.videos?.forEach((vid) => next.add(vid));
            return Array.from(next);
          });
        }
        setAgentEvents((prev) => [...prev.slice(-20), data]);
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [activeChatId]);

  // Keep ephemeral images visible until the chat reloads; avoids premature clearing when older messages already contain images.

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
              const { text, images, videos } = normalizeMessage(m);
              if (m.role !== 'user' && !text.trim() && images.length === 0 && videos.length === 0) {
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
                    {text.trim() && (
                      m.role === 'user' ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {text}
                        </p>
                      ) : (
                        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>a]:underline">
                          <ReactMarkdown remarkPlugins={markdownPlugins}>{text}</ReactMarkdown>
                        </div>
                      )
                    )}
                    {images.length > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-3">
                        {images.map((src, idx) => (
                          <img
                            key={`${m.id}-img-${idx}`}
                            src={src}
                            alt="Generated"
                            className="rounded-md border shadow-sm"
                            loading="lazy"
                          />
                        ))}
                      </div>
                    )}
                    {videos.length > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-3">
                        {videos.map((src, idx) => (
                          <video
                            key={`${m.id}-vid-${idx}`}
                            src={src}
                            controls
                            className="rounded-md border shadow-sm"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {ephemeralImages.length > 0 && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-2 w-full">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Images (pending save)</div>
                  <div className="grid grid-cols-1 gap-3">
                    {ephemeralImages.map((src, idx) => (
                      <img
                        key={`ephemeral-${idx}`}
                        src={src}
                        alt="Generated"
                        className="rounded-md border shadow-sm"
                        loading="lazy"
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            {ephemeralVideos.length > 0 && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-2 w-full">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Videos (pending save)</div>
                  <div className="grid grid-cols-1 gap-3">
                    {ephemeralVideos.map((src, idx) => (
                      <video
                        key={`ephemeral-vid-${idx}`}
                        src={src}
                        controls
                        className="rounded-md border shadow-sm"
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            {status === 'submitted' && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-2">
                  Thinking...
                </div>
              </div>
            )}
            <div ref={scrollRef} />
            {agentEvents.length > 0 && (
              <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-2 bg-muted/50">
                <div className="font-semibold text-foreground text-sm">Agent Console</div>
                {agentEvents.map((evt, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="uppercase tracking-wide text-[11px] text-muted-foreground">{evt.type}</span>
                      {evt.name && <span className="text-foreground">{evt.name}</span>}
                      {evt.durationMs !== undefined && evt.durationMs !== null && (
                        <span className="text-[11px] text-muted-foreground">{formatDuration(evt.durationMs)}</span>
                      )}
                      {evt.ts && <span className="text-[11px] text-muted-foreground">{formatTimestamp(evt.ts)}</span>}
                    </div>
                    {evt.args && (
                      <pre className="bg-background/60 rounded border px-2 py-1 text-[11px] overflow-x-auto">
                        {JSON.stringify(evt.args, null, 2)}
                      </pre>
                    )}
                    {evt.error && <div className="text-destructive">{evt.error}</div>}
                    {evt.text && <div className="text-foreground break-words">{evt.text}</div>}
                  </div>
                ))}
              </div>
            )}
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
