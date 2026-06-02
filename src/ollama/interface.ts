import type { Message } from '../chat/schemas.js';

export interface OllamaChatRequest {
  system: string;
  messages: Message[];
  format?: 'json';
  signal?: AbortSignal;
}

export interface OllamaChatResponse {
  content: string;
}

export interface OllamaChatStreamRequest {
  system: string;
  messages: Message[];
  signal: AbortSignal;
}

export interface OllamaClient {
  chatOnce(args: OllamaChatRequest): Promise<OllamaChatResponse>;
  chatStream(args: OllamaChatStreamRequest): AsyncIterable<string>;
  checkModel(): Promise<void>;
}
