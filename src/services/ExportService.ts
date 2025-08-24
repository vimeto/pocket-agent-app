/**
 * Comprehensive Export Service
 * Handles export of all benchmark data to SQLite, CSV, and JSON formats
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';
import { BenchmarkSession, BenchmarkProblemResult, SystemMetricSnapshot } from '../types/benchmark';
import { PerformanceService } from './PerformanceService';
import { PowerMeasurementService } from './PowerMeasurementService';
import { StatisticalAnalysisService } from './StatisticalAnalysisService';
import { SystemMonitorService } from './SystemMonitorService';

export interface ExportOptions {
  format: 'sqlite' | 'csv' | 'json';
  includeRawLatencies: boolean;
  includeSystemMetrics: boolean;
  includePowerMeasurements: boolean;
  includeStatisticalAnalysis: boolean;
  compressOutput: boolean;
}

export class ExportService {
  private static instance: ExportService;
  private performanceService: PerformanceService;
  private powerService: PowerMeasurementService;
  private statisticalService: StatisticalAnalysisService;
  private systemMonitor: SystemMonitorService;

  private constructor() {
    this.performanceService = PerformanceService.getInstance();
    this.powerService = PowerMeasurementService.getInstance();
    this.statisticalService = StatisticalAnalysisService.getInstance();
    this.systemMonitor = SystemMonitorService.getInstance();
  }

  static getInstance(): ExportService {
    if (!ExportService.instance) {
      ExportService.instance = new ExportService();
    }
    return ExportService.instance;
  }

  /**
   * Export session data in the specified format
   */
  async exportSession(
    session: BenchmarkSession,
    options: ExportOptions
  ): Promise<string> {
    console.log('[ExportService] Starting export:', options.format);
    
    try {
      let filePath: string;
      
      switch (options.format) {
        case 'sqlite':
          filePath = await this.exportToSQLite(session, options);
          break;
        case 'csv':
          filePath = await this.exportToCSV(session, options);
          break;
        case 'json':
          filePath = await this.exportToJSON(session, options);
          break;
        default:
          throw new Error(`Unsupported format: ${options.format}`);
      }
      
      // Share the file
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: this.getMimeType(options.format),
          dialogTitle: `Export Benchmark Results - ${session.id}`
        });
      }
      
      return filePath;
    } catch (error) {
      console.error('[ExportService] Export failed:', error);
      throw error;
    }
  }

  /**
   * Export to SQLite database
   */
  private async exportToSQLite(
    session: BenchmarkSession,
    options: ExportOptions
  ): Promise<string> {
    const dbName = `benchmark_${session.id}_${Date.now()}.db`;
    const dbPath = `${FileSystem.documentDirectory}SQLite/${dbName}`;
    
    // Ensure SQLite directory exists
    await FileSystem.makeDirectoryAsync(
      `${FileSystem.documentDirectory}SQLite`,
      { intermediates: true }
    );
    
    // Create database
    const db = await SQLite.openDatabaseAsync(dbName);
    
    try {
      // Create tables
      await this.createSQLiteTables(db);
      
      // Insert session data
      await this.insertSessionData(db, session);
      
      // Insert problems and metrics
      for (const problem of session.problems) {
        await this.insertProblemData(db, session.id, problem, options);
      }
      
      // Insert system metrics if requested
      if (options.includeSystemMetrics && session.systemMetrics) {
        await this.insertSystemMetrics(db, session.id, session.systemMetrics);
      }
      
      // Insert statistical analysis if available
      if (options.includeStatisticalAnalysis) {
        const analysis = await this.statisticalService.analyzeSession(session);
        await this.insertStatisticalAnalysis(db, session.id, analysis);
      }
      
      console.log('[ExportService] SQLite export complete:', dbPath);
      return dbPath;
    } finally {
      await db.closeAsync();
    }
  }

  /**
   * Create SQLite tables
   */
  private async createSQLiteTables(db: SQLite.SQLiteDatabase): Promise<void> {
    // Sessions table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        total_problems INTEGER DEFAULT 0,
        successful_problems INTEGER DEFAULT 0,
        device_model TEXT,
        os_version TEXT
      );
    `);

    // Problems table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS problems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        problem_id INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        response TEXT,
        success BOOLEAN NOT NULL,
        inference_time_ms REAL NOT NULL,
        tokens INTEGER DEFAULT 0,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);

    // Performance metrics table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_id INTEGER NOT NULL,
        ttft_ms REAL,
        tps REAL,
        peak_memory_mb REAL,
        avg_memory_mb REAL,
        min_memory_mb REAL,
        avg_cpu_percent REAL,
        peak_cpu_percent REAL,
        energy_consumed_joules REAL,
        energy_per_token_joules REAL,
        min_latency_ms REAL,
        max_latency_ms REAL,
        avg_latency_ms REAL,
        jitter_std_ms REAL,
        p50_latency_ms REAL,
        p95_latency_ms REAL,
        p99_latency_ms REAL,
        FOREIGN KEY (problem_id) REFERENCES problems(id)
      );
    `);

    // Inter-token latencies table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS inter_token_latencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_id INTEGER NOT NULL,
        token_sequence_number INTEGER NOT NULL,
        latency_ms REAL NOT NULL,
        FOREIGN KEY (problem_id) REFERENCES problems(id)
      );
    `);

    // Tool call latencies table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS tool_call_latencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_id INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        preparation_time_ms REAL,
        execution_time_ms REAL,
        processing_time_ms REAL,
        total_time_ms REAL,
        FOREIGN KEY (problem_id) REFERENCES problems(id)
      );
    `);

    // Test results table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_id INTEGER NOT NULL,
        test_case_number INTEGER NOT NULL,
        passed BOOLEAN NOT NULL,
        error_message TEXT,
        FOREIGN KEY (problem_id) REFERENCES problems(id)
      );
    `);

    // System metrics table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS system_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        memory_usage_mb REAL,
        available_memory_mb REAL,
        cpu_usage_percent REAL,
        cpu_temperature_celsius REAL,
        gpu_usage_percent REAL,
        gpu_temperature_celsius REAL,
        battery_level_percent REAL,
        battery_state TEXT,
        power_consumption_ma REAL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);

    // Create indexes
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_problems_session ON problems(session_id);
      CREATE INDEX IF NOT EXISTS idx_performance_problem ON performance_metrics(problem_id);
      CREATE INDEX IF NOT EXISTS idx_latencies_problem ON inter_token_latencies(problem_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_problem ON tool_call_latencies(problem_id);
      CREATE INDEX IF NOT EXISTS idx_test_results_problem ON test_results(problem_id);
      CREATE INDEX IF NOT EXISTS idx_system_metrics_session ON system_metrics(session_id);
    `);
  }

  /**
   * Insert session data into SQLite
   */
  private async insertSessionData(
    db: SQLite.SQLiteDatabase,
    session: BenchmarkSession
  ): Promise<void> {
    const startTime = session.startTime instanceof Date 
      ? session.startTime.getTime() 
      : new Date(session.startTime).getTime();
    
    const endTime = session.endTime 
      ? (session.endTime instanceof Date ? session.endTime.getTime() : new Date(session.endTime).getTime())
      : null;

    const deviceMetrics = await this.systemMonitor.collectMetrics();
    const deviceInfo = {
      chipset: deviceMetrics.deviceChipset,
      hasGPU: deviceMetrics.hasGPU,
      hasNeuralEngine: deviceMetrics.hasNeuralEngine
    };
    
    await db.runAsync(
      `INSERT INTO sessions (id, model_id, mode, start_time, end_time, total_problems, successful_problems, device_model, os_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.modelId,
        session.mode,
        startTime,
        endTime,
        session.problems.length,
        session.problems.filter(p => p.success).length,
        deviceInfo.model,
        deviceInfo.osVersion
      ]
    );
  }

  /**
   * Insert problem data and metrics
   */
  private async insertProblemData(
    db: SQLite.SQLiteDatabase,
    sessionId: string,
    problem: BenchmarkProblemResult,
    options: ExportOptions
  ): Promise<void> {
    const startTime = problem.startTime instanceof Date 
      ? problem.startTime.getTime() 
      : new Date(problem.startTime).getTime();
    
    const endTime = problem.endTime instanceof Date 
      ? problem.endTime.getTime() 
      : new Date(problem.endTime).getTime();

    // Insert problem
    const result = await db.runAsync(
      `INSERT INTO problems (session_id, problem_id, start_time, end_time, response, success, inference_time_ms, tokens, prompt_tokens, completion_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        problem.problemId,
        startTime,
        endTime,
        problem.response,
        problem.success ? 1 : 0,
        problem.metrics.inferenceTime,
        problem.metrics.tokens,
        problem.metrics.promptTokens || null,
        problem.metrics.completionTokens || null
      ]
    );

    const problemDbId = result.lastInsertRowId;

    // Insert performance metrics
    await db.runAsync(
      `INSERT INTO performance_metrics (
        problem_id, ttft_ms, tps, peak_memory_mb, avg_memory_mb, min_memory_mb,
        avg_cpu_percent, peak_cpu_percent, energy_consumed_joules, energy_per_token_joules,
        min_latency_ms, max_latency_ms, avg_latency_ms, jitter_std_ms,
        p50_latency_ms, p95_latency_ms, p99_latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        problemDbId,
        problem.metrics.ttft || null,
        problem.metrics.tps || null,
        problem.metrics.peakMemory,
        problem.metrics.avgMemory,
        problem.metrics.minMemory,
        problem.metrics.avgCPU || null,
        problem.metrics.peakCPU || null,
        problem.metrics.energyConsumed || null,
        problem.metrics.energyPerToken || null,
        problem.metrics.minLatency || null,
        problem.metrics.maxLatency || null,
        problem.metrics.avgLatency || null,
        problem.metrics.jitterStd || null,
        problem.metrics.latencyPercentiles?.p50 || null,
        problem.metrics.latencyPercentiles?.p95 || null,
        problem.metrics.latencyPercentiles?.p99 || null
      ]
    );

    // Insert inter-token latencies if requested
    if (options.includeRawLatencies && problem.metrics.interTokenLatencies) {
      for (let i = 0; i < problem.metrics.interTokenLatencies.length; i++) {
        await db.runAsync(
          `INSERT INTO inter_token_latencies (problem_id, token_sequence_number, latency_ms)
           VALUES (?, ?, ?)`,
          [problemDbId, i, problem.metrics.interTokenLatencies[i]]
        );
      }
    }

    // Insert tool call latencies
    if (problem.metrics.toolCallLatencies) {
      for (const toolCall of problem.metrics.toolCallLatencies) {
        await db.runAsync(
          `INSERT INTO tool_call_latencies (problem_id, tool_name, preparation_time_ms, execution_time_ms, processing_time_ms, total_time_ms)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            problemDbId,
            toolCall.toolName,
            toolCall.preparationTime || null,
            toolCall.executionTime || null,
            toolCall.processingTime || null,
            toolCall.totalTime
          ]
        );
      }
    }

    // Insert test results
    if (problem.testResults) {
      for (let i = 0; i < problem.testResults.length; i++) {
        const test = problem.testResults[i];
        await db.runAsync(
          `INSERT INTO test_results (problem_id, test_case_number, passed, error_message)
           VALUES (?, ?, ?, ?)`,
          [
            problemDbId,
            i + 1,
            test.passed ? 1 : 0,
            test.error || null
          ]
        );
      }
    }
  }

  /**
   * Insert system metrics
   */
  private async insertSystemMetrics(
    db: SQLite.SQLiteDatabase,
    sessionId: string,
    metrics: SystemMetricSnapshot[]
  ): Promise<void> {
    for (const metric of metrics) {
      await db.runAsync(
        `INSERT INTO system_metrics (
          session_id, timestamp_ms, memory_usage_mb, available_memory_mb,
          cpu_usage_percent, cpu_temperature_celsius, gpu_usage_percent,
          gpu_temperature_celsius, battery_level_percent, battery_state,
          power_consumption_ma
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          metric.timestamp,
          metric.memoryUsageMB,
          metric.availableMemoryMB,
          metric.cpuUsage || null,
          metric.cpuTemperature || null,
          metric.gpuUsage || null,
          metric.gpuTemperature || null,
          metric.batteryLevel || null,
          metric.batteryState || null,
          metric.powerConsumptionMA || null
        ]
      );
    }
  }

  /**
   * Insert statistical analysis
   */
  private async insertStatisticalAnalysis(
    db: SQLite.SQLiteDatabase,
    sessionId: string,
    analysis: any
  ): Promise<void> {
    // This would insert the statistical analysis data
    // Implementation depends on the analysis structure
    console.log('[ExportService] Statistical analysis insertion not yet implemented');
  }

  /**
   * Export to CSV format
   */
  private async exportToCSV(
    session: BenchmarkSession,
    options: ExportOptions
  ): Promise<string> {
    const fileName = `benchmark_${session.id}_${Date.now()}.csv`;
    const filePath = `${FileSystem.documentDirectory}${fileName}`;
    
    const csv: string[] = [];
    
    // Header row
    const headers = [
      'session_id', 'model_id', 'mode', 'problem_id', 'problem_number',
      'success', 'tokens', 'prompt_tokens', 'completion_tokens',
      'inference_time_ms', 'ttft_ms', 'tps',
      'peak_memory_mb', 'avg_memory_mb', 'min_memory_mb',
      'avg_cpu_percent', 'peak_cpu_percent',
      'energy_consumed_joules', 'energy_per_token_joules',
      'min_latency_ms', 'max_latency_ms', 'avg_latency_ms',
      'jitter_std_ms', 'p50_latency_ms', 'p95_latency_ms', 'p99_latency_ms',
      'test_cases_total', 'test_cases_passed', 'test_cases_failed'
    ];
    
    if (options.includeRawLatencies) {
      headers.push('inter_token_latencies_json');
    }
    
    if (options.includePowerMeasurements) {
      headers.push('power_measurements_json');
    }
    
    csv.push(headers.join(','));
    
    // Data rows
    for (let i = 0; i < session.problems.length; i++) {
      const problem = session.problems[i];
      const row = [
        session.id,
        session.modelId,
        session.mode,
        problem.problemId,
        i + 1,
        problem.success ? 1 : 0,
        problem.metrics.tokens,
        problem.metrics.promptTokens || '',
        problem.metrics.completionTokens || '',
        problem.metrics.inferenceTime,
        problem.metrics.ttft || '',
        problem.metrics.tps || '',
        problem.metrics.peakMemory,
        problem.metrics.avgMemory,
        problem.metrics.minMemory,
        problem.metrics.avgCPU || '',
        problem.metrics.peakCPU || '',
        problem.metrics.energyConsumed || '',
        problem.metrics.energyPerToken || '',
        problem.metrics.minLatency || '',
        problem.metrics.maxLatency || '',
        problem.metrics.avgLatency || '',
        problem.metrics.jitterStd || '',
        problem.metrics.latencyPercentiles?.p50 || '',
        problem.metrics.latencyPercentiles?.p95 || '',
        problem.metrics.latencyPercentiles?.p99 || '',
        problem.testResults?.length || 0,
        problem.testResults?.filter(t => t.passed).length || 0,
        problem.testResults?.filter(t => !t.passed).length || 0
      ];
      
      if (options.includeRawLatencies) {
        row.push(JSON.stringify(problem.metrics.interTokenLatencies || []));
      }
      
      if (options.includePowerMeasurements) {
        // Add power measurements if available
        row.push('{}'); // Placeholder for now
      }
      
      csv.push(row.map(v => this.escapeCSV(String(v))).join(','));
    }
    
    await FileSystem.writeAsStringAsync(filePath, csv.join('\n'));
    console.log('[ExportService] CSV export complete:', filePath);
    return filePath;
  }

  /**
   * Save a JSON file directly
   */
  async saveJSONFile(filename: string, data: any): Promise<string> {
    const filePath = `${FileSystem.documentDirectory}${filename}`;
    const jsonString = JSON.stringify(data, null, 2);
    await FileSystem.writeAsStringAsync(filePath, jsonString);
    return filePath;
  }

  /**
   * Export to JSON format
   */
  async exportToJSON(
    session: BenchmarkSession,
    options: ExportOptions
  ): Promise<string> {
    const fileName = `benchmark_${session.id}_${Date.now()}.json`;
    const filePath = `${FileSystem.documentDirectory}${fileName}`;
    
    // Build comprehensive export data
    const exportData = {
      export_metadata: {
        version: '1.0',
        exported_at: new Date().toISOString(),
        export_type: 'complete_session_data',
        total_problems: session.problems.length,
        schema_version: '1.0'
      },
      session,
      // Add additional enriched data
      aggregates: await this.calculateAggregates(session),
      device_info: await (async () => {
        const metrics = await this.systemMonitor.collectMetrics();
        return {
          chipset: metrics.deviceChipset,
          hasGPU: metrics.hasGPU,
          hasNeuralEngine: metrics.hasNeuralEngine
        };
      })()
    };
    
    // Add statistical analysis if requested
    if (options.includeStatisticalAnalysis) {
      exportData['statistical_analysis'] = await this.statisticalService.analyzeSession(session);
    }
    
    // Add power profile if available
    if (options.includePowerMeasurements) {
      exportData['power_profile'] = await this.powerService.getPowerProfile();
    }
    
    const jsonString = JSON.stringify(exportData, null, 2);
    
    if (options.compressOutput) {
      // TODO: Implement compression
      console.log('[ExportService] Compression not yet implemented');
    }
    
    await FileSystem.writeAsStringAsync(filePath, jsonString);
    console.log('[ExportService] JSON export complete:', filePath);
    return filePath;
  }

  /**
   * Calculate session aggregates
   */
  private async calculateAggregates(session: BenchmarkSession): Promise<any> {
    const totalTokens = session.problems.reduce((sum, p) => sum + p.metrics.tokens, 0);
    const totalEnergy = session.problems.reduce((sum, p) => sum + (p.metrics.energyConsumed || 0), 0);
    const successfulProblems = session.problems.filter(p => p.success).length;
    
    return {
      total_problems: session.problems.length,
      successful_problems: successfulProblems,
      success_rate: successfulProblems / session.problems.length,
      total_tokens: totalTokens,
      total_energy_joules: totalEnergy,
      avg_tokens_per_problem: totalTokens / session.problems.length,
      avg_energy_per_token: totalEnergy / totalTokens,
      efficiency_tokens_per_joule: totalTokens / totalEnergy
    };
  }

  /**
   * Escape CSV values
   */
  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Get MIME type for format
   */
  private getMimeType(format: 'sqlite' | 'csv' | 'json'): string {
    switch (format) {
      case 'sqlite':
        return 'application/x-sqlite3';
      case 'csv':
        return 'text/csv';
      case 'json':
        return 'application/json';
      default:
        return 'application/octet-stream';
    }
  }
}