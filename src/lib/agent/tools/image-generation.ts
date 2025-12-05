import { StructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

const OPENAI_IMAGE_MODEL = 'gpt-image-1';
const XAI_IMAGE_MODEL = 'grok-2-image-1212';

const baseImageSchema = z.object({
  prompt: z.string().min(8, 'Prompt must include enough detail (at least 8 characters).'),
  count: z.number().int().min(1).max(4).optional().describe('How many variants to generate (max 4).'),
});

const openaiImageSchema = baseImageSchema.extend({
  size: z.enum(['256x256', '512x512', '1024x1024', '2048x2048']).optional(),
  quality: z.enum(['standard', 'hd']).optional(),
  style: z.enum(['natural', 'vivid']).optional(),
});

const xaiImageSchema = baseImageSchema.extend({
  aspectRatio: z.enum(['1:1', '3:4', '4:3', '16:9', '9:16']).optional(),
});

const getimgImageSchema = baseImageSchema.extend({
  negativePrompt: z.string().optional(),
  ratio: z.enum(['1:1', '3:4', '4:3', '16:9', '9:16']).optional(),
  width: z.number().int().min(256).max(1536).optional(),
  height: z.number().int().min(256).max(1536).optional(),
  guidance: z.number().min(0).max(25).optional(),
  steps: z.number().int().min(10).max(50).optional(),
});

const dataUrlFromBase64 = (value: string, mime = 'image/png') => `data:${mime};base64,${value}`;

class GenerateOpenAIImageTool extends StructuredTool<typeof openaiImageSchema> {
  name = 'openai_generate_image';
  description = 'Generate images with OpenAI gpt-image-1. Provide a detailed prompt and optional size/quality.';
  schema = openaiImageSchema;

  constructor(private readonly apiKey: string) {
    super();
  }

  protected async _call(input: z.infer<typeof openaiImageSchema>): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt: input.prompt,
        n: input.count ?? 1,
        size: input.size ?? '1024x1024',
        quality: input.quality ?? 'standard',
        style: input.style ?? 'natural',
        response_format: 'b64_json',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message ?? 'Failed to generate image with OpenAI.';
      throw new Error(message);
    }

    const images = Array.isArray(payload?.data)
      ? payload.data.map((item: any, index: number) => ({
          index,
          dataUrl: item?.b64_json ? dataUrlFromBase64(item.b64_json) : item?.url ?? null,
          revisedPrompt: item?.revised_prompt ?? null,
        }))
      : [];

    return JSON.stringify({ provider: 'openai', model: OPENAI_IMAGE_MODEL, count: images.length, images });
  }
}

class GenerateXAIImageTool extends StructuredTool<typeof xaiImageSchema> {
  name = 'xai_generate_image';
  description = 'Generate images with xAI Grok-2 Image. Supply a descriptive prompt and optional aspect ratio.';
  schema = xaiImageSchema;

  constructor(private readonly apiKey: string) {
    super();
  }

  protected async _call(input: z.infer<typeof xaiImageSchema>): Promise<string> {
    const response = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: XAI_IMAGE_MODEL,
        prompt: input.prompt,
        n: input.count ?? 1,
        aspect_ratio: input.aspectRatio ?? '1:1',
        response_format: 'b64_json',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message ?? 'Failed to generate image with xAI.';
      throw new Error(message);
    }

    const images = Array.isArray(payload?.data)
      ? payload.data.map((item: any, index: number) => ({
          index,
          dataUrl: item?.b64_json ? dataUrlFromBase64(item.b64_json) : item?.url ?? null,
          revisedPrompt: item?.revised_prompt ?? null,
        }))
      : [];

    return JSON.stringify({ provider: 'xai', model: XAI_IMAGE_MODEL, count: images.length, images });
  }
}

class GenerateGetimgImageTool extends StructuredTool<typeof getimgImageSchema> {
  name = 'getimg_generate_image';
  description = 'Generate images with getimg Seedream v4. Useful for stylized concepts and marketing visuals.';
  schema = getimgImageSchema;

  constructor(private readonly apiKey: string) {
    super();
  }

  protected async _call(input: z.infer<typeof getimgImageSchema>): Promise<string> {
    const { width, height } = resolveGetimgDimensions(input);
    const response = await fetch('https://api.getimg.ai/v1/seedream-v4/text-to-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt: input.prompt,
        negative_prompt: input.negativePrompt,
        width,
        height,
        guidance: input.guidance ?? 9,
        steps: input.steps ?? 28,
        output_format: 'png',
        response_format: 'b64',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error ?? payload?.message ?? 'Failed to generate image with getimg.';
      throw new Error(typeof message === 'string' ? message : 'Failed to generate image with getimg.');
    }

    const rawImages = extractGetimgImages(payload);
    const images = rawImages.map((raw, index) => ({ index, dataUrl: normalizeToDataUrl(raw) }));

    return JSON.stringify({ provider: 'getimg', model: 'seedream-v4', count: images.length, images });
  }
}

function resolveGetimgDimensions(input: z.infer<typeof getimgImageSchema>) {
  if (input.width && input.height) {
    return { width: input.width, height: input.height };
  }

  switch (input.ratio) {
    case '3:4':
      return { width: 768, height: 1024 };
    case '4:3':
      return { width: 1024, height: 768 };
    case '16:9':
      return { width: 1344, height: 768 };
    case '9:16':
      return { width: 768, height: 1344 };
    default:
      return { width: 1024, height: 1024 };
  }
}

function extractGetimgImages(payload: any): string[] {
  if (!payload) return [];
  if (Array.isArray(payload.data)) {
    return payload.data.map((item: any) => (typeof item === 'string' ? item : item?.image)).filter(Boolean);
  }
  if (Array.isArray(payload.images)) {
    return payload.images.map((item: any) => (typeof item === 'string' ? item : item?.image)).filter(Boolean);
  }
  if (typeof payload.image === 'string') {
    return [payload.image];
  }
  if (typeof payload.output === 'string') {
    return [payload.output];
  }
  return [];
}

function normalizeToDataUrl(value: string) {
  if (!value) return null;
  return value.startsWith('data:') ? value : dataUrlFromBase64(value);
}

export function getImageGeneratorTools(): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [];
  const openaiKey = process.env.OPENAI_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const getimgKey = process.env.GETIMG_API_KEY;

  if (openaiKey) {
    tools.push(new GenerateOpenAIImageTool(openaiKey));
  }
  if (xaiKey) {
    tools.push(new GenerateXAIImageTool(xaiKey));
  }
  if (getimgKey) {
    tools.push(new GenerateGetimgImageTool(getimgKey));
  }

  return tools;
}
