export interface TokenLatencyData {
  interTokenLatencies: number[];  // Array of ms between consecutive tokens
  tokenTimestamps: number[];      // Timestamp for each token
  percentiles?: {
    p50: number;
    p95: number;
    p99: number;
  };
  jitterStd?: number;             // Standard deviation of latencies
  minLatency?: number;
  maxLatency?: number;
  avgLatency?: number;
}

export interface ToolCallLatencyData {
  toolName: string;
  preparationTime: number;  // Time to prepare tool call
  executionTime: number;    // Time for tool execution
  processingTime: number;   // Time to process result
  totalTime: number;
  timestamp: number;
}

export interface PerformanceMetrics {
  inferenceStartTime?: number;
  firstTokenTime?: number;
  lastTokenTime?: number;
  totalTokens: number;
  ttft?: number; // Time to First Token
  tps?: number; // Tokens Per Second
  totalResponseTime?: number;
  memoryUsageMB?: number;
  cpuUsage?: number;
  tokenLatencyData?: TokenLatencyData;
  toolCallLatencies?: ToolCallLatencyData[];
}

export interface SessionPerformanceMetrics {
  sessionId: string;
  messageMetrics: Map<string, PerformanceMetrics>;
  aggregateMetrics: {
    avgTTFT: number;
    avgTPS: number;
    avgResponseTime: number;
    totalTokens: number;
    latencyPercentiles?: {
      p50: number;
      p95: number;
      p99: number;
    };
    avgInterTokenLatency?: number;
  };
}

export class PerformanceService {
  private static instance: PerformanceService;
  private currentMetrics: Map<string, PerformanceMetrics> = new Map();
  private sessionMetrics: Map<string, SessionPerformanceMetrics> = new Map();
  private tokenTimestamps: Map<string, number[]> = new Map();
  private toolCallStack: Map<string, { startTime: number; toolName: string }[]> = new Map();

  private constructor() {}

  static getInstance(): PerformanceService {
    if (!PerformanceService.instance) {
      PerformanceService.instance = new PerformanceService();
    }
    return PerformanceService.instance;
  }

  startInference(messageId: string): void {
    const now = Date.now();
    this.currentMetrics.set(messageId, {
      inferenceStartTime: now,
      totalTokens: 0,
      tokenLatencyData: {
        interTokenLatencies: [],
        tokenTimestamps: [],
      },
      toolCallLatencies: [],
    });
    this.tokenTimestamps.set(messageId, []);
    this.toolCallStack.set(messageId, []);
  }

  recordFirstToken(messageId: string): void {
    const metrics = this.currentMetrics.get(messageId);
    const timestamps = this.tokenTimestamps.get(messageId);
    if (metrics && metrics.inferenceStartTime && !metrics.firstTokenTime) {
      const now = Date.now();
      metrics.firstTokenTime = now;
      metrics.ttft = now - metrics.inferenceStartTime;
      if (timestamps) {
        timestamps.push(now);
      }
      if (metrics.tokenLatencyData) {
        metrics.tokenLatencyData.tokenTimestamps.push(now);
      }
    }
  }

  recordToken(messageId: string): void {
    const metrics = this.currentMetrics.get(messageId);
    const timestamps = this.tokenTimestamps.get(messageId);
    if (metrics) {
      const now = Date.now();
      metrics.totalTokens++;
      metrics.lastTokenTime = now;

      // Record inter-token latency
      if (timestamps && timestamps.length > 0) {
        const lastTimestamp = timestamps[timestamps.length - 1];
        const latency = now - lastTimestamp;

        if (metrics.tokenLatencyData) {
          metrics.tokenLatencyData.interTokenLatencies.push(latency);
          metrics.tokenLatencyData.tokenTimestamps.push(now);
        }
        timestamps.push(now);
      } else if (timestamps) {
        // First token case
        timestamps.push(now);
        if (metrics.tokenLatencyData) {
          metrics.tokenLatencyData.tokenTimestamps.push(now);
        }
      }
    }
  }

  endInference(messageId: string, sessionId: string): PerformanceMetrics | undefined {
    const metrics = this.currentMetrics.get(messageId);
    if (!metrics || !metrics.inferenceStartTime) {
      console.log('[PerformanceService] No metrics found for messageId:', messageId);
      return undefined;
    }

    const endTime = Date.now();
    metrics.totalResponseTime = endTime - metrics.inferenceStartTime;

    if (metrics.lastTokenTime && metrics.firstTokenTime) {
      const tokenGenerationTime = (metrics.lastTokenTime - metrics.firstTokenTime) / 1000;
      if (tokenGenerationTime > 0 && metrics.totalTokens > 1) {
        metrics.tps = (metrics.totalTokens - 1) / tokenGenerationTime;
      }
    }

    console.log('[PerformanceService] Ending inference for', messageId);
    console.log('[PerformanceService] - TTFT:', metrics.ttft, 'ms');
    console.log('[PerformanceService] - TPS:', metrics.tps);
    console.log('[PerformanceService] - Total tokens:', metrics.totalTokens);
    console.log('[PerformanceService] - Inter-token latencies:',
      metrics.tokenLatencyData?.interTokenLatencies?.length || 0);

    // Calculate latency statistics
    if (metrics.tokenLatencyData && metrics.tokenLatencyData.interTokenLatencies.length > 0) {
      this.calculateLatencyStatistics(metrics.tokenLatencyData);
    }

    this.updateSessionMetrics(sessionId, messageId, metrics);
    this.currentMetrics.delete(messageId);
    this.tokenTimestamps.delete(messageId);
    this.toolCallStack.delete(messageId);

    return metrics;
  }
  
  // Method to set metrics directly when streaming is not available
  setMetricsFromResult(messageId: string, sessionId: string, metrics: PerformanceMetrics): void {
    console.log('[PerformanceService] Setting metrics from llama.rn result for:', messageId);
    this.currentMetrics.set(messageId, metrics);
    this.updateSessionMetrics(sessionId, messageId, metrics);
  }

  private updateSessionMetrics(sessionId: string, messageId: string, metrics: PerformanceMetrics): void {
    let sessionMetrics = this.sessionMetrics.get(sessionId);
    if (!sessionMetrics) {
      sessionMetrics = {
        sessionId,
        messageMetrics: new Map(),
        aggregateMetrics: {
          avgTTFT: 0,
          avgTPS: 0,
          avgResponseTime: 0,
          totalTokens: 0,
        },
      };
      this.sessionMetrics.set(sessionId, sessionMetrics);
    }

    sessionMetrics.messageMetrics.set(messageId, metrics);
    this.calculateAggregateMetrics(sessionMetrics);
  }

  private calculateAggregateMetrics(sessionMetrics: SessionPerformanceMetrics): void {
    const metricsArray = Array.from(sessionMetrics.messageMetrics.values());
    const validTTFTs = metricsArray.filter(m => m.ttft !== undefined).map(m => m.ttft!);
    const validTPS = metricsArray.filter(m => m.tps !== undefined).map(m => m.tps!);
    const validResponseTimes = metricsArray.filter(m => m.totalResponseTime !== undefined).map(m => m.totalResponseTime!);

    // Collect all inter-token latencies across messages
    const allLatencies: number[] = [];
    metricsArray.forEach(m => {
      if (m.tokenLatencyData?.interTokenLatencies) {
        allLatencies.push(...m.tokenLatencyData.interTokenLatencies);
      }
    });

    sessionMetrics.aggregateMetrics = {
      avgTTFT: validTTFTs.length > 0 ? validTTFTs.reduce((a, b) => a + b, 0) / validTTFTs.length : 0,
      avgTPS: validTPS.length > 0 ? validTPS.reduce((a, b) => a + b, 0) / validTPS.length : 0,
      avgResponseTime: validResponseTimes.length > 0 ? validResponseTimes.reduce((a, b) => a + b, 0) / validResponseTimes.length : 0,
      totalTokens: metricsArray.reduce((sum, m) => sum + m.totalTokens, 0),
    };

    // Calculate aggregate latency percentiles if we have data
    if (allLatencies.length > 0) {
      sessionMetrics.aggregateMetrics.latencyPercentiles = this.calculatePercentiles(allLatencies);
      sessionMetrics.aggregateMetrics.avgInterTokenLatency =
        allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
    }
  }

  getMessageMetrics(messageId: string): PerformanceMetrics | undefined {
    // First check current metrics
    const currentMetric = this.currentMetrics.get(messageId);
    if (currentMetric) {
      console.log('[PerformanceService] Found metrics in current for:', messageId);
      return currentMetric;
    }

    // Then check in session metrics
    for (const session of this.sessionMetrics.values()) {
      const msgMetrics = session.messageMetrics.get(messageId);
      if (msgMetrics) {
        console.log('[PerformanceService] Found metrics in session for:', messageId);
        return msgMetrics;
      }
    }

    console.log('[PerformanceService] No metrics found for messageId:', messageId);
    return undefined;
  }

  getSessionMetrics(sessionId: string): SessionPerformanceMetrics | undefined {
    return this.sessionMetrics.get(sessionId);
  }

  clearSessionMetrics(sessionId: string): void {
    this.sessionMetrics.delete(sessionId);
  }

  exportMetrics(): Record<string, SessionPerformanceMetrics> {
    return Object.fromEntries(this.sessionMetrics);
  }

  // Tool call timing methods
  startToolCall(messageId: string, toolName: string): void {
    let stack = this.toolCallStack.get(messageId);
    if (!stack) {
      console.log(`[PerformanceService] No tool call stack for ${messageId}, creating one`);
      stack = [];
      this.toolCallStack.set(messageId, stack);
    }
    stack.push({ startTime: Date.now(), toolName });
    console.log(`[PerformanceService] Started tool call ${toolName} for ${messageId}`);
  }

  endToolCall(messageId: string, executionTime: number): void {
    let metrics = this.currentMetrics.get(messageId);
    
    // If metrics don't exist, create them
    if (!metrics) {
      console.log(`[PerformanceService] No metrics for ${messageId}, creating basic metrics`);
      metrics = {
        totalTokens: 0,
        toolCallLatencies: []
      };
      this.currentMetrics.set(messageId, metrics);
    }
    
    const stack = this.toolCallStack.get(messageId);

    if (stack && stack.length > 0) {
      const toolCall = stack.pop();
      if (toolCall) {
        const now = Date.now();
        const preparationTime = executionTime; // Time reported by tool execution
        const totalTime = now - toolCall.startTime;
        const processingTime = totalTime - preparationTime;

        if (!metrics.toolCallLatencies) {
          metrics.toolCallLatencies = [];
        }

        metrics.toolCallLatencies.push({
          toolName: toolCall.toolName,
          preparationTime: preparationTime,
          executionTime: executionTime,
          processingTime: processingTime,
          totalTime: totalTime,
          timestamp: now,
        });
        
        console.log(`[PerformanceService] Ended tool call ${toolCall.toolName} for ${messageId}, total latencies: ${metrics.toolCallLatencies.length}`);
      }
    } else {
      console.log(`[PerformanceService] Warning: No tool call stack for ${messageId} or stack is empty`);
    }
  }

  // Statistical calculation methods
  private calculateLatencyStatistics(data: TokenLatencyData): void {
    const latencies = data.interTokenLatencies;
    if (latencies.length === 0) return;

    // Calculate percentiles
    data.percentiles = this.calculatePercentiles(latencies);

    // Calculate min, max, avg
    data.minLatency = Math.min(...latencies);
    data.maxLatency = Math.max(...latencies);
    data.avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    // Calculate jitter (standard deviation)
    const mean = data.avgLatency;
    const squaredDiffs = latencies.map(l => Math.pow(l - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / latencies.length;
    data.jitterStd = Math.sqrt(avgSquaredDiff);
  }

  private calculatePercentiles(values: number[]): { p50: number; p95: number; p99: number } {
    const sorted = [...values].sort((a, b) => a - b);
    const len = sorted.length;

    const getPercentile = (p: number): number => {
      const index = Math.ceil((p / 100) * len) - 1;
      return sorted[Math.max(0, Math.min(index, len - 1))];
    };

    return {
      p50: getPercentile(50),
      p95: getPercentile(95),
      p99: getPercentile(99),
    };
  }

  // Get detailed latency report for a message
  getLatencyReport(messageId: string): TokenLatencyData | undefined {
    const metrics = this.currentMetrics.get(messageId);
    if (metrics?.tokenLatencyData) {
      return metrics.tokenLatencyData;
    }

    // Check in session metrics
    for (const session of this.sessionMetrics.values()) {
      const msgMetrics = session.messageMetrics.get(messageId);
      if (msgMetrics?.tokenLatencyData) {
        return msgMetrics.tokenLatencyData;
      }
    }

    return undefined;
  }

  // Save metrics to persistent storage (will be enhanced with SQLite later)
  async saveMetricsToStorage(sessionId: string): Promise<void> {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const sessionMetrics = this.sessionMetrics.get(sessionId);
    if (sessionMetrics) {
      const metricsData = {
        ...sessionMetrics,
        messageMetrics: Array.from(sessionMetrics.messageMetrics.entries()),
      };
      await AsyncStorage.setItem(
        `performance_metrics_${sessionId}`,
        JSON.stringify(metricsData)
      );
    }
  }

  // Load metrics from persistent storage
  async loadMetricsFromStorage(sessionId: string): Promise<SessionPerformanceMetrics | null> {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    try {
      const data = await AsyncStorage.getItem(`performance_metrics_${sessionId}`);
      if (data) {
        const parsed = JSON.parse(data);
        const sessionMetrics: SessionPerformanceMetrics = {
          ...parsed,
          messageMetrics: new Map(parsed.messageMetrics),
        };
        this.sessionMetrics.set(sessionId, sessionMetrics);
        return sessionMetrics;
      }
    } catch (error) {
      console.error('Error loading metrics from storage:', error);
    }
    return null;
  }
}
