import { StructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import Replicate from 'replicate';

const MODEL_NAME = 'wan-video/wan-2.5-t2v';
const PROMPT_MIN_LEN = 8;
const PROMPT_PREVIEW_LEN = 120;

const videoInputSchema = z
  .object({
    // Start flow: provide a prompt and optional tuning args.
    prompt: z
      .string()
      .min(PROMPT_MIN_LEN, `Prompt must include enough detail (at least ${PROMPT_MIN_LEN} characters).`)
      .describe('Text prompt describing the video content.')
      .optional(),
    // Poll flow: provide an existing predictionId to check status.
    predictionId: z.string().min(4).describe('Existing Replicate prediction ID to poll.').optional(),
    // Replicate model only supports 5s or 10s durations today.
    duration: z.union([z.literal(5), z.literal(10)]).default(5).describe('Video duration in seconds (allowed values: 5 or 10).'),
    size: z
      .enum(['1280*720', '720*1280', '1024*1024'])
      .default('1280*720')
      .describe('Resolution of the output video.'),
    negativePrompt: z.string().default('').describe('Elements to avoid in the video.'),
    enablePromptExpansion: z.boolean().default(true).describe('Allow model to expand the prompt for quality.'),
  })
  .refine((val) => Boolean(val.prompt) !== Boolean(val.predictionId), {
    message: 'Provide either a prompt to start or a predictionId to poll (but not both).',
    path: ['prompt'],
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

    // Poll existing prediction first to avoid duplicate starts.
    if (input.predictionId) {
      const prediction = await this.client.predictions.get(input.predictionId);
      const videoUrl = resolveOutputUrl(prediction?.output as unknown);
      return JSON.stringify({
        provider: 'replicate',
        model: MODEL_NAME,
        mode: 'poll',
        predictionId: prediction.id,
        status: prediction.status,
        videoUrl,
        output: prediction.output,
        urls: prediction.urls,
      });
    }

    const started = Date.now();
    console.log('[video-tool][replicate] starting prediction', {
      model: MODEL_NAME,
      promptPreview: input.prompt?.slice(0, PROMPT_PREVIEW_LEN),
      duration: input.duration,
      size: input.size,
      enablePromptExpansion: input.enablePromptExpansion,
    });

    const payload = buildPayload(input);
    let prediction = await this.client.predictions.create({ model: MODEL_NAME, input: payload });

    // Short poll window to catch quick completions without blocking long Vercel requests.
    const SHORT_POLL_MS = 5000;
    const MAX_SHORT_POLL_MS = 20000;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
      if (Date.now() - started >= MAX_SHORT_POLL_MS) break;
      await wait(SHORT_POLL_MS);
      prediction = await this.client.predictions.get(prediction.id);
    }

    const videoUrl = resolveOutputUrl(prediction?.output as unknown);
    const durationMs = Date.now() - started;

    console.log('[video-tool][replicate] status', {
      predictionId: prediction.id,
      status: prediction.status,
      durationMs,
      videoUrl: videoUrl ? videoUrl.slice(0, 120) : null,
    });

    return JSON.stringify({
      provider: 'replicate',
      model: MODEL_NAME,
      mode: 'start',
      predictionId: prediction.id,
      status: prediction.status,
      videoUrl,
      output: prediction.output,
      urls: prediction.urls,
      durationMs,
    });
  }
}

function summarizeOutput(output: unknown) {
  if (typeof output === 'string') return output.slice(0, 200);
  if (Array.isArray(output)) {
    return output.map((v) => (typeof v === 'string' ? v.slice(0, 200) : typeof v === 'object' ? Object.keys(v as any) : typeof v)).slice(0, 5);
  }
  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    return Object.fromEntries(Object.entries(obj).slice(0, 8));
  }
  return output;
}

function buildPayload(input: z.infer<typeof videoInputSchema>) {
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    duration: input.duration ?? 5,
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
  const candidates: string[] = [];

  const consider = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('http')) {
      candidates.push(value);
    }
  };

  if (typeof output === 'string') {
    consider(output);
  }

  if (output && typeof output === 'object') {
    const maybeUrlFn = (output as any).url;
    if (typeof maybeUrlFn === 'function') {
      try {
        consider(maybeUrlFn.call(output));
      } catch {
        // ignore
      }
    }

    consider((output as any).url);
    consider((output as any).output);

    const nested = findHttpUrlDeep((output as any).output ?? output);
    if (nested) consider(nested);
  }

  if (Array.isArray(output)) {
    for (const value of output) {
      const nested = findHttpUrlDeep(value);
      if (nested) consider(nested);
    }
  }

  const preferVideoExt = candidates.find((c) => /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(c));
  if (preferVideoExt) {
    // Prefer replicate.delivery hosts when available for direct file access
    const delivery = candidates.find((c) => /replicate\.delivery/i.test(c) && /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(c));
    return delivery ?? preferVideoExt;
  }

  const delivery = candidates.find((c) => /replicate\.delivery/i.test(c));
  if (delivery) return delivery;

  return candidates[0] ?? null;
}

function findHttpUrlDeep(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || value === undefined) return null;

  if (typeof value === 'string') {
    return value.startsWith('http') ? value : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = findHttpUrlDeep(entry, depth + 1);
      if (url) return url;
    }
    return null;
  }

  if (typeof value === 'object') {
    // Check common keys first
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === 'string' && obj.url.startsWith('http')) return obj.url;
    if (typeof obj.output === 'string' && (obj.output as string).startsWith('http')) return obj.output as string;
    if (Array.isArray(obj.output)) {
      const url = findHttpUrlDeep(obj.output, depth + 1);
      if (url) return url;
    }
    if (Array.isArray(obj.files)) {
      const url = findHttpUrlDeep(obj.files, depth + 1);
      if (url) return url;
    }

    // Fallback: scan values
    for (const val of Object.values(obj)) {
      const url = findHttpUrlDeep(val, depth + 1);
      if (url) return url;
    }
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
