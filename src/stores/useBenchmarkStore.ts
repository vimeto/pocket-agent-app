import { create } from 'zustand';
import { 
  BenchmarkSession, 
  BenchmarkMode, 
  BenchmarkProblemResult,
  SystemMetricSnapshot
} from '../types/benchmark';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface BenchmarkState {
  currentSession: BenchmarkSession | null;
  sessions: BenchmarkSession[];
  isRunning: boolean;
  currentProblemIndex: number;
  mode: BenchmarkMode;
  
  // Actions
  startSession: (modelId: string, mode: BenchmarkMode, sessionId?: string) => BenchmarkSession;
  endSession: () => void;
  addProblemResult: (result: BenchmarkProblemResult) => void;
  addSystemMetric: (metric: SystemMetricSnapshot) => void;
  setCurrentProblemIndex: (index: number) => void;
  setMode: (mode: BenchmarkMode) => void;
  loadSessions: () => Promise<void>;
  saveSessions: () => Promise<void>;
  exportSession: (sessionId: string) => Promise<string>;
  clearSessions: () => void;
  addFailedProblem: (problemId: number) => void;
  getCompletionStats: () => { total: number; passed: number; failed: number; percentage: number };
  getToolCallStats: () => { total: number; validFormat: number; extracted: number; failed: number; validPercentage: number };
}

const STORAGE_KEY = 'benchmark_sessions';

export const useBenchmarkStore = create<BenchmarkState>((set, get) => ({
  currentSession: null,
  sessions: [],
  isRunning: false,
  currentProblemIndex: 0,
  mode: 'base',
  
  startSession: (modelId: string, mode: BenchmarkMode, sessionId?: string) => {
    const session: BenchmarkSession = {
      id: sessionId || `bench_${Date.now()}`,
      modelId,
      mode,
      startTime: new Date(),
      problems: [],
      systemMetrics: []
    };
    
    set({ 
      currentSession: session, 
      isRunning: true,
      currentProblemIndex: 0,
      mode 
    });
    
    return session;
  },
  
  endSession: () => {
    set((state) => {
      if (state.currentSession) {
        const completedSession = {
          ...state.currentSession,
          endTime: new Date()
        };
        
        // Save session asynchronously
        get().saveSessions();
        
        return {
          currentSession: null,
          sessions: [...state.sessions, completedSession],
          isRunning: false,
          currentProblemIndex: 0
        };
      }
      return state;
    });
  },
  
  addProblemResult: (result: BenchmarkProblemResult) => {
    set((state) => {
      if (state.currentSession) {
        return {
          currentSession: {
            ...state.currentSession,
            problems: [...state.currentSession.problems, result]
          }
        };
      }
      return state;
    });
  },
  
  addSystemMetric: (metric: SystemMetricSnapshot) => {
    set((state) => {
      if (state.currentSession) {
        return {
          currentSession: {
            ...state.currentSession,
            systemMetrics: [...state.currentSession.systemMetrics, metric]
          }
        };
      }
      return state;
    });
  },
  
  setCurrentProblemIndex: (index: number) => {
    set({ currentProblemIndex: index });
  },
  
  setMode: (mode: BenchmarkMode) => {
    set({ mode });
  },
  
  loadSessions: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const sessions = JSON.parse(stored);
        // Convert date strings back to Date objects
        sessions.forEach((session: any) => {
          session.startTime = new Date(session.startTime);
          if (session.endTime) session.endTime = new Date(session.endTime);
          session.problems.forEach((problem: any) => {
            problem.startTime = new Date(problem.startTime);
            problem.endTime = new Date(problem.endTime);
          });
        });
        set({ sessions });
      }
    } catch (error) {
      console.error('Failed to load benchmark sessions:', error);
    }
  },
  
  saveSessions: async () => {
    try {
      const { sessions } = get();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (error) {
      console.error('Failed to save benchmark sessions:', error);
    }
  },
  
  exportSession: async (sessionId: string) => {
    // Check both completed sessions and current session
    let session: BenchmarkSession | undefined = get().sessions.find(s => s.id === sessionId);
    if (!session && get().currentSession?.id === sessionId) {
      session = get().currentSession || undefined;
    }
    if (!session) throw new Error('Session not found');
    
    // Calculate aggregate latency statistics
    const allInterTokenLatencies: number[] = [];
    const allToolCallLatencies: any[] = [];
    
    session.problems.forEach(p => {
      if (p.metrics.interTokenLatencies) {
        allInterTokenLatencies.push(...p.metrics.interTokenLatencies);
      }
      if (p.metrics.toolCallLatencies) {
        allToolCallLatencies.push(...p.metrics.toolCallLatencies);
      }
    });
    
    // Calculate percentiles for all latencies
    const calculatePercentiles = (values: number[]) => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const len = sorted.length;
      return {
        p50: sorted[Math.floor(len * 0.5)],
        p95: sorted[Math.floor(len * 0.95)],
        p99: sorted[Math.floor(len * 0.99)],
      };
    };
    
    // Ensure dates are Date objects (might be strings if loaded from storage)
    const startTime = session.startTime instanceof Date ? session.startTime : new Date(session.startTime);
    const endTime = session.endTime ? (session.endTime instanceof Date ? session.endTime : new Date(session.endTime)) : null;
    
    const exportData = {
      session: {
        id: session.id,
        model: session.modelId,
        mode: session.mode,
        duration: endTime ? 
          (endTime.getTime() - startTime.getTime()) / 1000 : 0,
        startTime: startTime.toISOString(),
        endTime: endTime?.toISOString()
      },
      aggregate: {
        totalProblems: session.problems.length,
        successRate: session.problems.filter(p => p.success).length / session.problems.length,
        avgTokensPerProblem: session.problems.reduce((sum, p) => sum + p.metrics.tokens, 0) / session.problems.length,
        avgTimePerProblem: session.problems.reduce((sum, p) => sum + p.metrics.inferenceTime, 0) / session.problems.length,
        totalEnergyConsumed: session.problems.reduce((sum, p) => sum + (p.metrics.energyConsumed || 0), 0),
        avgTTFT: session.problems.reduce((sum, p) => sum + (p.metrics.ttft || 0), 0) / session.problems.filter(p => p.metrics.ttft).length,
        avgTPS: session.problems.reduce((sum, p) => sum + (p.metrics.tps || 0), 0) / session.problems.filter(p => p.metrics.tps).length,
        // New aggregate latency metrics
        totalInterTokenLatencies: allInterTokenLatencies.length,
        avgInterTokenLatency: allInterTokenLatencies.length > 0 
          ? allInterTokenLatencies.reduce((a, b) => a + b, 0) / allInterTokenLatencies.length 
          : null,
        latencyPercentiles: calculatePercentiles(allInterTokenLatencies),
        minLatency: allInterTokenLatencies.length > 0 ? Math.min(...allInterTokenLatencies) : null,
        maxLatency: allInterTokenLatencies.length > 0 ? Math.max(...allInterTokenLatencies) : null,
        latencyJitterStd: allInterTokenLatencies.length > 0 
          ? Math.sqrt(allInterTokenLatencies.reduce((sum, l) => {
              const mean = allInterTokenLatencies.reduce((a, b) => a + b, 0) / allInterTokenLatencies.length;
              return sum + Math.pow(l - mean, 2);
            }, 0) / allInterTokenLatencies.length)
          : null,
        totalToolCalls: allToolCallLatencies.length,
        avgToolCallTime: allToolCallLatencies.length > 0
          ? allToolCallLatencies.reduce((sum, t) => sum + t.totalTime, 0) / allToolCallLatencies.length
          : null,
      },
      problems: session.problems,
      systemMetrics: session.systemMetrics,
      // Include raw latency data for further analysis
      rawLatencyData: {
        interTokenLatencies: allInterTokenLatencies,
        toolCallLatencies: allToolCallLatencies,
      }
    };
    
    return JSON.stringify(exportData, null, 2);
  },
  
  clearSessions: () => {
    set({ sessions: [], currentSession: null });
    AsyncStorage.removeItem(STORAGE_KEY);
  },
  
  addFailedProblem: (problemId: number) => {
    set((state) => {
      if (state.currentSession) {
        const failedProblems = state.currentSession.failedProblemIds || [];
        if (!failedProblems.includes(problemId)) {
          return {
            currentSession: {
              ...state.currentSession,
              failedProblemIds: [...failedProblems, problemId]
            }
          };
        }
      }
      return state;
    });
  },
  
  getCompletionStats: () => {
    const state = get();
    if (!state.currentSession) {
      return { total: 0, passed: 0, failed: 0, percentage: 0 };
    }
    
    const total = state.currentSession.problems.length;
    const passed = state.currentSession.problems.filter(p => p.success).length;
    const failed = total - passed;
    const percentage = total > 0 ? (passed / total) * 100 : 0;
    
    return { total, passed, failed, percentage };
  },
  
  getToolCallStats: () => {
    const state = get();
    if (!state.currentSession || state.mode !== 'tool_submission') {
      return { total: 0, validFormat: 0, extracted: 0, failed: 0, validPercentage: 0 };
    }
    
    const problems = state.currentSession.problems;
    const total = problems.length;
    const validFormat = problems.filter(p => p.toolCallValid === true).length;
    const extracted = problems.filter(p => p.toolCallExtracted === true).length;
    const failed = problems.filter(p => p.toolCallExtracted === false).length;
    const validPercentage = total > 0 ? (validFormat / total) * 100 : 0;
    
    return { total, validFormat, extracted, failed, validPercentage };
  }
}));