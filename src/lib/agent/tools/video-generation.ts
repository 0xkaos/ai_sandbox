import { StructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import Replicate from 'replicate';

const MODEL_NAME = 'wavespeedai/wan-2.1-i2v-480p';
const PROMPT_MIN_LEN = 8;
const PROMPT_PREVIEW_LEN = 120;

const videoInputSchema = z.object({
  prompt: z
    .string()
    .min(PROMPT_MIN_LEN, `Prompt must include enough detail (at least ${PROMPT_MIN_LEN} characters).`)
    .describe('Text prompt describing the video content.'),
  image: z
    .string()
    .url('Provide a valid image URL to seed the first frame of the video.')
    .describe('Image URL used as the initial frame.'),
  aspectRatio: z
    .enum(['16:9', '9:16'])
    .default('16:9')
    .describe('Aspect ratio of the output video.'),
  fastMode: z
    .enum(['Off', 'Balanced', 'Fast'])
    .default('Balanced')
    .describe('Speed/quality trade-off.'),
  negativePrompt: z.string().optional().describe('Elements to avoid in the video.'),
  seed: z.number().int().optional().describe('Random seed for reproducibility.'),
  sampleSteps: z.number().int().min(1).max(40).default(30).describe('Number of inference steps.'),
  sampleGuideScale: z.number().min(1).max(10).default(5).describe('Guidance scale for sampling.'),
  sampleShift: z.number().int().min(0).max(10).default(3).describe('Flow shift parameter.'),
  loraScale: z.number().min(0).max(4).default(1).describe('Strength of the main LoRA.'),
  loraWeights: z
    .string()
    .optional()
    .describe('Optional LoRA weights reference (HuggingFace/CivitAI/.safetensors URL).'),
  disableSafetyChecker: z.boolean().default(false).describe('Disable safety checker for generation.'),
});

export class GenerateReplicateVideoTool extends StructuredTool<typeof videoInputSchema> {
  name = 'replicate_generate_video';
  description = 'Generate a short video from an image and prompt using Replicate (WAN 2.1 i2v 480p).';
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
      aspectRatio: input.aspectRatio ?? '16:9',
      fastMode: input.fastMode ?? 'Balanced',
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
    image: input.image,
    aspect_ratio: input.aspectRatio ?? '16:9',
    fast_mode: input.fastMode ?? 'Balanced',
    negative_prompt: input.negativePrompt,
    seed: input.seed,
    sample_steps: input.sampleSteps ?? 30,
    sample_guide_scale: input.sampleGuideScale ?? 5,
    sample_shift: input.sampleShift ?? 3,
    lora_scale: input.loraScale ?? 1,
    lora_weights: input.loraWeights,
    disable_safety_checker: input.disableSafetyChecker ?? false,
  };

  // Strip undefined to avoid overriding model defaults.
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
