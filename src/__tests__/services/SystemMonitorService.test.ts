import { SystemMonitorService } from '../../services/SystemMonitorService';
import { Platform } from 'react-native';

// Mock React Native Platform
jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: jest.fn(),
  },
}));

describe('SystemMonitorService', () => {
  let service: SystemMonitorService;

  beforeEach(() => {
    service = SystemMonitorService.getInstance();
    service.stopMonitoring();
    service.clearHistory();
  });

  afterEach(() => {
    service.stopMonitoring();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = SystemMonitorService.getInstance();
      const instance2 = SystemMonitorService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('startMonitoring', () => {
    it('should start collecting metrics at specified interval', async () => {
      const callback = jest.fn();
      service.addMetricsCallback(callback);
      
      await service.startMonitoring(100);
      
      // Wait for at least 2 intervals
      await new Promise(resolve => setTimeout(resolve, 250));
      
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Number),
          memoryUsageMB: expect.any(Number),
          availableMemoryMB: expect.any(Number),
        })
      );
    });

    it('should not start multiple monitoring sessions', async () => {
      await service.startMonitoring(100);
      await service.startMonitoring(100);
      
      // Only one monitoring session should be active
      const historyBefore = service.getMetricsHistory().length;
      await new Promise(resolve => setTimeout(resolve, 150));
      const historyAfter = service.getMetricsHistory().length;
      
      expect(historyAfter - historyBefore).toBeLessThanOrEqual(2);
    });
  });

  describe('stopMonitoring', () => {
    it('should stop collecting metrics', async () => {
      await service.startMonitoring(100);
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const historyBefore = service.getMetricsHistory().length;
      service.stopMonitoring();
      
      await new Promise(resolve => setTimeout(resolve, 150));
      const historyAfter = service.getMetricsHistory().length;
      
      expect(historyAfter).toBe(historyBefore);
    });
  });

  describe('addMetricsCallback', () => {
    it('should call callback when metrics are collected', async () => {
      const callback = jest.fn();
      const unsubscribe = service.addMetricsCallback(callback);
      
      await service.startMonitoring(100);
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(callback).toHaveBeenCalled();
      
      unsubscribe();
    });

    it('should return unsubscribe function', async () => {
      const callback = jest.fn();
      const unsubscribe = service.addMetricsCallback(callback);
      
      await service.startMonitoring(100);
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const callCount = callback.mock.calls.length;
      unsubscribe();
      
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(callback).toHaveBeenCalledTimes(callCount);
    });
  });

  describe('collectMetrics', () => {
    it('should return system metrics', async () => {
      const metrics = await service.collectMetrics();
      
      expect(metrics).toMatchObject({
        timestamp: expect.any(Number),
        memoryUsageMB: expect.any(Number),
        availableMemoryMB: expect.any(Number),
        batteryLevel: expect.any(Number),
        batteryState: expect.stringMatching(/charging|discharging|full|unknown/),
      });
    });
  });

  describe('captureSnapshot', () => {
    it('should capture labeled snapshot', async () => {
      const snapshot = await service.captureSnapshot('test-snapshot');
      
      expect(snapshot).toMatchObject({
        label: 'test-snapshot',
        metrics: expect.objectContaining({
          timestamp: expect.any(Number),
          memoryUsageMB: expect.any(Number),
        }),
      });
    });

    it('should add snapshot to history', async () => {
      const historyBefore = service.getMetricsHistory().length;
      await service.captureSnapshot('test-snapshot');
      const historyAfter = service.getMetricsHistory().length;
      
      expect(historyAfter).toBe(historyBefore + 1);
    });
  });

  describe('getMetricsHistory', () => {
    it('should return metrics history', async () => {
      await service.captureSnapshot('snapshot-1');
      await service.captureSnapshot('snapshot-2');
      
      const history = service.getMetricsHistory();
      expect(history).toHaveLength(2);
      expect(history[0].label).toBe('snapshot-1');
      expect(history[1].label).toBe('snapshot-2');
    });

    it('should limit history to 5 minutes', async () => {
      // Mock old timestamp
      const oldSnapshot = await service.captureSnapshot('old');
      oldSnapshot.metrics.timestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      
      await service.startMonitoring(100);
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const history = service.getMetricsHistory();
      const hasOldSnapshot = history.some(s => s.label === 'old');
      expect(hasOldSnapshot).toBe(false);
    });
  });

  describe('getAverageMetrics', () => {
    it('should calculate average metrics over duration', async () => {
      // Capture multiple snapshots
      for (let i = 0; i < 5; i++) {
        await service.captureSnapshot(`snapshot-${i}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      const avgMetrics = service.getAverageMetrics(300); // Last 300ms
      
      expect(avgMetrics).toMatchObject({
        timestamp: expect.any(Number),
        memoryUsageMB: expect.any(Number),
        availableMemoryMB: expect.any(Number),
      });
    });

    it('should return null if no metrics in duration', () => {
      const avgMetrics = service.getAverageMetrics(100);
      expect(avgMetrics).toBeNull();
    });
  });

  describe('clearHistory', () => {
    it('should clear all metrics history', async () => {
      await service.captureSnapshot('snapshot-1');
      await service.captureSnapshot('snapshot-2');
      
      service.clearHistory();
      
      const history = service.getMetricsHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('exportMetrics', () => {
    it('should export metrics history', async () => {
      await service.captureSnapshot('export-1');
      await service.captureSnapshot('export-2');
      
      const exported = service.exportMetrics();
      expect(exported).toHaveLength(2);
      expect(exported[0].label).toBe('export-1');
      expect(exported[1].label).toBe('export-2');
    });
  });
});