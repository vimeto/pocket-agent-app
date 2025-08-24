import { ChatMessage, Message } from '../types';
import { formatToolsForPrompt } from '../config/tools';

export interface ChatTemplate {
  formatMessages: (messages: Message[], includeTools?: boolean) => string;
  systemPrompt?: string;
  stopTokens: string[];
}

export function getSystemPromptWithTools(includeTools: boolean = false): string {
  let prompt = 'You are a helpful AI assistant.';
  
  if (includeTools) {
    prompt += '\n\nYou have access to the following tools:\n\n';
    prompt += formatToolsForPrompt();
    prompt += '\n\nTo use a tool, write: <tool_call>{"name": "tool_name", "parameters": {...}}</tool_call>';
    prompt += '\nYou can use multiple tools in one response.';
    prompt += '\nAfter using tools, you will receive results that you can use to continue the conversation.';
  }
  
  return prompt;
}

const LLAMA_TEMPLATE: ChatTemplate = {
  formatMessages: (messages: Message[], includeTools?: boolean) => {
    let prompt = '<|begin_of_text|>';

    // Add system prompt if no system message exists
    const hasSystemMessage = messages.some(m => m.sender === 'assistant' && m.text.includes('system'));
    if (!hasSystemMessage) {
      const systemPrompt = getSystemPromptWithTools(includeTools);
      prompt += `<|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>`;
    }

    messages.forEach((message) => {
      const role = message.sender === 'user' ? 'user' : 'assistant';
      prompt += `<|start_header_id|>${role}<|end_header_id|>\n\n${message.text}<|eot_id|>`;
    });

    prompt += '<|start_header_id|>assistant<|end_header_id|>\n\n';
    return prompt;
  },
  stopTokens: ['<|eot_id|>', '<|end_of_text|>'],
};

const GEMMA_TEMPLATE: ChatTemplate = {
  formatMessages: (messages: Message[], includeTools?: boolean) => {
    let prompt = '<bos>';
    
    // Add system message with tools if needed
    if (includeTools) {
      const systemPrompt = getSystemPromptWithTools(true);
      prompt += `<start_of_turn>system\n${systemPrompt}<end_of_turn>\n`;
    }

    messages.forEach((message, index) => {
      if (message.sender === 'user') {
        prompt += `<start_of_turn>user\n${message.text}<end_of_turn>\n`;
      } else {
        prompt += `<start_of_turn>model\n${message.text}<end_of_turn>\n`;
      }
    });

    prompt += '<start_of_turn>model\n';
    return prompt;
  },
  stopTokens: ['<end_of_turn>', '<eos>'],
};

const QWEN_TEMPLATE: ChatTemplate = {
  formatMessages: (messages: Message[], includeTools?: boolean) => {
    const systemPrompt = getSystemPromptWithTools(includeTools);
    let prompt = `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;

    messages.forEach((message) => {
      const role = message.sender === 'user' ? 'user' : 'assistant';
      prompt += `<|im_start|>${role}\n${message.text}<|im_end|>\n`;
    });

    prompt += '<|im_start|>assistant\n';
    return prompt;
  },
  stopTokens: ['<|im_end|>', '<|endoftext|>'],
};

const DEEPSEEK_TEMPLATE: ChatTemplate = {
  // DeepSeek R1 uses the same format as Qwen
  formatMessages: QWEN_TEMPLATE.formatMessages,
  stopTokens: QWEN_TEMPLATE.stopTokens,
};

export const CHAT_TEMPLATES: Record<string, ChatTemplate> = {
  'llama': LLAMA_TEMPLATE,
  'gemma': GEMMA_TEMPLATE,
  'qwen': QWEN_TEMPLATE,
  'deepseek': DEEPSEEK_TEMPLATE,
};

export function getChatTemplate(architecture: string): ChatTemplate {
  return CHAT_TEMPLATES[architecture.toLowerCase()] || LLAMA_TEMPLATE;
}

export function formatPrompt(messages: Message[], architecture: string, includeTools?: boolean): string {
  const template = getChatTemplate(architecture);
  return template.formatMessages(messages, includeTools);
}

export function formatChatHistory(messages: Message[], architecture: string): ChatMessage[] {
  return messages.map(message => ({
    role: message.sender === 'user' ? 'user' : 'assistant',
    content: message.text,
  }));
}
