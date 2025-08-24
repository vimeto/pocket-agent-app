import { LlamaContext, initLlama } from 'llama.rn';
import { ChatMessage, InferenceConfig, Message } from '../types';
import { ModelService } from './ModelService';
import { PerformanceService } from './PerformanceService';
import { useStore } from '../stores/useStore';

export class InferenceService {
  private static instance: InferenceService;
  private context: LlamaContext | null = null;
  private modelService: ModelService;
  private performanceService: PerformanceService;
  private currentModelId: string | null = null;
  private currentCompletion: any = null;
  private isCancelled: boolean = false;

  private constructor() {
    this.modelService = ModelService.getInstance();
    this.performanceService = PerformanceService.getInstance();
  }

  static getInstance(): InferenceService {
    if (!InferenceService.instance) {
      InferenceService.instance = new InferenceService();
    }
    return InferenceService.instance;
  }

  async loadModel(modelId: string): Promise<void> {
    if (this.currentModelId === modelId && this.context) {
      return;
    }

    await this.unloadModel();

    const modelPath = await this.modelService.getModelPath(modelId);
    console.log(`[InferenceService] Loading model ${modelId} from path: ${modelPath}`);
    
    if (!modelPath) {
      throw new Error(`Model not downloaded or path not found for model: ${modelId}`);
    }

    try {
      // Check if file exists before trying to load
      const RNFS = require('react-native-fs');
      
      // List all files in the models directory for debugging
      const modelsDir = modelPath.substring(0, modelPath.lastIndexOf('/'));
      console.log(`[InferenceService] Checking models directory: ${modelsDir}`);
      
      try {
        const dirExists = await RNFS.exists(modelsDir);
        console.log(`[InferenceService] Models directory exists: ${dirExists}`);
        
        if (dirExists) {
          const files = await RNFS.readDir(modelsDir);
          console.log(`[InferenceService] Files in models directory:`, files.map((f: any) => f.name));
        }
      } catch (dirError) {
        console.error(`[InferenceService] Error reading models directory:`, dirError);
      }
      
      const fileExists = await RNFS.exists(modelPath);
      console.log(`[InferenceService] Model file exists: ${fileExists}`);
      
      if (!fileExists) {
        throw new Error(`Model file not found at path: ${modelPath}`);
      }
      
      const fileInfo = await RNFS.stat(modelPath);
      console.log(`[InferenceService] Model file size: ${fileInfo.size} bytes`);
      
      const initParams = {
        model: modelPath,
        n_ctx: 4096,
        n_batch: 512,
        n_threads: 4,
        use_mlock: true,
        use_mmap: true,
      };
      
      console.log(`[InferenceService] Initializing llama with params:`, initParams);
      
      this.context = await initLlama(initParams);
      this.currentModelId = modelId;
      console.log(`[InferenceService] Model ${modelId} loaded successfully`);
    } catch (error: any) {
      console.error(`[InferenceService] Failed to load model ${modelId}:`, error);
      console.error(`[InferenceService] Error details:`, {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      throw new Error(`Failed to load model: ${error.message || error}`);
    }
  }

  async unloadModel(): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = null;
      this.currentModelId = null;
    }
  }

  async generateResponse(
    messages: ChatMessage[],
    config: InferenceConfig,
    onToken?: (token: string) => void,
    messageId?: string,
    sessionId?: string
  ): Promise<any> {
    if (!this.context) {
      throw new Error('No model loaded');
    }

    const stopTokens = config.stopTokens || ['</s>', '<|endoftext|>', '<|end|>', '<|im_end|>', '<|eom_id|>'];
    let response = '';
    this.isCancelled = false;
    let isFirstToken = true;
    
    // Start performance tracking
    if (messageId) {
      console.log('[InferenceService] Starting performance tracking for:', messageId);
      this.performanceService.startInference(messageId);
    }

    const completionParams: any = {
      messages,
      n_predict: config.maxTokens,
      temperature: config.temperature,
      top_k: config.topK,
      top_p: config.topP,
      stop: stopTokens,
    };

    // Add tool-specific parameters if provided
    if (config.jinja !== undefined) {
      completionParams.jinja = config.jinja;
    }
    if (config.tool_choice !== undefined) {
      completionParams.tool_choice = config.tool_choice;
    }
    if (config.tools !== undefined) {
      completionParams.tools = config.tools;
    }

    console.log('[InferenceService] Completion params:', JSON.stringify(completionParams, null, 2));

    let tokenCount = 0;
    this.currentCompletion = this.context.completion(
      completionParams,
      (tokenResult) => {
        // Check if generation was cancelled
        if (this.isCancelled) {
          // Return true to stop the completion
          return true;
        }

        tokenCount++;
        if (!stopTokens.includes(tokenResult.token)) {
          response += tokenResult.token;
          onToken?.(tokenResult.token);
          
          // Track performance metrics
          if (messageId) {
            if (isFirstToken) {
              console.log('[InferenceService] Recording first token for:', messageId, 'Token:', tokenResult.token.substring(0, 20));
              this.performanceService.recordFirstToken(messageId);
              isFirstToken = false;
            }
            this.performanceService.recordToken(messageId);
          }
        }
      }
    );

    try {
      const result = await this.currentCompletion;
      console.log('[InferenceService] Completion result:', result);
      console.log('[InferenceService] Token callback called', tokenCount, 'times');
      
      // Log warning if no token streaming detected
      if (tokenCount === 0 && result && messageId) {
        console.log('[InferenceService] WARNING: No token streaming detected!');
        console.log('[InferenceService] This means TTFT and inter-token latencies cannot be measured accurately.');
        // We will use the aggregated metrics from llama.rn instead
      }
      
      // End performance tracking
      if (messageId && sessionId) {
        console.log('[InferenceService] Ending performance tracking for:', messageId);
        let metrics = this.performanceService.endInference(messageId, sessionId);
        
        // If we didn't get streaming tokens, use the aggregated metrics from llama.rn
        if (tokenCount === 0 && result && result.timings) {
          // Check if we have partial metrics from startInference
          const hasPartialMetrics = !!metrics;
          // Create metrics from llama.rn result
          const llamaMetrics: any = {
            inferenceStartTime: Date.now() - (result.timings.prompt_ms + result.timings.predicted_ms),
            totalResponseTime: result.timings.prompt_ms + result.timings.predicted_ms,
            totalTokens: result.tokens_predicted || 0,
            ttft: result.timings.prompt_ms,  // Time to process prompt and start generation
            tps: result.timings.predicted_per_second,  // Actual tokens per second
            tokenLatencyData: {
              interTokenLatencies: [],  // Cannot get individual latencies without streaming
              tokenTimestamps: [],
            },
            toolCallLatencies: [],
          };
          
          // Calculate average inter-token latency from total generation time
          if (result.tokens_predicted > 1 && result.timings.predicted_ms) {
            const avgInterTokenLatency = result.timings.predicted_ms / result.tokens_predicted;
            // Store as a single value array since we only have the average
            llamaMetrics.tokenLatencyData.interTokenLatencies = [avgInterTokenLatency];
            console.log('[InferenceService] Average inter-token latency:', avgInterTokenLatency, 'ms');
          }
          
          console.log('[InferenceService] Using llama.rn metrics - TTFT:', llamaMetrics.ttft, 'ms, TPS:', llamaMetrics.tps);
          
          if (hasPartialMetrics && metrics) {
            // Update existing metrics with llama.rn data
            metrics.ttft = llamaMetrics.ttft;
            metrics.tps = llamaMetrics.tps;
            metrics.totalTokens = llamaMetrics.totalTokens;
            metrics.tokenLatencyData = llamaMetrics.tokenLatencyData;
            console.log('[InferenceService] Updated existing metrics with llama.rn data');
          } else {
            // Set the metrics directly
            this.performanceService.setMetricsFromResult(messageId, sessionId, llamaMetrics);
            metrics = llamaMetrics;
            console.log('[InferenceService] Created new metrics from llama.rn data');
          }
        }
        
        if (metrics) {
          // Update store with performance metrics
          useStore.getState().updatePerformanceMetrics(messageId, metrics);
        }
      }
      
      // Return the full result object which includes text and tool_calls
      return result;
    } catch (error) {
      console.error('[InferenceService] Completion error:', error);
      throw error;
    } finally {
      this.currentCompletion = null;
      this.isCancelled = false;
    }
  }

  async stopGeneration(): Promise<void> {
    // Set the cancellation flag
    this.isCancelled = true;

    // Wait a bit for the completion to stop
    await new Promise(resolve => setTimeout(resolve, 100));

    // Clear the current completion reference
    this.currentCompletion = null;

    // Reset the context to ensure it's ready for the next completion
    if (this.context && this.currentModelId) {
      try {
        // Store the current model ID
        const modelId = this.currentModelId;

        // Reload the model to get a fresh context
        await this.loadModel(modelId);
      } catch (error) {
        console.error('Error resetting context after cancellation:', error);
      }
    }
  }

  getCurrentModelId(): string | null {
    return this.currentModelId;
  }

  isModelLoaded(): boolean {
    return this.context !== null;
  }
}
