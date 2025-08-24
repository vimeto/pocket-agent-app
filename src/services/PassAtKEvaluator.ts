import { MBPPProblem, BenchmarkProblemResult } from '../types/benchmark';
import { InferenceService } from './InferenceService';
import { BenchmarkEvaluationService } from './BenchmarkEvaluationService';
import { executeBenchmarkProblem } from '../utils/benchmarkExecutor';
import { BenchmarkMode } from '../types/benchmark';

export interface PassAtKConfig {
  k: number[];  // e.g., [1, 3, 5, 10]
  n: number;    // Total samples to generate (must be >= max(k))
  temperature: number;  // Sampling temperature for diversity
  topP: number;
  seed?: number;  // For reproducibility
}

export interface PassAtKResult {
  problemId: number;
  n: number;  // Total samples generated
  passAtK: { [k: number]: boolean };  // k -> whether any of first k passed
  successfulSamples: number[];  // Indices of successful samples
  totalPassed: number;  // Total number of successful samples
  samples: {
    index: number;
    code: string;
    passed: boolean;
    error?: string;
    tokens: number;
    inferenceTime: number;
  }[];
}

export interface PassAtKSessionResult {
  sessionId: string;
  modelId: string;
  mode: BenchmarkMode;
  config: PassAtKConfig;
  problems: PassAtKResult[];
  aggregate: {
    passAt1: number;  // Percentage
    passAt3: number;
    passAt5: number;
    passAt10: number;
    avgSamplesNeeded: number;  // Average samples needed for first success
    totalTokens: number;
    totalTime: number;
  };
}

export class PassAtKEvaluator {
  private static instance: PassAtKEvaluator;
  private inferenceService: InferenceService;
  private evaluationService: BenchmarkEvaluationService;

  private constructor() {
    this.inferenceService = InferenceService.getInstance();
    this.evaluationService = BenchmarkEvaluationService.getInstance();
  }

  static getInstance(): PassAtKEvaluator {
    if (!PassAtKEvaluator.instance) {
      PassAtKEvaluator.instance = new PassAtKEvaluator();
    }
    return PassAtKEvaluator.instance;
  }

  async evaluateProblem(
    problem: MBPPProblem,
    mode: BenchmarkMode,
    config: PassAtKConfig,
    modelId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<PassAtKResult> {
    // Validate config
    const maxK = Math.max(...config.k);
    if (config.n < maxK) {
      throw new Error(`n (${config.n}) must be >= max(k) (${maxK})`);
    }

    const samples: any[] = [];
    const successfulSamples: number[] = [];
    let totalTokens = 0;
    let totalTime = 0;

    // Generate n samples with temperature sampling
    for (let i = 0; i < config.n; i++) {
      if (onProgress) {
        onProgress(i, config.n);
      }

      const startTime = Date.now();
      
      try {
        // Configure inference with temperature for diversity
        const inferenceConfig = {
          maxTokens: 1024,
          temperature: config.temperature,
          topK: 40,
          topP: config.topP,
          stopTokens: ['</s>', '<|endoftext|>', '<|end|>', '<|im_end|>', '<|eom_id|>'],
          seed: config.seed ? config.seed + i : undefined,  // Different seed per sample
        };

        // Generate solution
        const messageId = `passk_${problem.id}_${i}_${Date.now()}`;
        const sessionId = `passk_session_${Date.now()}`;
        
        const result = await executeBenchmarkProblem(
          problem,
          mode,
          this.inferenceService,
          inferenceConfig,
          messageId,
          sessionId,
          () => {}  // No token callback needed
        );

        // Evaluate the generated code
        const evaluation = this.evaluationService.evaluateSolution(
          result.code,
          problem.test_cases
        );

        const inferenceTime = Date.now() - startTime;
        const tokenCount = result.response.length / 4;  // Approximate

        samples.push({
          index: i,
          code: result.code,
          passed: evaluation.success,
          error: evaluation.error,
          tokens: tokenCount,
          inferenceTime,
        });

        if (evaluation.success) {
          successfulSamples.push(i);
        }

        totalTokens += tokenCount;
        totalTime += inferenceTime;

      } catch (error) {
        // Sample generation failed
        samples.push({
          index: i,
          code: '',
          passed: false,
          error: error instanceof Error ? error.message : String(error),
          tokens: 0,
          inferenceTime: Date.now() - startTime,
        });
      }

      // Early stopping optimization if we've already succeeded at all k values
      if (this.canEarlyStop(successfulSamples, config.k, i + 1)) {
        console.log(`[PassAtK] Early stopping at sample ${i + 1}, all k values satisfied`);
        break;
      }
    }

    // Calculate pass@k for each k value
    const passAtK: { [k: number]: boolean } = {};
    for (const k of config.k) {
      passAtK[k] = this.calculatePassAtK(successfulSamples, k);
    }

    return {
      problemId: problem.id,
      n: samples.length,
      passAtK,
      successfulSamples,
      totalPassed: successfulSamples.length,
      samples,
    };
  }

  async evaluateSession(
    problems: MBPPProblem[],
    mode: BenchmarkMode,
    config: PassAtKConfig,
    modelId: string,
    onProgress?: (problemIndex: number, totalProblems: number, sampleIndex: number, totalSamples: number) => void
  ): Promise<PassAtKSessionResult> {
    const sessionId = `passk_${Date.now()}`;
    const results: PassAtKResult[] = [];
    let totalTokens = 0;
    let totalTime = 0;

    for (let p = 0; p < problems.length; p++) {
      const problem = problems[p];
      
      const result = await this.evaluateProblem(
        problem,
        mode,
        config,
        modelId,
        (current, total) => {
          if (onProgress) {
            onProgress(p, problems.length, current, total);
          }
        }
      );

      results.push(result);
      totalTokens += result.samples.reduce((sum, s) => sum + s.tokens, 0);
      totalTime += result.samples.reduce((sum, s) => sum + s.inferenceTime, 0);
    }

    // Calculate aggregate statistics
    const aggregate = this.calculateAggregateStats(results, config);
    aggregate.totalTokens = totalTokens;
    aggregate.totalTime = totalTime;

    return {
      sessionId,
      modelId,
      mode,
      config,
      problems: results,
      aggregate,
    };
  }

  private calculatePassAtK(successfulSamples: number[], k: number): boolean {
    // Check if any of the first k samples passed
    return successfulSamples.some(index => index < k);
  }

  private canEarlyStop(successfulSamples: number[], kValues: number[], currentN: number): boolean {
    // We can stop early if we have at least one success within the first k samples
    // for all k values we're testing
    
    // But we need at least max(k) samples
    const maxK = Math.max(...kValues);
    if (currentN < maxK) {
      return false;
    }

    // Check if all k values are satisfied
    for (const k of kValues) {
      const hasPassedAtK = successfulSamples.some(index => index < k);
      if (!hasPassedAtK && currentN < k * 2) {
        // If we haven't passed at k yet and haven't generated enough samples,
        // continue (heuristic: generate at least 2*k samples before giving up)
        return false;
      }
    }

    // If we have successes for all k values, we can stop
    return kValues.every(k => this.calculatePassAtK(successfulSamples, k));
  }

  private calculateAggregateStats(
    results: PassAtKResult[],
    config: PassAtKConfig
  ): any {
    const stats: any = {};

    // Calculate pass@k percentages
    for (const k of [1, 3, 5, 10]) {
      if (config.k.includes(k)) {
        const passed = results.filter(r => r.passAtK[k]).length;
        stats[`passAt${k}`] = (passed / results.length) * 100;
      } else {
        stats[`passAt${k}`] = 0;
      }
    }

    // Calculate average samples needed for first success
    const samplesNeeded = results.map(r => {
      if (r.successfulSamples.length === 0) {
        return r.n;  // No success, needed all samples
      }
      return r.successfulSamples[0] + 1;  // First success index + 1
    });
    stats.avgSamplesNeeded = samplesNeeded.reduce((a, b) => a + b, 0) / samplesNeeded.length;

    return stats;
  }

  // Statistical estimator for pass@k from the paper
  // "Evaluating Large Language Models Trained on Code"
  estimatePassAtK(n: number, c: number, k: number): number {
    // n: total samples
    // c: number of correct samples
    // k: k value for pass@k
    
    if (n - c < k) {
      return 1.0;
    }
    
    // Combinatorial calculation
    return 1.0 - this.combination(n - c, k) / this.combination(n, k);
  }

  private combination(n: number, k: number): number {
    if (k > n) return 0;
    if (k === 0) return 1;
    
    let result = 1;
    for (let i = 0; i < k; i++) {
      result *= (n - i) / (i + 1);
    }
    return result;
  }

  // Export results to format suitable for papers
  exportToLatex(results: PassAtKSessionResult): string {
    const latex: string[] = [];
    
    latex.push('\\begin{table}[h]');
    latex.push('\\centering');
    latex.push('\\caption{Pass@k Results}');
    latex.push('\\begin{tabular}{lcccc}');
    latex.push('\\hline');
    latex.push('Model & Pass@1 & Pass@3 & Pass@5 & Pass@10 \\\\');
    latex.push('\\hline');
    
    latex.push(`${results.modelId} & ` +
      `${results.aggregate.passAt1.toFixed(1)}\\% & ` +
      `${results.aggregate.passAt3.toFixed(1)}\\% & ` +
      `${results.aggregate.passAt5.toFixed(1)}\\% & ` +
      `${results.aggregate.passAt10.toFixed(1)}\\% \\\\`
    );
    
    latex.push('\\hline');
    latex.push('\\end{tabular}');
    latex.push('\\end{table}');
    
    return latex.join('\n');
  }

  exportToCSV(results: PassAtKSessionResult): string {
    const csv: string[] = [];
    
    // Header
    csv.push('Problem ID,N,Pass@1,Pass@3,Pass@5,Pass@10,Total Passed,Tokens,Time (ms)');
    
    // Data rows
    for (const problem of results.problems) {
      const row = [
        problem.problemId,
        problem.n,
        problem.passAtK[1] ? 1 : 0,
        problem.passAtK[3] ? 1 : 0,
        problem.passAtK[5] ? 1 : 0,
        problem.passAtK[10] ? 1 : 0,
        problem.totalPassed,
        problem.samples.reduce((sum, s) => sum + s.tokens, 0),
        problem.samples.reduce((sum, s) => sum + s.inferenceTime, 0),
      ];
      csv.push(row.join(','));
    }
    
    // Summary row
    csv.push('');
    csv.push('Summary');
    csv.push(`Pass@1,${results.aggregate.passAt1.toFixed(2)}%`);
    csv.push(`Pass@3,${results.aggregate.passAt3.toFixed(2)}%`);
    csv.push(`Pass@5,${results.aggregate.passAt5.toFixed(2)}%`);
    csv.push(`Pass@10,${results.aggregate.passAt10.toFixed(2)}%`);
    csv.push(`Avg Samples Needed,${results.aggregate.avgSamplesNeeded.toFixed(2)}`);
    csv.push(`Total Tokens,${results.aggregate.totalTokens}`);
    csv.push(`Total Time (s),${(results.aggregate.totalTime / 1000).toFixed(2)}`);
    
    return csv.join('\n');
  }
}