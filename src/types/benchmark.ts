export interface MBPPProblem {
  id: number;
  description: string;
  code: string;  // The solution (not shown to model)
  testCases: string[];  // Raw assert statements from MBPP
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface TestCase {
  input: string;
  expectedOutput: string;
  assertion?: string;
}

export interface BenchmarkSession {
  id: string;
  modelId: string;
  mode: BenchmarkMode;
  startTime: Date;
  endTime?: Date;
  problems: BenchmarkProblemResult[];
  systemMetrics: SystemMetricSnapshot[];
  failedProblemIds?: number[];
}

export interface BenchmarkProblemResult {
  problemId: number;
  startTime: Date;
  endTime: Date;
  response: string;
  toolCalls?: any[];
  testResults: TestResult[];
  success: boolean;
  // Tool call validity tracking
  toolCallValid?: boolean;  // Whether the model returned a valid tool call format
  toolCallExtracted?: boolean;  // Whether we managed to extract a tool call (even from wrong format)
  metrics: {
    tokens: number;
    inferenceTime: number;
    toolExecutionTime?: number;
    peakMemory: number;
    avgMemory: number;
    minMemory: number;
    avgCPU: number;
    peakCPU?: number;
    energyConsumed?: number;
    energyPerToken?: number;  // Joules per token
    ttft?: number;
    tps?: number;
    promptTokens?: number;
    completionTokens?: number;
    modelLoadTime?: number;
    temperature?: number;
    deviceModel?: string;
    osVersion?: string;
    // New inter-token latency metrics
    interTokenLatencies?: number[];  // Array of ms between consecutive tokens
    latencyPercentiles?: {
      p50: number;
      p95: number;
      p99: number;
    };
    jitterStd?: number;  // Standard deviation of latencies
    minLatency?: number;
    maxLatency?: number;
    avgLatency?: number;
    // Tool call latency metrics
    toolCallLatencies?: {
      toolName: string;
      preparationTime: number;
      executionTime: number;
      processingTime: number;
      totalTime: number;
    }[];
  };
}

export interface TestResult {
  testCase: TestCase | string; // Can be either a TestCase object or a raw assert string
  passed: boolean;
  actualOutput?: string;
  error?: string;
}

export interface SystemMetricSnapshot {
  timestamp: number;
  memoryUsageMB: number;
  availableMemoryMB: number;
  cpuUsage?: number;
  cpuTemperature?: number;
  gpuTemperature?: number;
  batteryLevel?: number;
  batteryState?: 'charging' | 'discharging' | 'full' | 'unknown';
  batteryTemperature?: number;
  powerConsumptionMA?: number;
}

export type BenchmarkMode = 'base' | 'tool_submission' | 'full_tool';

export interface BenchmarkState {
  currentSession: BenchmarkSession | null;
  currentProblemIndex: number;
  isRunning: boolean;
  mode: BenchmarkMode;
  sessions: BenchmarkSession[];
}