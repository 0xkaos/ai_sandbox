import type { StructuredToolInterface } from '@langchain/core/tools';
import { getGoogleCalendarTools } from './calendar';

export function buildAgentTools(userId: string): StructuredToolInterface[] {
  return [...getGoogleCalendarTools(userId)];
}
