export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  isToolCall?: boolean;
  isToolResult?: boolean;
  toolCalls?: any[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Model {
  id: string;
  name: string;
  size: number;
  path?: string;
  url?: string;
  quantization?: string;
  architecture: string;
  downloaded: boolean;
  requiresAuth?: boolean;
}

export interface InferenceConfig {
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  contextLength: number;
  stopTokens?: string[];
  jinja?: boolean;
  tool_choice?: string;
  tools?: any[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  modelId: string;
  createdAt: Date;
  updatedAt: Date;
}
