import { PerformanceService } from '../../services/PerformanceService';

describe('PerformanceService', () => {
  let service: PerformanceService;

  beforeEach(() => {
    service = PerformanceService.getInstance();
    // Clear any existing metrics
    service['currentMetrics'].clear();
    service['sessionMetrics'].clear();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = PerformanceService.getInstance();
      const instance2 = PerformanceService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('startInference', () => {
    it('should initialize metrics for a message', () => {
      const messageId = 'test-message-1';
      service.startInference(messageId);
      
      const metrics = service.getMessageMetrics(messageId);
      expect(metrics).toBeDefined();
      expect(metrics?.inferenceStartTime).toBeDefined();
      expect(metrics?.totalTokens).toBe(0);
    });
  });

  describe('recordFirstToken', () => {
    it('should record TTFT when first token arrives', (done) => {
      const messageId = 'test-message-1';
      service.startInference(messageId);
      
      // Simulate delay before first token
      const delay = 100;
      setTimeout(() => {
        service.recordFirstToken(messageId);
        
        const metrics = service.getMessageMetrics(messageId);
        expect(metrics?.firstTokenTime).toBeDefined();
        expect(metrics?.ttft).toBeDefined();
        expect(metrics?.ttft).toBeGreaterThan(0);
        done();
      }, delay);
    });

    it('should not record TTFT twice', () => {
      const messageId = 'test-message-1';
      service.startInference(messageId);
      
      service.recordFirstToken(messageId);
      const firstTTFT = service.getMessageMetrics(messageId)?.ttft;
      
      service.recordFirstToken(messageId);
      const secondTTFT = service.getMessageMetrics(messageId)?.ttft;
      
      expect(firstTTFT).toBe(secondTTFT);
    });
  });

  describe('recordToken', () => {
    it('should increment token count', () => {
      const messageId = 'test-message-1';
      service.startInference(messageId);
      
      service.recordToken(messageId);
      service.recordToken(messageId);
      service.recordToken(messageId);
      
      const metrics = service.getMessageMetrics(messageId);
      expect(metrics?.totalTokens).toBe(3);
    });

    it('should update last token time', () => {
      const messageId = 'test-message-1';
      service.startInference(messageId);
      
      service.recordToken(messageId);
      const metrics = service.getMessageMetrics(messageId);
      
      expect(metrics?.lastTokenTime).toBeDefined();
    });
  });

  describe('endInference', () => {
    it('should calculate final metrics', async () => {
      const messageId = 'test-message-1';
      const sessionId = 'test-session-1';
      
      service.startInference(messageId);
      service.recordFirstToken(messageId);
      
      // Simulate token generation
      for (let i = 0; i < 10; i++) {
        service.recordToken(messageId);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const finalMetrics = service.endInference(messageId, sessionId);
      
      expect(finalMetrics).toBeDefined();
      expect(finalMetrics?.totalResponseTime).toBeDefined();
      expect(finalMetrics?.totalTokens).toBe(10);
      expect(finalMetrics?.tps).toBeDefined();
      expect(finalMetrics?.tps).toBeGreaterThan(0);
    });

    it('should remove message from current metrics', () => {
      const messageId = 'test-message-1';
      const sessionId = 'test-session-1';
      
      service.startInference(messageId);
      service.endInference(messageId, sessionId);
      
      const metrics = service.getMessageMetrics(messageId);
      expect(metrics).toBeUndefined();
    });

    it('should update session metrics', () => {
      const messageId = 'test-message-1';
      const sessionId = 'test-session-1';
      
      service.startInference(messageId);
      service.recordFirstToken(messageId);
      service.recordToken(messageId);
      service.endInference(messageId, sessionId);
      
      const sessionMetrics = service.getSessionMetrics(sessionId);
      expect(sessionMetrics).toBeDefined();
      expect(sessionMetrics?.messageMetrics.has(messageId)).toBe(true);
    });
  });

  describe('getSessionMetrics', () => {
    it('should calculate aggregate metrics correctly', async () => {
      const sessionId = 'test-session-1';
      
      // Generate metrics for multiple messages
      for (let i = 0; i < 3; i++) {
        const messageId = `message-${i}`;
        service.startInference(messageId);
        service.recordFirstToken(messageId);
        
        for (let j = 0; j < 5; j++) {
          service.recordToken(messageId);
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        
        service.endInference(messageId, sessionId);
      }
      
      const sessionMetrics = service.getSessionMetrics(sessionId);
      expect(sessionMetrics?.aggregateMetrics.totalTokens).toBe(15);
      expect(sessionMetrics?.aggregateMetrics.avgTTFT).toBeGreaterThan(0);
      expect(sessionMetrics?.aggregateMetrics.avgTPS).toBeGreaterThan(0);
      expect(sessionMetrics?.aggregateMetrics.avgResponseTime).toBeGreaterThan(0);
    });
  });

  describe('clearSessionMetrics', () => {
    it('should remove session metrics', () => {
      const messageId = 'test-message-1';
      const sessionId = 'test-session-1';
      
      service.startInference(messageId);
      service.endInference(messageId, sessionId);
      
      service.clearSessionMetrics(sessionId);
      
      const sessionMetrics = service.getSessionMetrics(sessionId);
      expect(sessionMetrics).toBeUndefined();
    });
  });

  describe('exportMetrics', () => {
    it('should export all session metrics', () => {
      const sessions = ['session-1', 'session-2'];
      
      sessions.forEach(sessionId => {
        const messageId = `message-${sessionId}`;
        service.startInference(messageId);
        service.recordToken(messageId);
        service.endInference(messageId, sessionId);
      });
      
      const exported = service.exportMetrics();
      expect(Object.keys(exported)).toHaveLength(2);
      expect(exported['session-1']).toBeDefined();
      expect(exported['session-2']).toBeDefined();
    });
  });
});