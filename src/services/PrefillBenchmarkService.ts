/**
 * Prefill Benchmark Service
 * Manages prefill latency benchmarking for LLMs
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { InferenceService } from './InferenceService';
import { SystemMonitorService } from './SystemMonitorService';
import { PowerMeasurementService } from './PowerMeasurementService';
import { PerformanceService } from './PerformanceService';
import {
  PrefillPromptConfig,
  PrefillResult,
  PrefillBenchmarkResults,
  generatePrompt,
  calculatePromptLengths,
} from '../utils/prefillBenchmark';
import { ChatMessage, InferenceConfig } from '../types';

export class PrefillBenchmarkService {
  private static instance: PrefillBenchmarkService;
  private inferenceService: InferenceService;
  private systemMonitor: SystemMonitorService;
  private powerService: PowerMeasurementService;
  private performanceService: PerformanceService;
  private isRunning = false;
  private isCancelled = false;
  private currentResults: PrefillBenchmarkResults | null = null;
  private progressCallback: ((progress: number, status: string) => void) | null = null;

  private constructor() {
    this.inferenceService = InferenceService.getInstance();
    this.systemMonitor = SystemMonitorService.getInstance();
    this.powerService = PowerMeasurementService.getInstance();
    this.performanceService = PerformanceService.getInstance();
  }

  static getInstance(): PrefillBenchmarkService {
    if (!PrefillBenchmarkService.instance) {
      PrefillBenchmarkService.instance = new PrefillBenchmarkService();
    }
    return PrefillBenchmarkService.instance;
  }

  /**
   * Set progress callback for UI updates
   */
  setProgressCallback(callback: (progress: number, status: string) => void) {
    this.progressCallback = callback;
  }

  /**
   * Run the prefill benchmark
   */
  async runBenchmark(
    modelId: string,
    config: PrefillPromptConfig
  ): Promise<PrefillBenchmarkResults> {
    if (this.isRunning) {
      throw new Error('Benchmark already running');
    }

    this.isRunning = true;
    this.isCancelled = false;

    try {
      // Load the model
      this.updateProgress(0, `Loading model ${modelId}...`);
      await this.inferenceService.loadModel(modelId);

      // Initialize results
      this.currentResults = {
        modelId,
        contextSize: 4096, // Default context size
        threadCount: 4, // Default thread count
        deviceInfo: {
          model: Device.modelName || 'Unknown',
          systemName: Platform.OS,
          systemVersion: Platform.Version.toString(),
          isEmulator: !Device.isDevice,
        },
        config,
        results: [],
        startTime: new Date(),
      };

      const promptLengths = calculatePromptLengths(config);
      const totalRuns = promptLengths.length * config.iterations;
      const warmupRuns = config.warmupRuns || 5;

      // Warmup phase
      this.updateProgress(0, `Running ${warmupRuns} warmup iterations...`);
      const maxLength = Math.max(...promptLengths);
      for (let i = 0; i < warmupRuns; i++) {
        if (this.isCancelled) break;

        // Clear cache before warmup to ensure fresh evaluation
        console.log(`[PrefillBenchmark] Clearing cache for warmup ${i + 1}`);
        await this.inferenceService.clearCache();

        const prompt = generatePrompt(maxLength);
        await this.runSingleInference(prompt, maxLength, -1); // -1 indicates warmup
        this.updateProgress((i + 1) / warmupRuns * 0.1, `Warmup ${i + 1}/${warmupRuns}`);
      }

      // Main benchmark runs
      let completedRuns = 0;
      for (const promptLength of promptLengths) {
        if (this.isCancelled) break;

        for (let iteration = 0; iteration < config.iterations; iteration++) {
          if (this.isCancelled) break;

          // CRITICAL: Clear cache before EVERY measurement to ensure we measure actual prefill time
          // Without this, llama.rn will cache the prompt and report prompt_ms = 0
          console.log(`[PrefillBenchmark] Clearing cache for ${promptLength} tokens, iteration ${iteration}`);
          await this.inferenceService.clearCache();

          const prompt = generatePrompt(promptLength);
          const result = await this.runSingleInference(prompt, promptLength, iteration);

          if (result) {
            this.currentResults.results.push(result);
          }

          completedRuns++;
          const progress = 0.1 + (completedRuns / totalRuns) * 0.9;
          this.updateProgress(
            progress,
            `Testing ${promptLength} tokens (${iteration + 1}/${config.iterations})`
          );
        }
      }

      this.currentResults.endTime = new Date();
      this.updateProgress(1, 'Benchmark completed');

      return this.currentResults;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run a single inference for benchmarking
   */
  private async runSingleInference(
    prompt: string,
    requestedTokens: number,
    iteration: number
  ): Promise<PrefillResult | null> {
    try {
      const messageId = `prefill_${requestedTokens}_${iteration}_${Date.now()}`;
      const sessionId = `prefill_session_${this.currentResults?.startTime.getTime()}`;

      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: prompt,
        },
      ];

      const config: InferenceConfig = {
        maxTokens: 1, // We only need 1 token for TTFT measurement
        temperature: 0,
        topK: 1,
        topP: 1,
        stopTokens: ['</s>', '<|endoftext|>', '<|end|>', '<|im_end|>', '<|eom_id|>'],
      };

      // Capture system metrics before inference
      const systemMetricsBefore = await this.systemMonitor.collectMetrics();
      const powerMetricsBefore = await this.powerService.getCurrentMetrics();

      // Manual timing for accurate measurement
      const startTime = Date.now();
      const performanceStart = performance.now();

      // Run inference
      const result = await this.inferenceService.generateResponse(
        messages,
        config,
        undefined, // No token callback needed
        messageId,
        sessionId
      );

      const performanceEnd = performance.now();
      const endTime = Date.now();
      const totalResponseTime = endTime - startTime;
      const preciseResponseTime = performanceEnd - performanceStart;

      // Capture system metrics after inference
      const systemMetricsAfter = await this.systemMonitor.collectMetrics();
      const powerMetricsAfter = await this.powerService.getCurrentMetrics();

      // Get performance metrics
      const perfMetrics = this.performanceService.getSessionMetrics(sessionId);
      let ttftMs = 0;
      let tps = 0;

      // Try different sources for TTFT in order of preference
      if (perfMetrics && perfMetrics.messageMetrics) {
        const msgMetrics = perfMetrics.messageMetrics.get(messageId);
        if (msgMetrics) {
          ttftMs = msgMetrics.ttft || 0;
          tps = msgMetrics.tps || 0;
        }
      }

      // Check if tokens were cached (which would invalidate our measurement)
      const tokensCached = result?.tokens_cached || 0;
      const tokensEvaluated = result?.tokens_evaluated || 0;

      console.log(`[PrefillBenchmark] Tokens - Cached: ${tokensCached}, Evaluated: ${tokensEvaluated}`);
      console.log(`[PrefillBenchmark] Timings - prompt_ms: ${result?.timings?.prompt_ms}, predicted_ms: ${result?.timings?.predicted_ms}`);

      // For prefill benchmark, we MUST have a valid prompt_ms (non-zero)
      if (result?.timings?.prompt_ms && result.timings.prompt_ms > 0) {
        // This is the actual prefill time
        ttftMs = result.timings.prompt_ms;
        console.log(`[PrefillBenchmark] Valid prefill measurement: ${ttftMs}ms`);
      } else if (result?.timings?.prompt_ms === 0) {
        // This indicates caching, which invalidates the measurement
        console.error(`[PrefillBenchmark] WARNING: Tokens were cached! prompt_ms=0 is invalid for prefill benchmark`);
        console.error(`[PrefillBenchmark] This measurement will be excluded or marked invalid`);
        // For now, we'll use a negative value to indicate invalid measurement
        ttftMs = -1;
      } else {
        // No timing data available
        console.error(`[PrefillBenchmark] ERROR: No valid prompt_ms available`);
        ttftMs = -1;
      }

      // Update TPS if needed
      if (tps === 0 && result?.timings?.predicted_per_second) {
        tps = result.timings.predicted_per_second;
      }

      // Skip warmup results
      if (iteration === -1) {
        return null;
      }

      return {
        requestedTokens,
        actualTokens: requestedTokens, // Assuming our prompt generation is accurate
        iteration,
        ttftMs,
        tps,
        totalResponseTimeMs: totalResponseTime,
        promptEvalTimeMs: result?.timings?.prompt_ms,
        tokenEvalTimeMs: result?.timings?.generation_ms,
        systemMetrics: {
          before: systemMetricsBefore,
          after: systemMetricsAfter,
        },
        energyMetrics: {
          before: powerMetricsBefore,
          after: powerMetricsAfter,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[PrefillBenchmark] Inference failed:`, error);
      return null;
    }
  }

  /**
   * Cancel the running benchmark
   */
  cancel() {
    this.isCancelled = true;
    this.inferenceService.cancelGeneration();
  }

  /**
   * Get current benchmark results
   */
  getCurrentResults(): PrefillBenchmarkResults | null {
    return this.currentResults;
  }

  /**
   * Update progress
   */
  private updateProgress(progress: number, status: string) {
    this.progressCallback?.(progress, status);
  }

  /**
   * Check if benchmark is running
   */
  isRunningBenchmark(): boolean {
    return this.isRunning;
  }
}