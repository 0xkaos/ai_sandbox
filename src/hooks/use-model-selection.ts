'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChatSettings } from '@/components/chat-settings-provider';
import type { ProviderId } from '@/lib/providers';

export function useModelSelection() {
  const {
    provider,
    model,
    chatId,
    setProvider,
    setModel,
    isModelSaving,
    setIsModelSaving,
    selectionError,
    setSelectionError,
  } = useChatSettings();
  const router = useRouter();

  const selectModel = useCallback(
    async (nextProvider: ProviderId, nextModel: string) => {
      if (provider === nextProvider && model === nextModel) {
        return;
      }

      setSelectionError(null);
      const previousProvider = provider;
      const previousModel = model;

      setProvider(nextProvider);
      setModel(nextModel);

      if (!chatId) {
        return;
      }

      setIsModelSaving(true);
      try {
        const response = await fetch(`/api/chat/${chatId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ provider: nextProvider, model: nextModel }),
        });

        if (!response.ok) {
          const errorPayload = await response.text();
          throw new Error(errorPayload || 'Failed to update chat model');
        }

        router.refresh();
      } catch (error) {
        console.error('Error updating chat model', error);
        setProvider(previousProvider);
        setModel(previousModel);
        setSelectionError('Unable to switch models. Staying on the previous selection.');
      } finally {
        setIsModelSaving(false);
      }
    },
    [chatId, model, provider, router, setModel, setProvider, setIsModelSaving, setSelectionError]
  );

  return {
    provider,
    model,
    chatId,
    isSaving: isModelSaving,
    errorMessage: selectionError,
    selectModel,
  };
}
