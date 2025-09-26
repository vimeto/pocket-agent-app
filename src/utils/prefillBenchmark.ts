/**
 * Prefill Benchmark Utility
 * Handles prompt generation and benchmark logic for measuring prefill latency
 */

export interface PrefillPromptConfig {
  minTokens: number;
  maxTokens: number;
  step: number;
  iterations: number;
  warmupRuns?: number;
}

export interface PrefillResult {
  requestedTokens: number;
  actualTokens: number;
  iteration: number;
  ttftMs: number;
  tps: number;
  totalResponseTimeMs: number;
  promptEvalTimeMs?: number;
  tokenEvalTimeMs?: number;
  systemMetrics?: any;
  energyMetrics?: any;
  timestamp: Date;
}

export interface PrefillBenchmarkResults {
  modelId: string;
  contextSize: number;
  threadCount: number;
  deviceInfo: {
    model: string;
    systemName: string;
    systemVersion: string;
    isEmulator: boolean;
  };
  config: PrefillPromptConfig;
  results: PrefillResult[];
  startTime: Date;
  endTime?: Date;
}

/**
 * Generate a prompt of approximately the requested token length
 * Uses " hey" pattern which tokenizes to a single token in most tokenizers
 */
export function generatePrompt(targetTokens: number): string {
  // Each " hey" typically tokenizes to 1 token
  // Start with a base prompt
  const basePrompt = "hey";

  if (targetTokens <= 1) {
    return basePrompt;
  }

  // Add " hey" repeated to reach target length
  // Account for the initial "hey" (1 token)
  const additionalTokens = targetTokens - 1;
  const repeatedPattern = " hey".repeat(additionalTokens);

  return basePrompt + repeatedPattern;
}

/**
 * Calculate prompt lengths for the benchmark sweep
 */
export function calculatePromptLengths(config: PrefillPromptConfig): number[] {
  const lengths: number[] = [];

  for (let tokens = config.minTokens; tokens <= config.maxTokens; tokens += config.step) {
    lengths.push(tokens);
  }

  // Ensure we always include the max tokens
  if (lengths[lengths.length - 1] !== config.maxTokens) {
    lengths.push(config.maxTokens);
  }

  return lengths;
}

/**
 * Format benchmark results for export
 */
export function formatResultsForExport(results: PrefillBenchmarkResults): any {
  return {
    metadata: {
      model_id: results.modelId,
      context_size: results.contextSize,
      thread_count: results.threadCount,
      device_info: results.deviceInfo,
      config: results.config,
      start_time: results.startTime.toISOString(),
      end_time: results.endTime?.toISOString(),
    },
    results: results.results.map(r => ({
      requested_tokens: r.requestedTokens,
      actual_tokens: r.actualTokens,
      iteration: r.iteration,
      ttft_ms: r.ttftMs,
      tps: r.tps,
      total_response_time_ms: r.totalResponseTimeMs,
      prompt_eval_time_ms: r.promptEvalTimeMs,
      token_eval_time_ms: r.tokenEvalTimeMs,
      system_metrics: r.systemMetrics,
      energy_metrics: r.energyMetrics,
      timestamp: r.timestamp.toISOString(),
    })),
  };
}

/**
 * Calculate statistics for a set of results at a given token length
 */
export function calculateStats(results: PrefillResult[], tokenLength: number) {
  // Filter for the specific token length AND exclude invalid measurements (ttft <= 0)
  const filtered = results.filter(r => r.actualTokens === tokenLength && r.ttftMs > 0);

  if (filtered.length === 0) {
    return null;
  }

  const ttfts = filtered.map(r => r.ttftMs);
  const mean = ttfts.reduce((a, b) => a + b, 0) / ttfts.length;
  const variance = ttfts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / ttfts.length;
  const std = Math.sqrt(variance);

  const invalidCount = results.filter(r => r.actualTokens === tokenLength && r.ttftMs <= 0).length;

  return {
    tokenLength,
    count: filtered.length,
    invalidCount,
    mean,
    std,
    min: Math.min(...ttfts),
    max: Math.max(...ttfts),
    median: ttfts.sort((a, b) => a - b)[Math.floor(ttfts.length / 2)],
  };
}