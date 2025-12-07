import { randomUUID } from 'node:crypto';

const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/i;

type ImageEntry = {
  data: Buffer;
  contentType: string;
};

const cache = new Map<string, ImageEntry>();

export function cacheDataUrl(dataUrl: string): string | null {
  const match = DATA_URL_REGEX.exec(dataUrl);
  if (!match) return null;

  const [, contentType, base64] = match;
  try {
    const data = Buffer.from(base64, 'base64');
    const id = randomUUID();
    cache.set(id, { data, contentType: contentType || 'application/octet-stream' });
    return id;
  } catch {
    return null;
  }
}

export function getCachedImage(id: string): ImageEntry | null {
  return cache.get(id) ?? null;
}
