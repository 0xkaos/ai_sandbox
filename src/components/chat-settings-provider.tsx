'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import type { ProviderId } from '@/lib/providers';
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID } from '@/lib/providers';

interface ChatSettingsValue {
  provider: ProviderId;
  model: string;
  chatId: string | null;
  setProvider: (provider: ProviderId) => void;
  setModel: (model: string) => void;
  syncFromChat: (options: { provider?: ProviderId; model?: string; chatId?: string | null }) => void;
}

const ChatSettingsContext = createContext<ChatSettingsValue | undefined>(undefined);

export function ChatSettingsProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER_ID);
  const [model, setModel] = useState<string>(DEFAULT_MODEL_ID);
  const [chatId, setChatId] = useState<string | null>(null);

  const syncFromChat = useCallback(
    ({ provider: nextProvider, model: nextModel, chatId: nextChatId }: { provider?: ProviderId; model?: string; chatId?: string | null }) => {
      if (nextProvider) {
        setProvider(nextProvider);
      }
      if (nextModel) {
        setModel(nextModel);
      }
      if (typeof nextChatId !== 'undefined') {
        setChatId(nextChatId);
      }
    },
    []
  );

  return (
    <ChatSettingsContext.Provider value={{ provider, model, chatId, setProvider, setModel, syncFromChat }}>
      {children}
    </ChatSettingsContext.Provider>
  );
}

export function useChatSettings() {
  const context = useContext(ChatSettingsContext);
  if (!context) {
    throw new Error('useChatSettings must be used within ChatSettingsProvider');
  }
  return context;
}
