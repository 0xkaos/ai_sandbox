'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChatSettings } from '@/components/chat-settings-provider';
import type { ProviderId } from '@/lib/providers';

export function useModelSelection() {
  const { provider, model, chatId, setProvider, setModel } = useChatSettings();
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const selectModel = useCallback(
    async (nextProvider: ProviderId, nextModel: string) => {
      if (provider === nextProvider && model === nextModel) {
        return;
      }

      setProvider(nextProvider);
      setModel(nextModel);

      if (!chatId) {
        return;
      }

      setIsSaving(true);
      try {
        const response = await fetch(`/api/chat/${chatId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ provider: nextProvider, model: nextModel }),
        });

        if (!response.ok) {
          console.error('Failed to update chat model', await response.text());
          return;
        }

        router.refresh();
      } catch (error) {
        console.error('Error updating chat model', error);
      } finally {
        setIsSaving(false);
      }
    },
    [chatId, model, provider, router, setModel, setProvider]
  );

  return {
    provider,
    model,
    chatId,
    isSaving,
    selectModel,
  };
}
