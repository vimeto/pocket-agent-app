import { Model } from '../types';

export const DEFAULT_MODELS: Model[] = [
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct',
    size: 2000000000, // ~2GB for Q4_K_M
    url: 'https://huggingface.co/unsloth/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    quantization: 'Q4_K_M',
    architecture: 'llama',
    downloaded: false,
    requiresAuth: false, // unsloth models are public
  },
  {
    id: 'gemma-3n-e2b',
    name: 'Gemma 3n E2B IT',
    size: 1500000000, // ~1.5GB for Q4_K_M
    url: 'https://huggingface.co/unsloth/gemma-3n-E2B-it-GGUF/resolve/main/gemma-3n-E2B-it-Q4_K_M.gguf',
    quantization: 'Q4_K_M',
    architecture: 'gemma',
    downloaded: false,
    requiresAuth: false, // unsloth models are public
  },
  {
    id: 'deepseek-r1-distill-1.5b',
    name: 'DeepSeek R1 Distill Qwen 1.5B',
    size: 1100000000, // ~1.1GB for Q4_K_L
    url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_L.gguf',
    quantization: 'Q4_K_L',
    architecture: 'qwen',
    downloaded: false,
    requiresAuth: false,
  },
  {
    id: 'qwen-3-4b',
    name: 'Qwen 3 4B',
    size: 2300000000, // ~2.3GB for Q4_K_M
    url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
    quantization: 'Q4_K_M',
    architecture: 'qwen',
    downloaded: false,
    requiresAuth: false,
  },
  {
    id: 'qwen-3-0.6B',
    name: 'Qwen 3 0.6B',
    size: 700000000, // ~700MB for Q4_K_M
    url: 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf',
    quantization: 'Q8_0',
    architecture: 'qwen',
    downloaded: false,
    requiresAuth: false,
  }
];

export const DEFAULT_INFERENCE_CONFIG = {
  temperature: 0.7,
  maxTokens: 4092,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  contextLength: 4096,
};
