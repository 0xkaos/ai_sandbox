import type { StructuredToolInterface } from '@langchain/core/tools';
import { getGoogleCalendarTools } from './calendar';
import { getImageGeneratorTools } from './image-generation';

export function buildAgentTools(userId: string): StructuredToolInterface[] {
  return [...getGoogleCalendarTools(userId), ...getImageGeneratorTools()];
}
