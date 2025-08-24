import { MBPPDatasetService } from '../../services/MBPPDatasetService';
import { MBPPProblem } from '../../types/benchmark';

describe('MBPPDatasetService', () => {
  let service: MBPPDatasetService;

  beforeEach(() => {
    service = MBPPDatasetService.getInstance();
    service.resetProgress();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = MBPPDatasetService.getInstance();
      const instance2 = MBPPDatasetService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('loadDataset', () => {
    it('should load dataset', async () => {
      await service.loadDataset();
      const problems = service.getProblems();
      expect(problems.length).toBeGreaterThan(0);
    });
  });

  describe('getProblems', () => {
    it('should return all problems', () => {
      const problems = service.getProblems();
      expect(Array.isArray(problems)).toBe(true);
      expect(problems.length).toBe(5); // Based on sample data
    });

    it('should return problems with correct structure', () => {
      const problems = service.getProblems();
      const problem = problems[0];
      
      expect(problem).toHaveProperty('id');
      expect(problem).toHaveProperty('description');
      expect(problem).toHaveProperty('code');
      expect(problem).toHaveProperty('testCases');
      expect(Array.isArray(problem.testCases)).toBe(true);
    });
  });

  describe('getProblem', () => {
    it('should return problem by id', () => {
      const problem = service.getProblem(1);
      expect(problem).toBeDefined();
      expect(problem?.id).toBe(1);
    });

    it('should return undefined for non-existent id', () => {
      const problem = service.getProblem(999);
      expect(problem).toBeUndefined();
    });
  });

  describe('getRandomProblem', () => {
    it('should return a random problem', () => {
      const problem = service.getRandomProblem();
      expect(problem).toBeDefined();
      expect(problem).toHaveProperty('id');
    });

    it('should prefer uncompleted problems', () => {
      // Mark all but one problem as completed
      const problems = service.getProblems();
      for (let i = 1; i < problems.length; i++) {
        service.markCompleted(problems[i].id);
      }
      
      // Should always return the uncompleted problem
      for (let i = 0; i < 10; i++) {
        const problem = service.getRandomProblem();
        expect(problem.id).toBe(problems[0].id);
      }
    });
  });

  describe('getNextProblem', () => {
    it('should return first problem when no current id', () => {
      const problem = service.getNextProblem();
      expect(problem).toBeDefined();
      expect(problem?.id).toBe(1);
    });

    it('should return next problem in sequence', () => {
      const problem = service.getNextProblem(1);
      expect(problem).toBeDefined();
      expect(problem?.id).toBe(2);
    });

    it('should return null at end of list', () => {
      const problems = service.getProblems();
      const lastId = problems[problems.length - 1].id;
      const problem = service.getNextProblem(lastId);
      expect(problem).toBeNull();
    });

    it('should return null for non-existent current id', () => {
      const problem = service.getNextProblem(999);
      expect(problem).toBeNull();
    });
  });

  describe('markCompleted', () => {
    it('should mark problem as completed', () => {
      const problemId = 1;
      service.markCompleted(problemId);
      
      const progress = service.getProgress();
      expect(progress.completed).toBe(1);
    });

    it('should not duplicate completed problems', () => {
      const problemId = 1;
      service.markCompleted(problemId);
      service.markCompleted(problemId);
      
      const progress = service.getProgress();
      expect(progress.completed).toBe(1);
    });
  });

  describe('resetProgress', () => {
    it('should clear all completed problems', () => {
      service.markCompleted(1);
      service.markCompleted(2);
      service.markCompleted(3);
      
      service.resetProgress();
      
      const progress = service.getProgress();
      expect(progress.completed).toBe(0);
    });
  });

  describe('getProgress', () => {
    it('should return correct progress', () => {
      const progress = service.getProgress();
      expect(progress).toEqual({
        completed: 0,
        total: 5,
      });
      
      service.markCompleted(1);
      service.markCompleted(2);
      
      const updatedProgress = service.getProgress();
      expect(updatedProgress).toEqual({
        completed: 2,
        total: 5,
      });
    });
  });

  describe('formatProblemForPrompt', () => {
    it('should format problem with tests', () => {
      const problem = service.getProblem(1)!;
      const prompt = service.formatProblemForPrompt(problem, true);
      
      expect(prompt).toContain('Problem:');
      expect(prompt).toContain(problem.description);
      expect(prompt).toContain('Function signature:');
      expect(prompt).toContain(problem.code);
      expect(prompt).toContain('Test cases:');
      expect(prompt).toContain('assert');
    });

    it('should format problem without tests', () => {
      const problem = service.getProblem(1)!;
      const prompt = service.formatProblemForPrompt(problem, false);
      
      expect(prompt).toContain('Problem:');
      expect(prompt).toContain(problem.description);
      expect(prompt).not.toContain('Test cases:');
      expect(prompt).not.toContain('assert');
    });
  });

  describe('extractCodeFromResponse', () => {
    it('should extract code from markdown code block', () => {
      const response = `Here's the solution:
\`\`\`python
def min_cost(cost, m, n):
    return 8
\`\`\`
This function returns the minimum cost.`;
      
      const code = service.extractCodeFromResponse(response);
      expect(code).toBe('def min_cost(cost, m, n):\n    return 8');
    });

    it('should extract function from plain text', () => {
      const response = `The solution is:
def min_cost(cost, m, n):
    if m == 0 and n == 0:
        return cost[0][0]
    return 8

This works by calculating the minimum path.`;
      
      const code = service.extractCodeFromResponse(response);
      expect(code).toContain('def min_cost');
      expect(code).toContain('return cost[0][0]');
    });

    it('should return entire response if no code found', () => {
      const response = 'This is just plain text without any code.';
      const code = service.extractCodeFromResponse(response);
      expect(code).toBe(response);
    });
  });
});