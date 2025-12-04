import { openai, createOpenAI } from '@ai-sdk/openai';

export type ProviderId = 'openai' | 'xai';
export type ModelCapability = 'general' | 'reasoning' | 'code' | 'vision' | 'image';

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  providerId: ProviderId;
  capability: ModelCapability;
  available: boolean;
  comingSoon?: boolean;
}

interface ProviderGroup {
  id: ProviderId;
  name: string;
  description: string;
  models: ModelOption[];
}

export const DEFAULT_PROVIDER_ID: ProviderId = 'openai';
export const DEFAULT_MODEL_ID = 'gpt-4o';

const xaiApiKey = process.env.XAI_API_KEY;
const xaiClient = xaiApiKey
  ? createOpenAI({
      apiKey: xaiApiKey,
      baseURL: 'https://api.x.ai/v1',
    })
  : null;

export const PROVIDER_GROUPS: ProviderGroup[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Balanced performance and broad tool support.',
    models: [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        description: 'Flagship multimodal model with reasoning.',
        providerId: 'openai',
        capability: 'general',
        available: true,
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o Mini',
        description: 'Cost-effective for quick prompts and drafts.',
        providerId: 'openai',
        capability: 'general',
        available: true,
      },
      {
        id: 'o3-mini',
        label: 'o3 Mini',
        description: 'Reasoning-focused with lower latency.',
        providerId: 'openai',
        capability: 'reasoning',
        available: true,
      },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    description: 'Grok family models for fast reasoning and multimodal work.',
    models: [
      {
        id: 'grok-4-1-fast-reasoning',
        label: 'Grok 4.1 Fast (Reasoning)',
        description: 'Reasoning-optimized, ideal for planning tasks.',
        providerId: 'xai',
        capability: 'reasoning',
        available: Boolean(xaiClient),
      },
      {
        id: 'grok-4-1-fast-non-reasoning',
        label: 'Grok 4.1 Fast (Non-Reasoning)',
        description: 'Lower latency conversational model.',
        providerId: 'xai',
        capability: 'general',
        available: Boolean(xaiClient),
      },
      {
        id: 'grok-code-fast-1',
        label: 'Grok Code Fast',
        description: 'Code-focused responses with up-to-date knowledge.',
        providerId: 'xai',
        capability: 'code',
        available: Boolean(xaiClient),
      },
      {
        id: 'grok-2-vision-1212',
        label: 'Grok 2 Vision',
        description: 'Vision-first multimodal model (coming soon).',
        providerId: 'xai',
        capability: 'vision',
        available: Boolean(xaiClient),
        comingSoon: true,
      },
      {
        id: 'grok-2-image-1212',
        label: 'Grok 2 Image',
        description: 'Image generation pipeline (coming soon).',
        providerId: 'xai',
        capability: 'image',
        available: Boolean(xaiClient),
        comingSoon: true,
      },
    ],
  },
];

export const MODEL_OPTIONS = PROVIDER_GROUPS.flatMap((group) => group.models);

export function normalizeModelSelection(
  providerId?: string,
  modelId?: string
): { providerId: ProviderId; modelId: string } {
  const fallback = { providerId: DEFAULT_PROVIDER_ID, modelId: DEFAULT_MODEL_ID };
  if (!providerId || !modelId) {
    return fallback;
  }

  const provider = PROVIDER_GROUPS.find((group) => group.id === providerId);
  if (!provider) {
    return fallback;
  }

  const model = provider.models.find((option) => option.id === modelId);
  if (!model) {
    return { providerId: provider.id, modelId: provider.models[0]?.id ?? DEFAULT_MODEL_ID };
  }

  return { providerId: provider.id, modelId: model.id };
}

export function resolveLanguageModel(providerId: ProviderId, modelId: string) {
  if (providerId === 'openai') {
    return openai(modelId as any);
  }

  if (providerId === 'xai') {
    if (!xaiClient) {
      throw new Error('XAI_API_KEY is not configured for xAI models.');
    }
    return xaiClient(modelId as any);
  }

  throw new Error(`Unsupported provider: ${providerId}`);
}

export function getModelMetadata(providerId: ProviderId, modelId: string) {
  return MODEL_OPTIONS.find((option) => option.providerId === providerId && option.id === modelId);
}