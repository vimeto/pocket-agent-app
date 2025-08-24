/**
 * Autonomous Benchmark Service - Simplified Foreground-Only Version
 *
 * Provides long-running benchmark capability while app is in foreground.
 * Features:
 * - Thermal and battery monitoring with auto-pause
 * - Checkpoint/resume capability for interruptions
 * - No background execution dependencies
 */

import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InferenceService } from './InferenceService';
import { BenchmarkEvaluationService } from './BenchmarkEvaluationService';
import { SystemMonitorService } from './SystemMonitorService';
import { PowerMeasurementService } from './PowerMeasurementService';
import { PerformanceService } from './PerformanceService';
import { MBPPDatasetService } from './MBPPDatasetService';
import { BenchmarkMode } from '../types/benchmark';
import { executeBenchmarkProblem } from '../utils/benchmarkExecutor';
import { useBenchmarkStore } from '../stores/useBenchmarkStore';

export interface AutonomousBenchmarkConfig {
  maxHours: number;
  minBatteryLevel: number;  // Minimum battery % to continue
  maxTemperature: number;  // Maximum temperature °C
  pauseBetweenProblems: number; // ms
  cooldownTime: number; // ms when thermal throttling detected
  saveCheckpoints: boolean;
  iterations: number; // Number of iterations per problem
  startProblemId: number;
  endProblemId: number;
}

export interface JointBenchmarkConfig extends AutonomousBenchmarkConfig {
  batchSize: number; // Number of problems to run before saving
  modes: BenchmarkMode[]; // Modes to run for each batch
}

export interface BenchmarkCheckpoint {
  sessionId: string;
  modelId: string;
  mode: BenchmarkMode;
  config: AutonomousBenchmarkConfig;
  completedProblems: number[];
  currentProblemId?: number;
  startTime: number;
  lastCheckpointTime: number;
  totalTokensGenerated: number;
  totalEnergyConsumed: number;
  state: 'running' | 'paused' | 'completed' | 'failed';
  pauseReason?: string;
  statistics: {
    averageTTFT: number;
    averageTPS: number;
    thermalThrottleEvents: number;
    batteryPauseEvents: number;
  };
}

const CHECKPOINT_KEY = 'autonomous_benchmark_checkpoint';

export class AutonomousBenchmarkService {
  private static instance: AutonomousBenchmarkService;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private isJointMode: boolean = false;
  private currentCheckpoint: BenchmarkCheckpoint | null = null;
  private abortController: AbortController | null = null;
  private appStateSubscription: any = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private jointBenchmarkComplete: boolean = false;
  private jointBenchmarkSummary: any | null = null;
  private jointBenchmarkFilePath: string | null = null;
  private batchExportPaths: Map<string, string> = new Map(); // Track batch export file paths

  // Service references
  private inferenceService: InferenceService;
  private evaluationService: BenchmarkEvaluationService;
  private systemMonitor: SystemMonitorService;
  private powerService: PowerMeasurementService;
  private performanceService: PerformanceService;
  private datasetService: MBPPDatasetService;

  private constructor() {
    this.inferenceService = InferenceService.getInstance();
    this.evaluationService = BenchmarkEvaluationService.getInstance();
    this.systemMonitor = SystemMonitorService.getInstance();
    this.powerService = PowerMeasurementService.getInstance();
    this.performanceService = PerformanceService.getInstance();
    this.datasetService = MBPPDatasetService.getInstance();

    this.setupAppStateListener();
    this.loadLastCheckpoint();
  }

  static getInstance(): AutonomousBenchmarkService {
    if (!AutonomousBenchmarkService.instance) {
      AutonomousBenchmarkService.instance = new AutonomousBenchmarkService();
    }
    return AutonomousBenchmarkService.instance;
  }

  private setupAppStateListener() {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange.bind(this)
    );
  }

  private handleAppStateChange(nextAppState: AppStateStatus) {
    if (nextAppState === 'background' && this.isRunning) {
      console.log('[AutonomousBenchmark] App backgrounded, pausing');
      this.pause('App went to background');
    } else if (nextAppState === 'active' && this.isPaused) {
      console.log('[AutonomousBenchmark] App active, checking resume conditions');
      this.checkAndResume();
    }
  }

  /**
   * Start autonomous benchmark run
   */
  async start(
    modelId: string,
    mode: BenchmarkMode,
    config: AutonomousBenchmarkConfig
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('Benchmark already running');
    }

    console.log('[AutonomousBenchmark] Starting autonomous run', { modelId, mode, config });

    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();

    const sessionId = `auto_${Date.now()}`;

    // Create initial checkpoint
    this.currentCheckpoint = {
      sessionId,
      modelId,
      mode,
      config,
      completedProblems: [],
      startTime: Date.now(),
      lastCheckpointTime: Date.now(),
      totalTokensGenerated: 0,
      totalEnergyConsumed: 0,
      state: 'running',
      statistics: {
        averageTTFT: 0,
        averageTPS: 0,
        thermalThrottleEvents: 0,
        batteryPauseEvents: 0,
      }
    };

    // Save initial checkpoint
    await this.saveCheckpoint();

    // Load model
    await this.inferenceService.loadModel(modelId);

    // Start monitoring
    this.startMonitoring();

    // Start benchmark store session
    const benchmarkStore = useBenchmarkStore.getState();
    benchmarkStore.startSession(modelId, mode);

    // Start execution
    this.executeProblems();
  }

  /**
   * Main execution loop
   */
  private async executeProblems() {
    if (!this.currentCheckpoint || !this.isRunning) return;

    const { config, completedProblems, mode, modelId } = this.currentCheckpoint;
    const maxEndTime = this.currentCheckpoint.startTime + (config.maxHours * 60 * 60 * 1000);

    // Get problems to execute
    const problems = this.datasetService.getProblemsInRange(
      config.startProblemId,
      config.endProblemId
    );

    console.log(`[AutonomousBenchmark] Found ${problems.length} problems in range ${config.startProblemId}-${config.endProblemId}`);
    console.log(`[AutonomousBenchmark] Problem IDs:`, problems.map(p => p.id));

    for (const problem of problems) {
      // Skip completed problems
      if (completedProblems.includes(problem.id)) {
        continue;
      }

      // Check stop conditions
      if (!this.isRunning || this.isPaused) {
        break;
      }

      // Check time limit
      if (Date.now() > maxEndTime) {
        console.log('[AutonomousBenchmark] Max time reached');
        await this.complete('Max time reached');
        break;
      }

      // Check system conditions
      const canContinue = await this.checkSystemConditions();
      if (!canContinue) {
        await this.pause('System conditions not met');
        break;
      }

      // Update current problem
      this.currentCheckpoint.currentProblemId = problem.id;

      // Run iterations for this problem
      for (let iteration = 0; iteration < config.iterations; iteration++) {
        if (!this.isRunning || this.isPaused) break;

        console.log(`[AutonomousBenchmark] Problem ${problem.id}, iteration ${iteration + 1}/${config.iterations}`);

        try {
          // Execute the problem
          const messageId = `${this.currentCheckpoint.sessionId}_p${problem.id}_i${iteration}`;
          const sessionId = this.currentCheckpoint.sessionId;

          // Start power tracking (performance tracking is handled in InferenceService)
          await this.powerService.startSession(sessionId);

          const result = await executeBenchmarkProblem(
            problem,
            mode,
            this.inferenceService,
            { temperature: 0.7 }, // TODO: Get from config
            messageId,
            sessionId,
            (_token) => {
              // Token callback
              this.currentCheckpoint!.totalTokensGenerated++;
            },
            modelId,
            iteration === 0  // isFirstIteration: only clear filesystem on first iteration
          );

          // End performance tracking - use the actual messageId from execution
          // Note: executeBenchmarkProblem returns actualMessageId which includes iteration suffix
          // We don't need to call endInference here as it's already called in InferenceService
          // this.performanceService.endInference(messageId, sessionId);
          const powerMetrics = await this.powerService.endSession();

          // Update energy consumed
          if (powerMetrics?.totalEnergy) {
            this.currentCheckpoint.totalEnergyConsumed += powerMetrics.totalEnergy;
          }

          // Get performance metrics using the actual messageId
          const effectiveMessageId = result.actualMessageId || messageId;
          const messageMetrics = this.performanceService.getMessageMetrics(effectiveMessageId);
          const latencyReport = this.performanceService.getLatencyReport(effectiveMessageId);

          // Use first iteration TTFT if available (for accurate initial response time)
          const actualTTFT = result.firstIterationTTFT || messageMetrics?.ttft;

          console.log('[AutonomousBenchmark] Retrieved metrics for messageId:', effectiveMessageId);
          console.log('[AutonomousBenchmark] First iteration TTFT:', result.firstIterationTTFT);
          console.log('[AutonomousBenchmark] Current metrics TTFT:', messageMetrics?.ttft);
          console.log('[AutonomousBenchmark] Using TTFT:', actualTTFT);
          console.log('[AutonomousBenchmark] TPS:', messageMetrics?.tps);
          console.log('[AutonomousBenchmark] Aggregated tool latencies:', result.aggregatedToolCallLatencies?.length || 0);

          // Evaluate solution (or mark as failed if no code extracted)
          const evaluation = result.code
            ? await this.evaluationService.evaluateSolution(problem, result.code)
            : { success: false, testResults: [] };

          // Always store result (even if no code extracted) with FULL metrics
          const benchmarkStore = useBenchmarkStore.getState();
          benchmarkStore.addProblemResult({
              problemId: problem.id,
              success: evaluation.success,
              response: result.response,
              testResults: evaluation.testResults,
              startTime: new Date(this.currentCheckpoint.startTime),
              endTime: new Date(),
              metrics: {
                tokens: messageMetrics?.totalTokens || this.currentCheckpoint.totalTokensGenerated,
                inferenceTime: messageMetrics?.totalResponseTime || (Date.now() - this.currentCheckpoint.startTime),
                ttft: actualTTFT,  // Use first iteration TTFT for accurate initial response time
                tps: messageMetrics?.tps,
                peakMemory: 0,  // TODO: Get from system monitor
                avgMemory: 0,    // TODO: Get from system monitor
                minMemory: 0,    // TODO: Get from system monitor
                avgCPU: 0,       // TODO: Get from system monitor
                interTokenLatencies: latencyReport?.interTokenLatencies || messageMetrics?.tokenLatencyData?.interTokenLatencies,
                toolCallLatencies: result.aggregatedToolCallLatencies || messageMetrics?.toolCallLatencies || [],  // Use aggregated latencies from all iterations
              },
          });

        } catch (error) {
          console.error(`[AutonomousBenchmark] Error on problem ${problem.id}:`, error);
        }

        // Pause between iterations
        if (iteration < config.iterations - 1) {
          await this.sleep(config.pauseBetweenProblems);
        }
      }

      // Mark problem as completed
      this.currentCheckpoint.completedProblems.push(problem.id);

      // Update statistics
      this.updateStatistics();

      // Save checkpoint periodically
      if (this.currentCheckpoint.completedProblems.length % 5 === 0) {
        await this.saveCheckpoint();
      }

      // Pause between problems
      await this.sleep(config.pauseBetweenProblems);
    }

    // Benchmark complete (only for non-joint mode)
    // Joint mode handles completion in startJointBenchmark
    if (this.isRunning && !this.isPaused && !this.isJointMode) {
      await this.complete('All problems completed');
    }
  }

  /**
   * Pause benchmark execution
   */
  async pause(reason: string) {
    if (!this.isRunning || this.isPaused) return;

    console.log('[AutonomousBenchmark] Pausing:', reason);
    this.isPaused = true;

    if (this.currentCheckpoint) {
      this.currentCheckpoint.state = 'paused';
      this.currentCheckpoint.pauseReason = reason;
      await this.saveCheckpoint();
    }
  }

  /**
   * Resume from pause
   */
  async resume() {
    if (!this.isPaused || !this.currentCheckpoint) return;

    console.log('[AutonomousBenchmark] Resuming');
    this.isPaused = false;
    this.currentCheckpoint.state = 'running';
    this.currentCheckpoint.pauseReason = undefined;

    await this.saveCheckpoint();
    this.executeProblems();
  }

  /**
   * Stop benchmark execution
   */
  async stop() {
    console.log('[AutonomousBenchmark] Stopping');
    this.isRunning = false;
    this.isPaused = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.currentCheckpoint) {
      this.currentCheckpoint.state = 'failed';
      this.currentCheckpoint.pauseReason = 'User stopped';
      await this.saveCheckpoint();
    }

    // Stop services
    this.systemMonitor.stopMonitoring();
    if (this.currentCheckpoint?.sessionId) {
      this.powerService.endSession();
    }
  }

  /**
   * Complete benchmark successfully
   */
  private async complete(reason: string) {
    console.log('[AutonomousBenchmark] Completing:', reason);
    this.isRunning = false;

    if (this.currentCheckpoint) {
      this.currentCheckpoint.state = 'completed';
      await this.saveCheckpoint();
    }

    this.cleanup();
  }

  /**
   * Check system conditions (battery, temperature)
   */
  private async checkSystemConditions(): Promise<boolean> {
    if (!this.currentCheckpoint) return false;

    const metrics = await this.systemMonitor.collectMetrics();
    const { config } = this.currentCheckpoint;

    // Check battery (skip check if invalid value like -100)
    if (metrics.batteryLevel !== undefined &&
        metrics.batteryLevel >= 0 &&
        metrics.batteryLevel < config.minBatteryLevel) {
      console.log(`[AutonomousBenchmark] Battery too low: ${metrics.batteryLevel}%`);
      this.currentCheckpoint.statistics.batteryPauseEvents++;
      return false;
    }

    // Log warning for invalid battery values but continue
    if (metrics.batteryLevel !== undefined && metrics.batteryLevel < 0) {
      console.log(`[AutonomousBenchmark] Invalid battery level: ${metrics.batteryLevel}%, skipping battery check`);
    }

    // Check temperature
    const temperature = metrics.cpuTemperature || 0;
    if (temperature > config.maxTemperature) {
      console.log(`[AutonomousBenchmark] Temperature too high: ${temperature}°C`);
      this.currentCheckpoint.statistics.thermalThrottleEvents++;

      // Cool down period
      await this.sleep(config.cooldownTime);
      return false;
    }

    return true;
  }

  /**
   * Start system monitoring
   */
  private startMonitoring() {
    this.systemMonitor.startMonitoring();

    // Check conditions periodically
    this.monitoringInterval = setInterval(() => {
      if (this.isRunning && !this.isPaused) {
        this.checkSystemConditions().then(canContinue => {
          if (!canContinue) {
            this.pause('System conditions not met');
          }
        });
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Update benchmark statistics
   */
  private updateStatistics() {
    if (!this.currentCheckpoint) return;

    const sessionMetrics = this.performanceService.getSessionMetrics(this.currentCheckpoint.sessionId);
    if (sessionMetrics) {
      this.currentCheckpoint.statistics.averageTTFT = sessionMetrics.aggregateMetrics.avgTTFT;
      this.currentCheckpoint.statistics.averageTPS = sessionMetrics.aggregateMetrics.avgTPS;
    }
  }

  /**
   * Check and resume from saved checkpoint
   */
  private async checkAndResume() {
    const canResume = await this.checkSystemConditions();
    if (canResume && this.currentCheckpoint?.state === 'paused') {
      await this.resume();
    }
  }

  /**
   * Save checkpoint to storage
   */
  private async saveCheckpoint() {
    if (!this.currentCheckpoint) return;

    try {
      await AsyncStorage.setItem(CHECKPOINT_KEY, JSON.stringify(this.currentCheckpoint));
      this.currentCheckpoint.lastCheckpointTime = Date.now();
    } catch (error) {
      console.error('[AutonomousBenchmark] Failed to save checkpoint:', error);
    }
  }

  /**
   * Load last checkpoint from storage
   */
  private async loadLastCheckpoint() {
    try {
      const data = await AsyncStorage.getItem(CHECKPOINT_KEY);
      if (data) {
        const checkpoint = JSON.parse(data) as BenchmarkCheckpoint;
        if (checkpoint.state === 'paused') {
          this.currentCheckpoint = checkpoint;
          console.log('[AutonomousBenchmark] Loaded checkpoint:', checkpoint.sessionId);
        }
      }
    } catch (error) {
      console.error('[AutonomousBenchmark] Failed to load checkpoint:', error);
    }
  }

  /**
   * Resume from a saved checkpoint
   */
  async resumeFromCheckpoint(checkpoint?: BenchmarkCheckpoint) {
    const checkpointToUse = checkpoint || this.currentCheckpoint;
    if (!checkpointToUse) {
      throw new Error('No checkpoint to resume from');
    }

    console.log('[AutonomousBenchmark] Resuming from checkpoint:', checkpointToUse.sessionId);

    this.currentCheckpoint = checkpointToUse;
    this.isRunning = true;
    this.isPaused = false;

    // Reload model
    await this.inferenceService.loadModel(checkpointToUse.modelId);

    // Restart monitoring
    this.startMonitoring();

    // Resume execution
    await this.resume();
  }

  /**
   * Clean up resources
   */
  private cleanup() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    this.systemMonitor.stopMonitoring();
  }

  /**
   * Helper sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current checkpoint
   */
  getCheckpoint(): BenchmarkCheckpoint | null {
    return this.currentCheckpoint;
  }

  /**
   * Clear saved checkpoint
   */
  async clearCheckpoint() {
    try {
      await AsyncStorage.removeItem(CHECKPOINT_KEY);
      this.currentCheckpoint = null;
    } catch (error) {
      console.error('[AutonomousBenchmark] Failed to clear checkpoint:', error);
    }
  }

  /**
   * Check if benchmark is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Check if benchmark is paused
   */
  isBenchmarkPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Check if joint benchmark is complete
   */
  isJointBenchmarkComplete(): boolean {
    return this.jointBenchmarkComplete;
  }

  /**
   * Get joint benchmark summary
   */
  getJointBenchmarkSummary(): any | null {
    return this.jointBenchmarkSummary;
  }

  /**
   * Get joint benchmark file path
   */
  getJointBenchmarkFilePath(): string | null {
    return this.jointBenchmarkFilePath;
  }

  /**
   * Reset joint benchmark state
   */
  resetJointBenchmarkState(): void {
    console.log('[AutonomousBenchmark] Resetting joint benchmark state');
    console.log(`[AutonomousBenchmark] Clearing filepath: ${this.jointBenchmarkFilePath}`);
    this.jointBenchmarkComplete = false;
    this.jointBenchmarkSummary = null;
    this.jointBenchmarkFilePath = null;
    this.batchExportPaths.clear();
  }

  /**
   * Share joint benchmark results
   */
  async shareJointBenchmarkResults(): Promise<void> {
    console.log(`[AutonomousBenchmark] Attempting to share joint results. FilePath: ${this.jointBenchmarkFilePath}`);

    if (!this.jointBenchmarkFilePath) {
      console.error('[AutonomousBenchmark] No joint benchmark file path available');
      throw new Error('No joint benchmark results to share');
    }

    try {
      const Sharing = require('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(this.jointBenchmarkFilePath, {
          mimeType: 'application/json',
          dialogTitle: 'Export Joint Benchmark Results'
        });
      } else {
        throw new Error('Sharing is not available on this device');
      }
    } catch (error) {
      console.error('[AutonomousBenchmark] Failed to share results:', error);
      throw error;
    }
  }

  /**
   * Start joint benchmark run (multiple modes in batches)
   */
  async startJointBenchmark(
    modelId: string,
    config: JointBenchmarkConfig
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('Benchmark already running');
    }

    // Clear any existing checkpoint to prevent interference
    await this.clearCheckpoint();
    // Clear any previous batch export paths
    this.batchExportPaths.clear();

    console.log('[AutonomousBenchmark] Starting joint benchmark run', {
      modelId,
      config,
      totalProblems: config.endProblemId - config.startProblemId + 1,
      batches: Math.ceil((config.endProblemId - config.startProblemId + 1) / config.batchSize)
    });

    this.isRunning = true;
    this.isPaused = false;
    this.isJointMode = true;
    this.abortController = new AbortController();

    // Load model first
    await this.inferenceService.loadModel(modelId);

    // Load dataset
    await this.datasetService.loadDataset();

    // Validate and log which problems actually exist
    console.log('[AutonomousBenchmark] ========== Joint Benchmark Problem Validation ==========');
    const allProblemsInRange = this.datasetService.getProblemsInRange(config.startProblemId, config.endProblemId);
    console.log(`[AutonomousBenchmark] Total problems found in range ${config.startProblemId}-${config.endProblemId}: ${allProblemsInRange.length}`);

    if (allProblemsInRange.length === 0) {
      const error = `No problems found in range ${config.startProblemId}-${config.endProblemId}`;
      console.error(`[AutonomousBenchmark] ${error}`);
      this.isRunning = false;
      this.isJointMode = false;
      throw new Error(error);
    }

    // Log batch breakdown
    for (let batchStart = config.startProblemId; batchStart <= config.endProblemId; batchStart += config.batchSize) {
      const batchEnd = Math.min(batchStart + config.batchSize - 1, config.endProblemId);
      const batchProblems = this.datasetService.getProblemsInRange(batchStart, batchEnd);
      console.log(`[AutonomousBenchmark] Batch ${batchStart}-${batchEnd}: ${batchProblems.length} problems`);
      if (batchProblems.length > 0 && batchProblems.length <= 10) {
        console.log(`[AutonomousBenchmark]   IDs: ${batchProblems.map(p => p.id).join(', ')}`);
      }
    }
    console.log('[AutonomousBenchmark] ======================================================');

    // Track all batch session IDs for final export
    const batchSessionIds: string[] = [];

    // Process in batches
    for (let batchStart = config.startProblemId; batchStart <= config.endProblemId; batchStart += config.batchSize) {
      const batchEnd = Math.min(batchStart + config.batchSize - 1, config.endProblemId);

      console.log(`[AutonomousBenchmark] Processing batch: problems ${batchStart}-${batchEnd}`);

      // Check if any problems exist in this range
      const problemsInBatch = this.datasetService.getProblemsInRange(batchStart, batchEnd);
      console.log(`[AutonomousBenchmark] Found ${problemsInBatch.length} problems in batch ${batchStart}-${batchEnd}`);

      if (problemsInBatch.length === 0) {
        console.log(`[AutonomousBenchmark] Skipping empty batch ${batchStart}-${batchEnd} - no problems exist in this range`);
        continue;
      }

      // Log which problem IDs actually exist
      const existingIds = problemsInBatch.map(p => p.id);
      console.log(`[AutonomousBenchmark] Existing problem IDs in batch: ${existingIds.join(', ')}`);

      // Run each mode for this batch
      for (const mode of config.modes) {
        if (!this.isRunning || this.isPaused) break;

        const sessionId = `joint_${Date.now()}_${mode}_${batchStart}-${batchEnd}`;
        batchSessionIds.push(sessionId);

        console.log(`[AutonomousBenchmark] Running batch in ${mode} mode`);

        // Create a config for this batch
        const batchConfig: AutonomousBenchmarkConfig = {
          ...config,
          startProblemId: batchStart,
          endProblemId: batchEnd
        };

        // Run the batch
        await this.runBatch(modelId, mode, batchConfig, sessionId);

        // Export and save this batch to prevent memory issues
        if (this.isRunning) {
          await this.exportBatch(sessionId);
        }

        // Pause between modes
        await this.sleep(config.pauseBetweenProblems);
      }

      // Clear memory after each batch
      this.clearBatchMemory();

      // Check if we should continue
      if (!this.isRunning || this.isPaused) {
        break;
      }
    }

    // Export all batch results
    if (this.isRunning) {
      await this.exportJointResults(batchSessionIds);
      // Set completion flag AFTER export is done
      this.jointBenchmarkComplete = true;
      console.log('[AutonomousBenchmark] Joint benchmark marked as complete');
      console.log('[AutonomousBenchmark] Final filepath:', this.jointBenchmarkFilePath);
    }

    this.isRunning = false;
    this.isJointMode = false;
    console.log('[AutonomousBenchmark] Joint benchmark completed');
  }

  /**
   * Run a single batch of problems
   */
  private async runBatch(
    modelId: string,
    mode: BenchmarkMode,
    config: AutonomousBenchmarkConfig,
    sessionId: string
  ): Promise<void> {
    // Create checkpoint for this batch
    this.currentCheckpoint = {
      sessionId,
      modelId,
      mode,
      config,
      completedProblems: [],
      startTime: Date.now(),
      lastCheckpointTime: Date.now(),
      totalTokensGenerated: 0,
      totalEnergyConsumed: 0,
      state: 'running',
      statistics: {
        averageTTFT: 0,
        averageTPS: 0,
        thermalThrottleEvents: 0,
        batteryPauseEvents: 0,
      },
    };

    // Start benchmark session with the specific sessionId
    const benchmarkStore = useBenchmarkStore.getState();
    benchmarkStore.startSession(modelId, mode, sessionId);

    // Start monitoring
    this.startMonitoring();

    // Execute problems
    await this.executeProblems();

    // End session
    benchmarkStore.endSession();

    // Stop monitoring
    this.systemMonitor.stopMonitoring();
  }

  /**
   * Export batch results to file
   */
  private async exportBatch(sessionId: string): Promise<void> {
    try {
      const { ExportService } = require('./ExportService');
      const exportService = ExportService.getInstance();
      const benchmarkStore = useBenchmarkStore.getState();

      console.log(`[AutonomousBenchmark] Exporting batch for session: ${sessionId}`);
      console.log(`[AutonomousBenchmark] Current sessions in store:`, benchmarkStore.sessions.map(s => s.id));

      const session = benchmarkStore.sessions.find(s => s.id === sessionId);
      if (session) {
        console.log(`[AutonomousBenchmark] Found session ${sessionId} with ${session.problems.length} problems`);
        const filename = await exportService.exportToJSON(session, {
          includeSystemMetrics: true,
          includeRawResponses: true,
          includeToolCalls: true,
          includeStatisticalAnalysis: false
        });
        console.log(`[AutonomousBenchmark] Batch exported to: ${filename}`);
        // Store the export path for later use in combined export
        this.batchExportPaths.set(sessionId, filename);
        console.log(`[AutonomousBenchmark] Stored export path for ${sessionId}: ${filename}`);
        console.log(`[AutonomousBenchmark] Total export paths stored:`, this.batchExportPaths.size);
      } else {
        console.error(`[AutonomousBenchmark] Session ${sessionId} not found in store!`);
      }
    } catch (error) {
      console.error('[AutonomousBenchmark] Failed to export batch:', error);
    }
  }

  /**
   * Clear memory after batch processing
   */
  private clearBatchMemory(): void {
    // Clear completed session from memory but keep the exported file
    const benchmarkStore = useBenchmarkStore.getState();
    if (benchmarkStore.sessions.length > 0) {
      // Keep only the most recent session if needed for reference
      const lastSession = benchmarkStore.sessions[benchmarkStore.sessions.length - 1];
      benchmarkStore.sessions = [lastSession];
    }

    // Clear performance metrics for completed sessions
    this.performanceService.clearSessionMetrics(this.currentCheckpoint?.sessionId || '');

    // Trigger garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Export combined results from all batches
   */
  private async exportJointResults(sessionIds: string[]): Promise<void> {
    try {
      const { ExportService } = require('./ExportService');
      const exportService = ExportService.getInstance();
      const benchmarkStore = useBenchmarkStore.getState();
      const FileSystem = require('expo-file-system');

      console.log(`[AutonomousBenchmark] Starting joint export for ${sessionIds.length} sessions`);
      console.log(`[AutonomousBenchmark] Session IDs:`, sessionIds);
      console.log(`[AutonomousBenchmark] Export paths map size:`, this.batchExportPaths.size);
      console.log(`[AutonomousBenchmark] Export paths available:`, Array.from(this.batchExportPaths.keys()));
      console.log(`[AutonomousBenchmark] Current sessions in memory:`, benchmarkStore.sessions.map(s => s.id));

      // Collect all session data from exported files and current memory
      const allSessions = [];
      let totalProblems = 0;
      let successfulProblems = 0;
      let totalTokens = 0;
      let totalEnergy = 0;
      const modeResults: Record<string, any> = {};

      for (const sessionId of sessionIds) {
        console.log(`[AutonomousBenchmark] Processing session: ${sessionId}`);
        let session = benchmarkStore.sessions.find(s => s.id === sessionId);

        if (session) {
          console.log(`[AutonomousBenchmark] Found session ${sessionId} in memory`);
        } else {
          console.log(`[AutonomousBenchmark] Session ${sessionId} not in memory, checking export paths...`);
        }

        // If session not in memory, try to load from exported file
        if (!session && this.batchExportPaths.has(sessionId)) {
          const exportPath = this.batchExportPaths.get(sessionId);
          console.log(`[AutonomousBenchmark] Found export path for ${sessionId}: ${exportPath}`);
          if (exportPath) {
            try {
              console.log(`[AutonomousBenchmark] Reading file: ${exportPath}`);
              const fileContent = await FileSystem.readAsStringAsync(exportPath);
              const exportedData = JSON.parse(fileContent);
              session = exportedData.session || exportedData; // Handle different export formats
              console.log(`[AutonomousBenchmark] Successfully loaded session ${sessionId} from file`);
              if (session!.problems) {
                console.log(`[AutonomousBenchmark] Session has ${session!.problems.length} problems`);
              }
            } catch (err) {
              console.error(`[AutonomousBenchmark] Failed to load batch export for ${sessionId}:`, err);
            }
          }
        } else if (!session) {
          console.log(`[AutonomousBenchmark] No export path found for ${sessionId}`);
          console.log(`[AutonomousBenchmark] Available paths:`, Array.from(this.batchExportPaths.keys()));
        }

        if (session) {
          allSessions.push(session);
          totalProblems += session.problems.length;
          successfulProblems += session.problems.filter((p: any) => p.success).length;
          totalTokens += session.problems.reduce((sum: number, p: any) => sum + p.metrics.tokens, 0);
          totalEnergy += session.problems.reduce((sum: number, p: any) => sum + (p.metrics.energyConsumed || 0), 0);

          // Group by mode
          if (!modeResults[session.mode]) {
            modeResults[session.mode] = {
              problems: [],
              totalProblems: 0,
              successfulProblems: 0,
              avgTTFT: 0,
              avgTPS: 0
            };
          }
          modeResults[session!.mode].problems.push(...session!.problems);
          modeResults[session!.mode].totalProblems += session!.problems.length;
          modeResults[session!.mode].successfulProblems += session!.problems.filter((p: any) => p.success).length;
        } else {
          console.warn(`[AutonomousBenchmark] Session ${sessionId} not found in memory or exports`);
        }
      }

      // Calculate mode-specific metrics
      for (const mode in modeResults) {
        const modeData = modeResults[mode];
        const ttfts = modeData.problems.map((p: any) => p.metrics.ttft).filter((t: any) => t);
        const tpss = modeData.problems.map((p: any) => p.metrics.tps).filter((t: any) => t);
        modeData.avgTTFT = ttfts.length > 0 ? ttfts.reduce((a: number, b: number) => a + b, 0) / ttfts.length : 0;
        modeData.avgTPS = tpss.length > 0 ? tpss.reduce((a: number, b: number) => a + b, 0) / tpss.length : 0;
        modeData.successRate = modeData.totalProblems > 0 ? modeData.successfulProblems / modeData.totalProblems : 0;
      }

      // Create a combined export with all data
      const combinedExport = {
        type: 'joint_benchmark_results',
        timestamp: new Date().toISOString(),
        batchSessions: sessionIds,
        sessions: allSessions,
        summary: {
          totalBatches: sessionIds.length,
          totalProblems,
          successfulProblems,
          overallSuccessRate: totalProblems > 0 ? successfulProblems / totalProblems : 0,
          totalTokens,
          totalEnergy,
          avgTokensPerProblem: totalProblems > 0 ? totalTokens / totalProblems : 0,
          avgEnergyPerToken: totalTokens > 0 ? totalEnergy / totalTokens : 0,
          modeResults,
          sessionIds,
          note: totalProblems === 0 ? 'No problems found in the specified range. The MBPP dataset only contains specific problem IDs between 11-510.' : undefined
        }
      };

      const filename = `joint_benchmark_${Date.now()}_combined.json`;
      const path = await exportService.saveJSONFile(filename, combinedExport);

      // Store summary for UI display
      this.jointBenchmarkSummary = combinedExport.summary;
      this.jointBenchmarkFilePath = path;

      console.log(`[AutonomousBenchmark] Joint results exported to: ${path}`);
      console.log(`[AutonomousBenchmark] Joint benchmark filepath stored: ${this.jointBenchmarkFilePath}`);
    } catch (error) {
      console.error('[AutonomousBenchmark] Failed to export joint results:', error);
    }
  }
}
