import { StructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import Replicate from 'replicate';

const MODEL_NAME = 'wan-video/wan-2.5-t2v';
const PROMPT_MIN_LEN = 8;
const PROMPT_PREVIEW_LEN = 120;

const videoInputSchema = z.object({
  prompt: z
    .string()
    .min(PROMPT_MIN_LEN, `Prompt must include enough detail (at least ${PROMPT_MIN_LEN} characters).`)
    .describe('Text prompt describing the video content.'),
  duration: z.number().int().min(1).max(12).default(10).describe('Video duration in seconds.'),
  size: z
    .enum(['1280*720', '720*1280', '1024*1024'])
    .default('1280*720')
    .describe('Resolution of the output video.'),
  negativePrompt: z.string().default('').describe('Elements to avoid in the video.'),
  enablePromptExpansion: z.boolean().default(true).describe('Allow model to expand the prompt for quality.'),
});

export class GenerateReplicateVideoTool extends StructuredTool<typeof videoInputSchema> {
  name = 'replicate_generate_video';
  description = 'Generate a short video from text using Replicate (wan-video/wan-2.5-t2v).';
  schema = videoInputSchema;

  private used = false;
  private client: Replicate;

  constructor(apiKey: string) {
    super();
    this.client = new Replicate({ auth: apiKey });
  }

  protected async _call(input: z.infer<typeof videoInputSchema>): Promise<string> {
    if (this.used) {
      return JSON.stringify({ provider: 'replicate', model: MODEL_NAME, note: 'video tool already used in this request' });
    }
    this.used = true;

    const started = Date.now();
    console.log('[video-tool][replicate] generating video', {
      model: MODEL_NAME,
      promptPreview: input.prompt.slice(0, PROMPT_PREVIEW_LEN),
      duration: input.duration,
      size: input.size,
      enablePromptExpansion: input.enablePromptExpansion,
    });

    const payload = buildPayload(input);
    const output = await this.client.run(MODEL_NAME, { input: payload });
    const videoUrl = resolveOutputUrl(output);

    if (!videoUrl) {
      console.error('[video-tool][replicate] missing video URL in response', { output });
      throw new Error('Replicate did not return a video URL.');
    }

    const durationMs = Date.now() - started;
    console.log('[video-tool][replicate] success', { model: MODEL_NAME, durationMs, videoUrl });

    return JSON.stringify({
      provider: 'replicate',
      model: MODEL_NAME,
      videoUrl,
      durationMs,
    });
  }
}

function buildPayload(input: z.infer<typeof videoInputSchema>) {
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    duration: input.duration ?? 10,
    size: input.size ?? '1280*720',
    negative_prompt: input.negativePrompt ?? '',
    enable_prompt_expansion: input.enablePromptExpansion ?? true,
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === null) {
      delete payload[key];
    }
  });

  return payload;
}

function resolveOutputUrl(output: unknown): string | null {
  // New Replicate client returns a File-like object with url()
  if (output && typeof output === 'object') {
    const maybeUrlFn = (output as any).url;
    if (typeof maybeUrlFn === 'function') {
      try {
        const url = maybeUrlFn.call(output);
        if (typeof url === 'string' && url.startsWith('http')) {
          return url;
        }
      } catch {
        // ignore and continue fallbacks
      }
    }

    if (typeof (output as any).url === 'string' && (output as any).url.startsWith('http')) {
      return (output as any).url;
    }

    if (typeof (output as any).output === 'string' && (output as any).output.startsWith('http')) {
      return (output as any).output;
    }
  }

  if (Array.isArray(output)) {
    const candidate = output.find((value) => typeof value === 'string' && value.startsWith('http'));
    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  if (typeof output === 'string' && output.startsWith('http')) {
    return output;
  }

  return null;
}

export function getVideoGeneratorTools(): StructuredToolInterface[] {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    return [];
  }

  return [new GenerateReplicateVideoTool(apiKey)];
}
