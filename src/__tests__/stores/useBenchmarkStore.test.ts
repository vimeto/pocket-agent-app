import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBenchmarkStore } from '../../stores/useBenchmarkStore';
import { BenchmarkProblemResult } from '../../types/benchmark';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

describe('useBenchmarkStore', () => {
  let store: ReturnType<typeof useBenchmarkStore.getState>;

  beforeEach(() => {
    // Get store instance
    store = useBenchmarkStore.getState();
    // Reset store state
    store.clearSessions();
    
    // Clear mocks
    jest.clearAllMocks();
  });

  describe('startSession', () => {
    it('should create new session', () => {
      const session = store.startSession('model-1', 'base');
      
      expect(session).toMatchObject({
        id: expect.stringContaining('bench_'),
        modelId: 'model-1',
        mode: 'base',
        startTime: expect.any(Date),
        problems: [],
        systemMetrics: [],
      });
      
      expect(store.currentSession).toBe(session);
      expect(store.isRunning).toBe(true);
      expect(store.mode).toBe('base');
    });
  });

  describe('endSession', () => {
    it('should complete current session', async () => {
      const session = store.startSession('model-1', 'base');
      const sessionId = session.id;
      
      await store.endSession();
      
      const updatedStore = useBenchmarkStore.getState();
      expect(updatedStore.currentSession).toBeNull();
      expect(updatedStore.isRunning).toBe(false);
      expect(updatedStore.sessions).toHaveLength(1);
      expect(updatedStore.sessions[0]).toMatchObject({
        id: sessionId,
        modelId: 'model-1',
        mode: 'base',
        endTime: expect.any(Date),
      });
    });

    it('should save sessions to AsyncStorage', async () => {
      store.startSession('model-1', 'base');
      
      await store.endSession();
      
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'benchmark_sessions',
        expect.any(String)
      );
    });
  });

  describe('addProblemResult', () => {
    it('should add problem result to current session', () => {
      store.startSession('model-1', 'base');
      
      const problemResult: BenchmarkProblemResult = {
        problemId: 1,
        startTime: new Date(),
        endTime: new Date(),
        response: 'def solution(): pass',
        testResults: [],
        success: true,
        metrics: {
          tokens: 100,
          inferenceTime: 1000,
          peakMemory: 500,
          avgCPU: 50,
        },
      };
      
      store.addProblemResult(problemResult);
      
      const updatedStore = useBenchmarkStore.getState();
      expect(updatedStore.currentSession?.problems).toHaveLength(1);
      expect(updatedStore.currentSession?.problems[0]).toBe(problemResult);
    });
  });

  describe('addSystemMetric', () => {
    it('should add system metric to current session', () => {
      store.startSession('model-1', 'base');
      
      const metric = {
        timestamp: Date.now(),
        memoryUsageMB: 1000,
        availableMemoryMB: 2000,
        cpuUsage: 45,
        batteryLevel: 80,
        batteryState: 'discharging' as const,
      };
      
      store.addSystemMetric(metric);
      
      const updatedStore = useBenchmarkStore.getState();
      expect(updatedStore.currentSession?.systemMetrics).toHaveLength(1);
      expect(updatedStore.currentSession?.systemMetrics[0]).toBe(metric);
    });
  });

  describe('setCurrentProblemIndex', () => {
    it('should update current problem index', () => {
      store.setCurrentProblemIndex(5);
      
      const updatedStore = useBenchmarkStore.getState();
      expect(updatedStore.currentProblemIndex).toBe(5);
    });
  });

  describe('setMode', () => {
    it('should update benchmark mode', () => {
      store.setMode('full_tool');
      
      const updatedStore = useBenchmarkStore.getState();
      expect(updatedStore.mode).toBe('full_tool');
    });
  });

  describe('loadSessions', () => {
    it('should load sessions from AsyncStorage', async () => {
      const mockSessions = [
        {
          id: 'bench_123',
          modelId: 'model-1',
          mode: 'base',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          problems: [],
          systemMetrics: [],
        },
      ];
      
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
        JSON.stringify(mockSessions)
      );
      
      await store.loadSessions();
      
      const updatedStore = useBenchmarkStore.getState();
      expect(updatedStore.sessions).toHaveLength(1);
      expect(updatedStore.sessions[0].startTime).toBeInstanceOf(Date);
      expect(updatedStore.sessions[0].endTime).toBeInstanceOf(Date);
    });
  });

  describe('exportSession', () => {
    it('should export session data', async () => {
      store.startSession('model-1', 'base');
      
      const problemResult: BenchmarkProblemResult = {
        problemId: 1,
        startTime: new Date(),
        endTime: new Date(),
        response: 'def solution(): pass',
        testResults: [],
        success: true,
        metrics: {
          tokens: 100,
          inferenceTime: 1000,
          ttft: 50,
          tps: 10,
          peakMemory: 500,
          avgCPU: 50,
          energyConsumed: 5,
        },
      };
      
      store.addProblemResult(problemResult);
      await store.endSession();
      
      const updatedStore = useBenchmarkStore.getState();
      const sessionId = updatedStore.sessions[0].id;
      
      const exported = await store.exportSession(sessionId);
      const exportData = JSON.parse(exported);
      
      expect(exportData).toMatchObject({
        session: {
          id: sessionId,
          model: 'model-1',
          mode: 'base',
          duration: expect.any(Number),
        },
        aggregate: {
          totalProblems: 1,
          successRate: 1,
          avgTokensPerProblem: 100,
          avgTimePerProblem: 1000,
          totalEnergyConsumed: 5,
          avgTTFT: 50,
          avgTPS: 10,
        },
        problems: expect.any(Array),
        systemMetrics: expect.any(Array),
      });
    });

    it('should throw error for non-existent session', async () => {
      await expect(store.exportSession('non-existent')).rejects.toThrow('Session not found');
    });
  });

  describe('clearSessions', () => {
    it('should clear all sessions and remove from storage', async () => {
      store.startSession('model-1', 'base');
      await store.endSession();
      
      store.clearSessions();
      
      const updatedStore = useBenchmarkStore.getState();
      expect(updatedStore.sessions).toHaveLength(0);
      expect(updatedStore.currentSession).toBeNull();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('benchmark_sessions');
    });
  });
});