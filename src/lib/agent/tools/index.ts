import type { StructuredToolInterface } from '@langchain/core/tools';
import { getGoogleCalendarTools } from './calendar';
import { getImageGeneratorTools, type ImageStore } from './image-generation';

export function buildAgentTools(userId: string, imageStore?: ImageStore): StructuredToolInterface[] {
  return [...getGoogleCalendarTools(userId), ...getImageGeneratorTools(imageStore)];
}
