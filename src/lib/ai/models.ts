import { openai } from '@ai-sdk/openai';

export const customModel = (modelName: string) => {
  return openai(modelName);
};

export const DEFAULT_MODEL_NAME = 'gpt-4o';
