import { BenchmarkSession, BenchmarkProblemResult } from '../types/benchmark';
import { TokenLatencyData, ToolCallLatencyData } from './PerformanceService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

export interface LatencyDistribution {
  histogram: { bin: number; count: number }[];
  mean: number;
  median: number;
  mode: number;
  variance: number;
  standardDeviation: number;
  skewness: number;
  kurtosis: number;
  outliers: number[];
  outlierPercentage: number;
}

export interface StatisticalReport {
  sessionId: string;
  modelId: string;
  mode: string;
  timestamp: Date;
  latencyDistribution: LatencyDistribution;
  performanceMetrics: {
    ttft: {
      mean: number;
      median: number;
      p95: number;
      p99: number;
      outliers: number[];
    };
    tps: {
      mean: number;
      median: number;
      min: number;
      max: number;
      stability: number; // Coefficient of variation
    };
    interTokenLatency: {
      percentiles: { p50: number; p75: number; p90: number; p95: number; p99: number };
      jitter: number;
      burstiness: number; // Ratio of p99 to median
      consistency: number; // 1 - coefficient of variation
    };
  };
  toolPerformance?: {
    byTool: Map<string, {
      callCount: number;
      avgExecutionTime: number;
      avgTotalTime: number;
      successRate: number;
    }>;
    totalToolOverhead: number;
    toolCallFrequency: number;
  };
  anomalies: {
    type: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    affectedMetrics: string[];
  }[];
  contextCorrelation?: {
    tokenCountVsLatency: number; // Correlation coefficient
    positionVsLatency: number; // How latency changes with token position
    temperatureEffect?: number; // Device temperature correlation
  };
}

export class StatisticalAnalysisService {
  private static instance: StatisticalAnalysisService;

  private constructor() {}

  static getInstance(): StatisticalAnalysisService {
    if (!StatisticalAnalysisService.instance) {
      StatisticalAnalysisService.instance = new StatisticalAnalysisService();
    }
    return StatisticalAnalysisService.instance;
  }

  async analyzeSession(session: BenchmarkSession): Promise<StatisticalReport> {
    // Collect all metrics
    const allTTFTs: number[] = [];
    const allTPS: number[] = [];
    const allInterTokenLatencies: number[] = [];
    const toolCallsByType = new Map<string, any[]>();

    session.problems.forEach(problem => {
      if (problem.metrics.ttft) allTTFTs.push(problem.metrics.ttft);
      if (problem.metrics.tps) allTPS.push(problem.metrics.tps);
      if (problem.metrics.interTokenLatencies) {
        allInterTokenLatencies.push(...problem.metrics.interTokenLatencies);
      }
      if (problem.metrics.toolCallLatencies) {
        problem.metrics.toolCallLatencies.forEach(tool => {
          const existing = toolCallsByType.get(tool.toolName) || [];
          existing.push(tool);
          toolCallsByType.set(tool.toolName, existing);
        });
      }
    });

    // Calculate latency distribution
    const latencyDistribution = this.calculateDistribution(allInterTokenLatencies);

    // Calculate performance metrics
    const ttftMetrics = this.calculateMetricStats(allTTFTs);
    const tpsMetrics = this.calculateTPSStats(allTPS);
    const interTokenMetrics = this.calculateInterTokenStats(allInterTokenLatencies);

    // Analyze tool performance
    const toolPerformance = this.analyzeToolPerformance(toolCallsByType, session.problems);

    // Detect anomalies
    const anomalies = this.detectAnomalies(
      allTTFTs, 
      allTPS, 
      allInterTokenLatencies,
      session.systemMetrics
    );

    // Calculate correlations
    const contextCorrelation = this.calculateCorrelations(session.problems);

    return {
      sessionId: session.id,
      modelId: session.modelId,
      mode: session.mode,
      timestamp: new Date(),
      latencyDistribution,
      performanceMetrics: {
        ttft: ttftMetrics,
        tps: tpsMetrics,
        interTokenLatency: interTokenMetrics,
      },
      toolPerformance,
      anomalies,
      contextCorrelation,
    };
  }

  private calculateDistribution(values: number[]): LatencyDistribution {
    if (values.length === 0) {
      return {
        histogram: [],
        mean: 0,
        median: 0,
        mode: 0,
        variance: 0,
        standardDeviation: 0,
        skewness: 0,
        kurtosis: 0,
        outliers: [],
        outlierPercentage: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const median = this.getMedian(sorted);

    // Calculate variance and standard deviation
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Calculate histogram with dynamic bins
    const binCount = Math.min(20, Math.ceil(Math.sqrt(values.length)));
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const binWidth = (max - min) / binCount;
    
    const histogram: { bin: number; count: number }[] = [];
    for (let i = 0; i < binCount; i++) {
      const binStart = min + i * binWidth;
      const binEnd = binStart + binWidth;
      const count = values.filter(v => v >= binStart && v < binEnd).length;
      histogram.push({ bin: binStart + binWidth / 2, count });
    }

    // Find mode (most frequent bin)
    const mode = histogram.reduce((max, bin) => 
      bin.count > max.count ? bin : max, histogram[0]
    ).bin;

    // Calculate skewness and kurtosis
    const skewness = this.calculateSkewness(values, mean, stdDev);
    const kurtosis = this.calculateKurtosis(values, mean, stdDev);

    // Detect outliers using IQR method
    const outliers = this.detectOutliersIQR(sorted);

    return {
      histogram,
      mean,
      median,
      mode,
      variance,
      standardDeviation: stdDev,
      skewness,
      kurtosis,
      outliers,
      outlierPercentage: (outliers.length / values.length) * 100,
    };
  }

  private calculateMetricStats(values: number[]): any {
    if (values.length === 0) {
      return { mean: 0, median: 0, p95: 0, p99: 0, outliers: [] };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const outliers = this.detectOutliersIQR(sorted);

    return {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      median: this.getMedian(sorted),
      p95: this.getPercentile(sorted, 95),
      p99: this.getPercentile(sorted, 99),
      outliers,
    };
  }

  private calculateTPSStats(values: number[]): any {
    if (values.length === 0) {
      return { mean: 0, median: 0, min: 0, max: 0, stability: 0 };
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const stdDev = Math.sqrt(
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
    );

    return {
      mean,
      median: this.getMedian(sorted),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      stability: mean > 0 ? 1 - (stdDev / mean) : 0, // Coefficient of variation inverted
    };
  }

  private calculateInterTokenStats(values: number[]): any {
    if (values.length === 0) {
      return {
        percentiles: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 },
        jitter: 0,
        burstiness: 0,
        consistency: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const median = this.getMedian(sorted);
    const p99 = this.getPercentile(sorted, 99);

    // Calculate jitter as standard deviation of differences
    const differences: number[] = [];
    for (let i = 1; i < values.length; i++) {
      differences.push(Math.abs(values[i] - values[i - 1]));
    }
    const jitter = differences.length > 0
      ? Math.sqrt(differences.reduce((sum, d) => sum + d * d, 0) / differences.length)
      : 0;

    const stdDev = Math.sqrt(
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
    );

    return {
      percentiles: {
        p50: median,
        p75: this.getPercentile(sorted, 75),
        p90: this.getPercentile(sorted, 90),
        p95: this.getPercentile(sorted, 95),
        p99: p99,
      },
      jitter,
      burstiness: median > 0 ? p99 / median : 0,
      consistency: mean > 0 ? 1 - (stdDev / mean) : 0,
    };
  }

  private analyzeToolPerformance(
    toolCallsByType: Map<string, any[]>,
    problems: BenchmarkProblemResult[]
  ): any {
    if (toolCallsByType.size === 0) {
      return undefined;
    }

    const byTool = new Map<string, any>();
    let totalToolTime = 0;
    let totalToolCalls = 0;

    toolCallsByType.forEach((calls, toolName) => {
      const executionTimes = calls.map(c => c.executionTime);
      const totalTimes = calls.map(c => c.totalTime);
      
      totalToolTime += totalTimes.reduce((a, b) => a + b, 0);
      totalToolCalls += calls.length;

      byTool.set(toolName, {
        callCount: calls.length,
        avgExecutionTime: executionTimes.reduce((a, b) => a + b, 0) / calls.length,
        avgTotalTime: totalTimes.reduce((a, b) => a + b, 0) / calls.length,
        successRate: 1.0, // Would need error tracking to calculate this properly
      });
    });

    return {
      byTool,
      totalToolOverhead: totalToolTime,
      toolCallFrequency: totalToolCalls / problems.length,
    };
  }

  private detectAnomalies(
    ttfts: number[],
    tps: number[],
    latencies: number[],
    systemMetrics: any[]
  ): any[] {
    const anomalies: any[] = [];

    // Check for TTFT spikes
    if (ttfts.length > 0) {
      const ttftOutliers = this.detectOutliersIQR([...ttfts].sort((a, b) => a - b));
      if (ttftOutliers.length > 0) {
        const maxOutlier = Math.max(...ttftOutliers);
        const medianTTFT = this.getMedian([...ttfts].sort((a, b) => a - b));
        if (maxOutlier > medianTTFT * 3) {
          anomalies.push({
            type: 'ttft_spike',
            severity: maxOutlier > medianTTFT * 5 ? 'high' : 'medium',
            description: `TTFT spike detected: ${maxOutlier.toFixed(0)}ms (${(maxOutlier/medianTTFT).toFixed(1)}x median)`,
            affectedMetrics: ['ttft'],
          });
        }
      }
    }

    // Check for TPS degradation
    if (tps.length > 3) {
      const firstHalf = tps.slice(0, Math.floor(tps.length / 2));
      const secondHalf = tps.slice(Math.floor(tps.length / 2));
      const firstMean = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondMean = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      
      if (secondMean < firstMean * 0.7) {
        anomalies.push({
          type: 'performance_degradation',
          severity: secondMean < firstMean * 0.5 ? 'high' : 'medium',
          description: `Performance degraded by ${((1 - secondMean/firstMean) * 100).toFixed(0)}% during session`,
          affectedMetrics: ['tps'],
        });
      }
    }

    // Check for latency instability
    if (latencies.length > 10) {
      const stdDev = Math.sqrt(
        latencies.reduce((sum, val) => {
          const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
          return sum + Math.pow(val - mean, 2);
        }, 0) / latencies.length
      );
      const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const cv = stdDev / mean;
      
      if (cv > 0.5) {
        anomalies.push({
          type: 'latency_instability',
          severity: cv > 1.0 ? 'high' : 'medium',
          description: `High latency variance detected (CV: ${cv.toFixed(2)})`,
          affectedMetrics: ['interTokenLatency'],
        });
      }
    }

    return anomalies;
  }

  private calculateCorrelations(problems: BenchmarkProblemResult[]): any {
    const validProblems = problems.filter(p => 
      p.metrics.tokens > 0 && p.metrics.interTokenLatencies
    );

    if (validProblems.length < 3) {
      return undefined;
    }

    // Token count vs average latency correlation
    const tokenCounts = validProblems.map(p => p.metrics.tokens);
    const avgLatencies = validProblems.map(p => {
      const latencies = p.metrics.interTokenLatencies!;
      return latencies.reduce((a, b) => a + b, 0) / latencies.length;
    });

    const tokenVsLatency = this.pearsonCorrelation(tokenCounts, avgLatencies);

    // Position vs latency (within each problem)
    let positionCorrelations: number[] = [];
    validProblems.forEach(p => {
      if (p.metrics.interTokenLatencies && p.metrics.interTokenLatencies.length > 5) {
        const positions = Array.from({length: p.metrics.interTokenLatencies.length}, (_, i) => i);
        const corr = this.pearsonCorrelation(positions, p.metrics.interTokenLatencies);
        if (!isNaN(corr)) {
          positionCorrelations.push(corr);
        }
      }
    });

    const positionVsLatency = positionCorrelations.length > 0
      ? positionCorrelations.reduce((a, b) => a + b, 0) / positionCorrelations.length
      : 0;

    return {
      tokenCountVsLatency: tokenVsLatency,
      positionVsLatency: positionVsLatency,
    };
  }

  // Statistical helper methods
  private getMedian(sorted: number[]): number {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private getPercentile(sorted: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  private detectOutliersIQR(sorted: number[]): number[] {
    const q1 = this.getPercentile(sorted, 25);
    const q3 = this.getPercentile(sorted, 75);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    return sorted.filter(v => v < lowerBound || v > upperBound);
  }

  private calculateSkewness(values: number[], mean: number, stdDev: number): number {
    if (stdDev === 0) return 0;
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 3), 0);
    return (n / ((n - 1) * (n - 2))) * sum;
  }

  private calculateKurtosis(values: number[], mean: number, stdDev: number): number {
    if (stdDev === 0) return 0;
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 4), 0);
    return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum - 
           (3 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3));
  }

  private pearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;
    
    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let denomX = 0;
    let denomY = 0;
    
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    
    const denominator = Math.sqrt(denomX * denomY);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  // Export methods
  async exportToCSV(report: StatisticalReport): Promise<string> {
    const csv: string[] = [];
    
    // Header
    csv.push('Statistical Analysis Report');
    csv.push(`Session ID,${report.sessionId}`);
    csv.push(`Model,${report.modelId}`);
    csv.push(`Mode,${report.mode}`);
    csv.push(`Timestamp,${report.timestamp.toISOString()}`);
    csv.push('');

    // Latency Distribution
    csv.push('Latency Distribution');
    csv.push(`Mean,${report.latencyDistribution.mean.toFixed(2)}`);
    csv.push(`Median,${report.latencyDistribution.median.toFixed(2)}`);
    csv.push(`Std Dev,${report.latencyDistribution.standardDeviation.toFixed(2)}`);
    csv.push(`Skewness,${report.latencyDistribution.skewness.toFixed(3)}`);
    csv.push(`Kurtosis,${report.latencyDistribution.kurtosis.toFixed(3)}`);
    csv.push(`Outliers,${report.latencyDistribution.outlierPercentage.toFixed(1)}%`);
    csv.push('');

    // Performance Metrics
    csv.push('Performance Metrics');
    csv.push('TTFT (ms)');
    csv.push(`Mean,${report.performanceMetrics.ttft.mean.toFixed(0)}`);
    csv.push(`Median,${report.performanceMetrics.ttft.median.toFixed(0)}`);
    csv.push(`P95,${report.performanceMetrics.ttft.p95.toFixed(0)}`);
    csv.push(`P99,${report.performanceMetrics.ttft.p99.toFixed(0)}`);
    csv.push('');

    csv.push('TPS');
    csv.push(`Mean,${report.performanceMetrics.tps.mean.toFixed(1)}`);
    csv.push(`Median,${report.performanceMetrics.tps.median.toFixed(1)}`);
    csv.push(`Min,${report.performanceMetrics.tps.min.toFixed(1)}`);
    csv.push(`Max,${report.performanceMetrics.tps.max.toFixed(1)}`);
    csv.push(`Stability,${(report.performanceMetrics.tps.stability * 100).toFixed(1)}%`);
    csv.push('');

    csv.push('Inter-Token Latency');
    csv.push(`P50,${report.performanceMetrics.interTokenLatency.percentiles.p50.toFixed(0)}`);
    csv.push(`P75,${report.performanceMetrics.interTokenLatency.percentiles.p75.toFixed(0)}`);
    csv.push(`P90,${report.performanceMetrics.interTokenLatency.percentiles.p90.toFixed(0)}`);
    csv.push(`P95,${report.performanceMetrics.interTokenLatency.percentiles.p95.toFixed(0)}`);
    csv.push(`P99,${report.performanceMetrics.interTokenLatency.percentiles.p99.toFixed(0)}`);
    csv.push(`Jitter,${report.performanceMetrics.interTokenLatency.jitter.toFixed(1)}`);
    csv.push(`Burstiness,${report.performanceMetrics.interTokenLatency.burstiness.toFixed(2)}`);
    csv.push('');

    // Anomalies
    if (report.anomalies.length > 0) {
      csv.push('Anomalies Detected');
      report.anomalies.forEach(anomaly => {
        csv.push(`${anomaly.type},${anomaly.severity},${anomaly.description}`);
      });
      csv.push('');
    }

    // Tool Performance
    if (report.toolPerformance) {
      csv.push('Tool Performance');
      csv.push('Tool,Calls,Avg Execution (ms),Avg Total (ms)');
      report.toolPerformance.byTool.forEach((stats, toolName) => {
        csv.push(`${toolName},${stats.callCount},${stats.avgExecutionTime.toFixed(0)},${stats.avgTotalTime.toFixed(0)}`);
      });
      csv.push(`Total Overhead,${report.toolPerformance.totalToolOverhead.toFixed(0)}ms`);
      csv.push('');
    }

    return csv.join('\n');
  }

  async saveReport(report: StatisticalReport): Promise<void> {
    const key = `statistical_report_${report.sessionId}`;
    await AsyncStorage.setItem(key, JSON.stringify(report));
  }

  async loadReport(sessionId: string): Promise<StatisticalReport | null> {
    try {
      const key = `statistical_report_${sessionId}`;
      const data = await AsyncStorage.getItem(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading statistical report:', error);
    }
    return null;
  }

  async exportReportToFile(report: StatisticalReport, format: 'json' | 'csv' = 'json'): Promise<string> {
    const fileName = `statistical_report_${report.sessionId}_${Date.now()}.${format}`;
    const filePath = `${FileSystem.documentDirectory}${fileName}`;
    
    const content = format === 'csv' 
      ? await this.exportToCSV(report)
      : JSON.stringify(report, null, 2);
    
    await FileSystem.writeAsStringAsync(filePath, content);
    return filePath;
  }
}