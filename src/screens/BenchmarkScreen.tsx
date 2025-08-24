import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../stores/useStore';
import { useBenchmarkStore } from '../stores/useBenchmarkStore';
import { MBPPDatasetService } from '../services/MBPPDatasetService';
import { ModelService } from '../services/ModelService';
import { InferenceService } from '../services/InferenceService';
import { SystemMonitorService } from '../services/SystemMonitorService';
import { PerformanceService } from '../services/PerformanceService';
import { PowerMeasurementService } from '../services/PowerMeasurementService';
import { StatisticalAnalysisService } from '../services/StatisticalAnalysisService';
import { AutonomousBenchmarkService } from '../services/AutonomousBenchmarkService';
import { ExportService, ExportOptions } from '../services/ExportService';
import * as Device from 'expo-device';
import { theme } from '../constants/theme';
import { BenchmarkMode, MBPPProblem, BenchmarkProblemResult } from '../types/benchmark';
import { BenchmarkEvaluationService } from '../services/BenchmarkEvaluationService';
import { executeBenchmarkProblem } from '../utils/benchmarkExecutor';
import { BenchmarkConfigModal, BenchmarkConfig } from '../components/BenchmarkConfigModal';
import { JointBenchmarkSummaryView } from '../components/JointBenchmarkSummaryView';

export const BenchmarkScreen: React.FC = () => {
  const { selectedModelId, models, inferenceConfig } = useStore();
  const {
    currentSession,
    isRunning,
    mode,
    currentProblemIndex,
    startSession,
    endSession,
    addProblemResult,
    addSystemMetric,
    setCurrentProblemIndex,
    setMode,
    getCompletionStats,
    getToolCallStats,
  } = useBenchmarkStore();

  const [currentProblem, setCurrentProblem] = useState<MBPPProblem | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [response, setResponse] = useState('');
  const [extractedCode, setExtractedCode] = useState<string | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<any>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [benchmarkConfig, setBenchmarkConfig] = useState<BenchmarkConfig | null>(null);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [problemQueue, setProblemQueue] = useState<MBPPProblem[]>([]);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [showJointSummary, setShowJointSummary] = useState(false);
  const [jointSummaryData, setJointSummaryData] = useState<any>(null);

  const datasetService = MBPPDatasetService.getInstance();
  const inferenceService = InferenceService.getInstance();
  const modelService = ModelService.getInstance();
  const systemMonitor = SystemMonitorService.getInstance();
  const performanceService = PerformanceService.getInstance();
  const evaluationService = BenchmarkEvaluationService.getInstance();
  const powerService = PowerMeasurementService.getInstance();
  const statisticalService = StatisticalAnalysisService.getInstance();
  const autonomousService = AutonomousBenchmarkService.getInstance();
  const exportService = ExportService.getInstance();

  useEffect(() => {
    datasetService.loadDataset();
    loadModels();
    return () => {
      systemMonitor.stopMonitoring();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = systemMonitor.addMetricsCallback((metrics) => {
      setSystemMetrics(metrics);
      if (currentSession) {
        addSystemMetric(metrics);
      }
    });
    return unsubscribe;
  }, [currentSession]);

  // Check for joint benchmark completion
  useEffect(() => {
    const checkJointCompletion = setInterval(() => {
      if (autonomousService.isJointBenchmarkComplete()) {
        const summary = autonomousService.getJointBenchmarkSummary();
        if (summary) {
          setJointSummaryData(summary);
          setShowJointSummary(true);
          // Don't reset here - wait until the summary is closed
        }
      }
    }, 1000); // Check every second

    return () => clearInterval(checkJointCompletion);
  }, []);


  const loadModels = async () => {
    const availableModels = await modelService.getAvailableModels();
    useStore.getState().updateModels(availableModels);

    const downloadedModel = availableModels.find((m) => m.downloaded);
    if (downloadedModel && !selectedModelId) {
      useStore.getState().setSelectedModel(downloadedModel.id);
    }
  };

  const startBenchmark = useCallback(async () => {
    if (!selectedModelId) {
      Alert.alert('Error', 'Please select a model first');
      return;
    }

    const model = models.find(m => m.id === selectedModelId);
    if (!model?.downloaded) {
      Alert.alert('Error', 'Model not downloaded');
      return;
    }

    // Reset joint summary if shown
    setShowJointSummary(false);
    setJointSummaryData(null);

    // Show configuration modal
    setShowConfigModal(true);
  }, [selectedModelId, models]);

  const handleBenchmarkStart = useCallback(async (config: BenchmarkConfig) => {
    setBenchmarkConfig(config);
    setCurrentIteration(0);
    
    try {
      console.log(`[BenchmarkScreen] Starting benchmark with config:`, config);
      
      // Load model
      if (!selectedModelId) {
        throw new Error('No model selected');
      }
      await inferenceService.loadModel(selectedModelId);
      startSession(selectedModelId, mode);
      systemMonitor.startMonitoring(500);
      
      // Check benchmark mode
      if (config.enableJointMode) {
        // Joint benchmarking mode
        const jointConfig = {
          maxHours: config.maxHours,
          minBatteryLevel: config.minBatteryLevel,
          maxTemperature: config.maxTemperature,
          pauseBetweenProblems: config.pauseBetweenProblems,
          cooldownTime: 5000,
          saveCheckpoints: true,
          iterations: config.iterations,
          startProblemId: config.startProblemId,
          endProblemId: config.endProblemId,
          batchSize: config.batchSize || 10,
          modes: config.jointModes || ['base', 'tool_submission', 'full_tool'],
        };
        
        // Start joint benchmark execution
        autonomousService.startJointBenchmark(
          selectedModelId!,
          jointConfig
        ).catch((error: Error) => {
          Alert.alert('Error', 'Joint benchmark failed: ' + error.message);
          console.error(error);
        });
        
        Alert.alert('Joint Mode', `Will run ${jointConfig.modes.length} modes in batches of ${jointConfig.batchSize}`);
        
        // Don't redirect to mode pages for joint benchmark
        return;
      } else if (config.enableAutonomousMode) {
        const autonomousConfig = {
          maxHours: config.maxHours,
          minBatteryLevel: config.minBatteryLevel,
          maxTemperature: config.maxTemperature,
          pauseBetweenProblems: config.pauseBetweenProblems,
          cooldownTime: 5000,
          saveCheckpoints: true,
          iterations: config.iterations,
          startProblemId: config.startProblemId,
          endProblemId: config.endProblemId,
        };
        
        // Start autonomous execution
        autonomousService.start(
          selectedModelId!,
          mode,
          autonomousConfig
        ).catch((error: Error) => {
          Alert.alert('Error', 'Autonomous benchmark failed: ' + error.message);
          console.error(error);
        });
        
        Alert.alert('Autonomous Mode', 'Benchmark will run automatically while app is in foreground');
      } else {
        // Manual mode - load problems
        const problems = datasetService.getProblemsInRange(config.startProblemId, config.endProblemId);
        if (problems.length > 0) {
          // Create queue with iterations
          const queue: MBPPProblem[] = [];
          for (let iter = 0; iter < config.iterations; iter++) {
            queue.push(...problems);
          }
          setProblemQueue(queue);
          setCurrentProblemIndex(0);
          setCurrentProblem(queue[0]);
          setResponse('');
          
          // DO NOT auto-run by default - user must click Run button manually
          setIsAutoRunning(false);
        } else {
          Alert.alert('Error', 'No problems found in range');
        }
      }
    } catch (error) {
      console.error('[BenchmarkScreen] Failed to start:', error);
      Alert.alert('Error', `Failed to start: ${error}`);
    }
  }, [selectedModelId, mode]);

  const loadNextProblem = useCallback(() => {
    if (benchmarkConfig && problemQueue.length > 0) {
      const nextIndex = currentProblemIndex + 1;
      if (nextIndex < problemQueue.length) {
        setCurrentProblemIndex(nextIndex);
        setCurrentProblem(problemQueue[nextIndex]);
        setResponse('');
        setExtractedCode(null); // Clear extracted code from previous problem
        
        // Calculate current iteration
        const problemsPerIteration = benchmarkConfig.endProblemId - benchmarkConfig.startProblemId + 1;
        const iteration = Math.floor(nextIndex / problemsPerIteration) + 1;
        setCurrentIteration(iteration);
        
        // Add pause between problems if configured
        if (benchmarkConfig.pauseBetweenProblems > 0) {
          setTimeout(() => {}, benchmarkConfig.pauseBetweenProblems);
        }
      } else {
        endBenchmark();
      }
    } else {
      // Fallback to original behavior
      const problems = datasetService.getAllProblems();
      if (currentProblemIndex < problems.length) {
        setCurrentProblem(problems[currentProblemIndex]);
        setResponse('');
      } else {
        endBenchmark();
      }
    }
  }, [currentProblemIndex, problemQueue, benchmarkConfig]);

  const loadRandomProblem = useCallback(() => {
    const problems = datasetService.getRandomProblems(1);
    if (problems.length > 0) {
      setCurrentProblem(problems[0]);
      setResponse('');
      setExtractedCode(null);
    }
  }, []);

  const runCurrentProblem = useCallback(async () => {
    if (!currentProblem || !currentSession || isProcessing) return;

    setIsProcessing(true);
    setResponse(''); // Clear previous response
    setExtractedCode(null); // Clear extracted code
    const startTime = new Date();
    const messageId = `bench_msg_${Date.now()}`;
    
    console.log(`[BenchmarkScreen] Running problem ${currentProblem.id} in mode: ${mode}`);
    
    try {
      await systemMonitor.captureSnapshot('before_inference');
      systemMonitor.setInferenceActive(true);
      
      // Start power measurement for this problem
      await powerService.startSession(`${currentSession.id}_${currentProblem.id}`);
      
      // Execute the problem with the appropriate mode
      // Get the current model ID from either the store or the inference service
      const modelId = selectedModelId || inferenceService.getCurrentModelId();
      
      const executionResult = await executeBenchmarkProblem(
        currentProblem,
        mode,
        inferenceService,
        inferenceConfig,
        messageId,
        currentSession.id,
        (token) => setResponse(prev => prev + token),
        modelId || undefined,  // Pass the model ID for proper prompt selection
        true  // isFirstIteration: always true for single runs
      );

      await systemMonitor.captureSnapshot('after_inference');
      systemMonitor.setInferenceActive(false);
      
      // Evaluate the solution
      console.log('[BenchmarkScreen] Execution complete, evaluating solution...');
      console.log('[BenchmarkScreen] Code extracted:', !!executionResult.code);
      
      // Log tool call validity for tool_submission mode
      if (mode === 'tool_submission') {
        console.log('[BenchmarkScreen] Tool call valid format:', executionResult.toolCallValid);
        console.log('[BenchmarkScreen] Tool call extracted:', executionResult.toolCallExtracted);
        if (!executionResult.toolCallValid) {
          console.warn('[BenchmarkScreen] WARNING: Model did not use proper tool call format!');
        }
      }
      
      // Store extracted code for display
      setExtractedCode(executionResult.code);
      
      let evaluationResult;
      if (executionResult.code) {
        console.log('[BenchmarkScreen] Evaluating code...');
        evaluationResult = await evaluationService.evaluateSolution(
          currentProblem,
          executionResult.code
        );
        console.log('[BenchmarkScreen] Evaluation complete:', evaluationResult.success ? 'SUCCESS' : 'FAILED');
      } else {
        // No code extracted
        console.log('[BenchmarkScreen] No code extracted from response!');
        evaluationResult = {
          success: false,
          testResults: currentProblem.testCases.map(tc => ({
            testCase: tc,
            passed: false,
            error: 'No code found in response'
          })),
          code: '',
          error: 'Failed to extract code from response'
        };
      }
      
      const endTime = new Date();
      // Use the actual messageId from execution (includes iteration count)
      const effectiveMessageId = executionResult.actualMessageId || messageId;
      console.log('[BenchmarkScreen] Retrieving metrics for messageId:', effectiveMessageId);
      const messageMetrics = performanceService.getMessageMetrics(effectiveMessageId);
      const latencyReport = performanceService.getLatencyReport(effectiveMessageId);
      
      // Debug logging
      console.log('[BenchmarkScreen] Message metrics found:', !!messageMetrics);
      if (messageMetrics) {
        console.log('[BenchmarkScreen] TTFT:', messageMetrics.ttft);
        console.log('[BenchmarkScreen] TPS:', messageMetrics.tps);
        console.log('[BenchmarkScreen] Total tokens:', messageMetrics.totalTokens);
        console.log('[BenchmarkScreen] Inter-token latencies count:', 
          messageMetrics.tokenLatencyData?.interTokenLatencies?.length || 0);
      }
      const systemMetricsAvg = systemMonitor.getAverageMetrics(
        endTime.getTime() - startTime.getTime()
      );
      
      // End power measurement and get energy metrics
      const energyMetrics = await powerService.endSession();
      const energyPerToken = energyMetrics && messageMetrics?.totalTokens 
        ? await powerService.calculateEnergyPerToken(messageMetrics.totalTokens)
        : undefined;
      const peakMetrics = systemMonitor.getPeakMetrics(
        endTime.getTime() - startTime.getTime()
      );
      
      // Get device info with proper fallbacks
      const deviceInfo = {
        deviceModel: Device.modelName || Device.deviceName || 'Unknown Device',
        osVersion: `${Device.osName || Platform.OS} ${Device.osVersion || 'Unknown'}`,
      };
      
      console.log('[BenchmarkScreen] Device info:', deviceInfo);

      const problemResult: BenchmarkProblemResult = {
        problemId: currentProblem.id,
        startTime,
        endTime,
        response: executionResult.response,
        toolCalls: executionResult.toolCalls,
        testResults: evaluationResult.testResults,
        success: evaluationResult.success,
        toolCallValid: executionResult.toolCallValid,
        toolCallExtracted: executionResult.toolCallExtracted,
        metrics: {
          tokens: messageMetrics?.totalTokens || executionResult.response.length / 4,
          inferenceTime: messageMetrics?.totalResponseTime || (endTime.getTime() - startTime.getTime()),
          toolExecutionTime: messageMetrics?.toolCallLatencies?.reduce((sum, tc) => sum + tc.executionTime, 0),
          ttft: messageMetrics?.ttft || 0,
          tps: messageMetrics?.tps || 0,
          peakMemory: peakMetrics?.peakMemory || systemMetricsAvg?.memoryUsageMB || 0,
          avgMemory: systemMetricsAvg?.memoryUsageMB || 0,
          minMemory: peakMetrics?.minMemory || systemMetricsAvg?.memoryUsageMB || 0,
          avgCPU: systemMetricsAvg?.cpuUsage || 0,
          peakCPU: peakMetrics?.peakCPU,
          energyConsumed: energyMetrics?.totalEnergy || 
            (systemMetricsAvg?.powerConsumptionMA 
              ? (systemMetricsAvg.powerConsumptionMA * (endTime.getTime() - startTime.getTime()) / 3600000)
              : undefined),
          energyPerToken: energyPerToken,
          // Note: promptTokens and completionTokens would come from the model response, not performance metrics
          promptTokens: undefined, // TODO: Get from model response
          completionTokens: undefined, // TODO: Get from model response
          temperature: systemMetricsAvg?.cpuTemperature,
          deviceModel: deviceInfo.deviceModel,
          osVersion: deviceInfo.osVersion,
          // Inter-token latency raw arrays  
          interTokenLatencies: latencyReport?.interTokenLatencies || messageMetrics?.tokenLatencyData?.interTokenLatencies || [],
          // Tool call latencies from performance metrics
          toolCallLatencies: messageMetrics?.toolCallLatencies,
        }
      };

      addProblemResult(problemResult);
      
      // Save performance metrics to persistent storage
      await performanceService.saveMetricsToStorage(currentSession.id);
      
      // Track failed problems
      if (!evaluationResult.success) {
        useBenchmarkStore.getState().addFailedProblem(currentProblem.id);
      }
      
      // Show test results with details
      const passedTests = evaluationResult.testResults.filter(t => t.passed).length;
      const totalTests = evaluationResult.testResults.length;
      
      // Build detailed message for failures
      let message = `Passed ${passedTests}/${totalTests} tests`;
      
      if (!evaluationResult.success) {
        message += '\n\nFailed Tests:';
        evaluationResult.testResults.forEach((result, index) => {
          if (!result.passed) {
            message += `\n\nTest ${index + 1}:`;
            // Handle both string and TestCase types
            if (typeof result.testCase === 'string') {
              message += `\n${result.testCase}`;
            } else if (result.testCase && typeof result.testCase === 'object' && 'assertion' in result.testCase) {
              message += `\n${result.testCase.assertion}`;
            }
            if (result.error) {
              message += `\nError: ${result.error}`;
            }
            if ('actualOutput' in result && result.actualOutput) {
              message += `\nActual output: ${result.actualOutput}`;
            }
          }
        });
        
        // Add extracted code info if available
        if (evaluationResult.code) {
          message += '\n\nExtracted code length: ' + evaluationResult.code.length + ' chars';
        } else {
          message += '\n\n⚠️ No code was extracted from response!';
        }
      }
      
      // If auto-running, automatically proceed to next problem
      if (isAutoRunning) {
        // Show brief notification instead of alert
        console.log(`[BenchmarkScreen] Problem ${currentProblem.id}: ${evaluationResult.success ? 'SUCCESS' : 'FAILED'}`);
        
        // Delay briefly to allow UI update
        setTimeout(() => {
          // Move to next problem
          const nextIndex = currentProblemIndex + 1;
          if (nextIndex < problemQueue.length) {
            setCurrentProblemIndex(nextIndex);
            setCurrentProblem(problemQueue[nextIndex]);
            setResponse('');
            setExtractedCode(null);
            
            // Calculate current iteration
            const problemsPerIteration = Math.floor(problemQueue.length / (benchmarkConfig?.iterations || 1));
            const newIteration = Math.floor(nextIndex / problemsPerIteration);
            setCurrentIteration(newIteration);
          } else {
            // All problems completed
            setIsAutoRunning(false);
            Alert.alert('Benchmark Complete', 'All problems have been evaluated');
            // Call endSession directly instead of endBenchmark
            systemMonitor.stopMonitoring();
            endSession();
          }
        }, 1000); // 1 second delay between problems
      } else {
        // Manual mode - show alert
        Alert.alert(
          evaluationResult.success ? 'Success!' : 'Tests Failed',
          message,
          [{ text: 'OK' }],
          { cancelable: true }
        );
      }
      
    } catch (error) {
      console.error('Benchmark error:', error);
      Alert.alert('Error', `Failed to run problem: ${error}`);
    } finally {
      systemMonitor.setInferenceActive(false);
      setIsProcessing(false);
    }
  }, [currentProblem, currentSession, mode, isProcessing, inferenceConfig, isAutoRunning, currentProblemIndex, problemQueue, benchmarkConfig, endSession]);

  const endBenchmark = useCallback(async () => {
    systemMonitor.stopMonitoring();
    
    // Generate statistical analysis if we have results
    if (currentSession && currentSession.problems.length > 0) {
      try {
        const analysis = await statisticalService.analyzeSession(currentSession);
        await statisticalService.saveReport(analysis);
        console.log('[BenchmarkScreen] Statistical analysis completed');
      } catch (error) {
        console.error('[BenchmarkScreen] Statistical analysis failed:', error);
      }
    }
    
    endSession();
    Alert.alert('Benchmark Complete', 'Results have been saved with statistical analysis');
  }, [currentSession]);

  const exportResults = useCallback(async () => {
    if (!currentSession) {
      Alert.alert('No Session', 'No active session to export');
      return;
    }
    
    try {
      console.log('[BenchmarkScreen] Showing export options for session:', currentSession.id);
      
      Alert.alert(
        'Export Format',
        'Choose export format for comprehensive data export',
        [
          { 
            text: 'SQLite Database', 
            onPress: async () => {
              try {
                const options: ExportOptions = {
                  format: 'sqlite',
                  includeRawLatencies: true,
                  includeSystemMetrics: true,
                  includePowerMeasurements: true,
                  includeStatisticalAnalysis: true,
                  compressOutput: false
                };
                
                const filePath = await exportService.exportSession(currentSession, options);
                console.log('[BenchmarkScreen] SQLite export complete:', filePath);
                Alert.alert('Success', 'Database exported and ready to share');
              } catch (error) {
                console.error('[BenchmarkScreen] SQLite export error:', error);
                Alert.alert('Export Failed', String(error));
              }
            }
          },
          { 
            text: 'CSV File', 
            onPress: async () => {
              try {
                const options: ExportOptions = {
                  format: 'csv',
                  includeRawLatencies: false, // Too large for CSV
                  includeSystemMetrics: false,
                  includePowerMeasurements: false,
                  includeStatisticalAnalysis: false,
                  compressOutput: false
                };
                
                const filePath = await exportService.exportSession(currentSession, options);
                console.log('[BenchmarkScreen] CSV export complete:', filePath);
                Alert.alert('Success', 'CSV file exported and ready to share');
              } catch (error) {
                console.error('[BenchmarkScreen] CSV export error:', error);
                Alert.alert('Export Failed', String(error));
              }
            }
          },
          { 
            text: 'JSON (Complete)', 
            onPress: async () => {
              try {
                const options: ExportOptions = {
                  format: 'json',
                  includeRawLatencies: true,
                  includeSystemMetrics: true,
                  includePowerMeasurements: true,
                  includeStatisticalAnalysis: true,
                  compressOutput: false
                };
                
                const filePath = await exportService.exportSession(currentSession, options);
                console.log('[BenchmarkScreen] JSON export complete:', filePath);
                Alert.alert('Success', 'Complete JSON data exported and ready to share');
              } catch (error) {
                console.error('[BenchmarkScreen] JSON export error:', error);
                Alert.alert('Export Failed', String(error));
              }
            }
          },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
    } catch (error) {
      console.error('[BenchmarkScreen] Export error:', error);
      Alert.alert('Error', `Failed to export results: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [currentSession, exportService]);

  // Auto-run effect: automatically start evaluation when problem changes
  useEffect(() => {
    if (isAutoRunning && currentProblem && !isProcessing && currentSession) {
      // Small delay to allow UI to update
      const timer = setTimeout(() => {
        runCurrentProblem();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentProblem, isAutoRunning, currentSession, isProcessing, runCurrentProblem]);

  const selectedModel = models.find(m => m.id === selectedModelId);

  // Show joint benchmark summary if available
  if (showJointSummary && jointSummaryData) {
    return (
      <SafeAreaView style={styles.container}>
        <JointBenchmarkSummaryView
          summary={jointSummaryData}
          onClose={() => {
            setShowJointSummary(false);
            setJointSummaryData(null);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Benchmark Mode</Text>
        <View style={styles.modelInfo}>
          <Text style={styles.modelText}>
            Model: {selectedModel?.name || 'None selected'}
          </Text>
          {!isRunning ? (
            <Text style={styles.modeText}>Mode: {mode}</Text>
          ) : (
            <View style={styles.modeSelectorCompact}>
              <Text style={styles.modeLabel}>Mode:</Text>
              <View style={styles.modeButtonsRow}>
                {(['base', 'tool_submission', 'full_tool'] as BenchmarkMode[]).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.modeButtonCompact,
                      mode === m && styles.modeButtonCompactActive,
                      isProcessing && styles.disabledButton
                    ]}
                    onPress={() => !isProcessing && setMode(m)}
                    disabled={isProcessing}
                  >
                    <Text style={[
                      styles.modeButtonCompactText,
                      mode === m && styles.modeButtonCompactTextActive
                    ]}>
                      {m === 'base' ? 'Base' : m === 'tool_submission' ? 'Tool' : 'Full'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>

      {!isRunning ? (
        <View style={styles.setupContainer}>
          <Text style={styles.sectionTitle}>Select Evaluation Mode</Text>
          <View style={styles.modeSelector}>
            {(['base', 'tool_submission', 'full_tool'] as BenchmarkMode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeButton, mode === m && styles.modeButtonActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.modeButtonText, mode === m && styles.modeButtonTextActive]}>
                  {m.replace('_', ' ').toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.startButton, !selectedModelId && styles.disabledButton]}
            onPress={startBenchmark}
            disabled={!selectedModelId}
          >
            <Text style={styles.startButtonText}>Start Benchmark</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.benchmarkContainer}>
          {currentProblem && (
            <View style={styles.problemContainer}>
              <Text style={styles.problemTitle}>
                Problem {currentProblem.id}
                {benchmarkConfig && ` (Iteration ${currentIteration}/${benchmarkConfig.iterations})`}
                {problemQueue.length > 0 && ` - ${currentProblemIndex + 1}/${problemQueue.length} total`}
              </Text>
              <Text style={styles.problemDescription}>{currentProblem.description}</Text>
              <Text style={styles.testTitle}>Test Cases:</Text>
              {currentProblem.testCases.map((test, index) => (
                <Text key={index} style={styles.testCase}>
                  • {test}
                </Text>
              ))}
            </View>
          )}

          {response && (
            <View style={styles.responseContainer}>
              <Text style={styles.responseTitle}>Model Response:</Text>
              <ScrollView style={styles.responseScroll}>
                <Text style={styles.responseText}>{response}</Text>
              </ScrollView>
              {/* Debug info for extracted code */}
              {extractedCode && (
                <View style={styles.extractedCodeContainer}>
                  <Text style={styles.extractedCodeTitle}>Extracted Code:</Text>
                  <ScrollView style={styles.codeScroll}>
                    <Text style={styles.extractedCodeText}>{extractedCode}</Text>
                  </ScrollView>
                </View>
              )}
              {!extractedCode && response && (
                <Text style={styles.noCodeWarning}>⚠️ No code extracted from response</Text>
              )}
            </View>
          )}

          <View style={styles.controlButtons}>
            {/* Auto-run toggle */}
            <TouchableOpacity
              style={[styles.controlButton, isAutoRunning && styles.autoRunToggleActive]}
              onPress={() => {
                const newAutoRunState = !isAutoRunning;
                setIsAutoRunning(newAutoRunState);
                if (newAutoRunState && !isProcessing && currentProblem) {
                  // If enabling auto-run and not currently processing, start immediately
                  setTimeout(() => runCurrentProblem(), 500);
                }
              }}
              disabled={isProcessing}
            >
              <Text style={[styles.controlButtonText, isAutoRunning && styles.autoRunToggleTextActive]}>
                {isAutoRunning ? 'MANUAL' : 'AUTO'}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.controlButton, isProcessing && styles.disabledButton]}
              onPress={runCurrentProblem}
              disabled={isProcessing || isAutoRunning}
            >
              {isProcessing ? (
                <ActivityIndicator color={theme.colors.background} />
              ) : (
                <Text style={styles.controlButtonText}>
                  {isAutoRunning ? 'AUTO' : 'RUN'}
                </Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.controlButton, isProcessing && styles.disabledButton]}
              onPress={loadNextProblem}
              disabled={isProcessing || isAutoRunning}
            >
              <Text style={styles.controlButtonText}>NEXT</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.controlButton, isProcessing && styles.disabledButton]}
              onPress={loadRandomProblem}
              disabled={isProcessing}
            >
              <Text style={styles.controlButtonText}>RANDOM</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.controlButton}
              onPress={endBenchmark}
            >
              <Text style={styles.controlButtonText}>END</Text>
            </TouchableOpacity>
          </View>

          {systemMetrics && (
            <View style={styles.metricsContainer}>
              <Text style={styles.metricsTitle}>System Metrics</Text>
              {systemMetrics.deviceChipset && (
                <Text style={styles.metricText}>
                  Chipset: {systemMetrics.deviceChipset}
                </Text>
              )}
              {(systemMetrics.hasGPU !== undefined || systemMetrics.hasNeuralEngine !== undefined) && (
                <Text style={styles.metricText}>
                  Hardware: {systemMetrics.hasGPU ? 'GPU' : ''}{systemMetrics.hasGPU && systemMetrics.hasNeuralEngine ? ' + ' : ''}{systemMetrics.hasNeuralEngine ? 'Neural Engine' : ''}
                </Text>
              )}
              {systemMetrics.cpuUsage !== undefined && (
                <Text style={styles.metricText}>
                  CPU: {systemMetrics.cpuUsage.toFixed(1)}%{systemMetrics.cpuTemperature !== undefined ? ` @ ${systemMetrics.cpuTemperature}°C` : ''}
                </Text>
              )}
              {systemMetrics.gpuUsage !== undefined && (
                <Text style={styles.metricText}>
                  GPU: {systemMetrics.gpuUsage.toFixed(1)}%{systemMetrics.gpuTemperature !== undefined ? ` @ ${systemMetrics.gpuTemperature}°C` : ''}
                </Text>
              )}
              {systemMetrics.neuralEngineUsage !== undefined && (
                <Text style={styles.metricText}>
                  Neural Engine: {systemMetrics.neuralEngineUsage.toFixed(1)}%
                </Text>
              )}
              {(systemMetrics.memoryUsageMB > 0 || systemMetrics.availableMemoryMB > 0) && (
                <Text style={styles.metricText}>
                  Memory: {systemMetrics.memoryUsageMB.toFixed(0)} MB / {(systemMetrics.memoryUsageMB + systemMetrics.availableMemoryMB).toFixed(0)} MB
                </Text>
              )}
              {systemMetrics.batteryLevel !== undefined && (
                <Text style={styles.metricText}>
                  Battery: {systemMetrics.batteryLevel}% ({systemMetrics.batteryState})
                </Text>
              )}
              {systemMetrics.powerConsumptionMA !== undefined && (
                <Text style={styles.metricText}>
                  Power: {Math.abs(systemMetrics.powerConsumptionMA).toFixed(0)} mA {systemMetrics.powerConsumptionMA < 0 ? '(charging)' : '(discharging)'}
                </Text>
              )}
            </View>
          )}
          
          {currentSession && currentSession.problems.length > 0 && (
            <View style={styles.completionContainer}>
              <Text style={styles.completionTitle}>Completion Stats</Text>
              <View style={styles.statsRow}>
                <Text style={styles.statLabel}>Total:</Text>
                <Text style={styles.statValue}>{getCompletionStats().total}</Text>
              </View>
              <View style={styles.statsRow}>
                <Text style={[styles.statLabel, { color: theme.colors.success }]}>Passed:</Text>
                <Text style={[styles.statValue, { color: theme.colors.success }]}>{getCompletionStats().passed}</Text>
              </View>
              <View style={styles.statsRow}>
                <Text style={[styles.statLabel, { color: theme.colors.error }]}>Failed:</Text>
                <Text style={[styles.statValue, { color: theme.colors.error }]}>{getCompletionStats().failed}</Text>
              </View>
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill, 
                    { width: `${getCompletionStats().percentage}%` }
                  ]} 
                />
              </View>
              <Text style={styles.percentageText}>
                {getCompletionStats().percentage.toFixed(1)}% Success Rate
              </Text>
              
              {/* Tool Call Stats for tool_submission mode */}
              {mode === 'tool_submission' && (() => {
                const toolStats = getToolCallStats();
                return toolStats.total > 0 ? (
                  <View style={styles.toolCallStatsContainer}>
                    <Text style={styles.toolCallStatsTitle}>Tool Call Format Compliance</Text>
                    <View style={styles.statsRow}>
                      <Text style={styles.statLabel}>Valid Format:</Text>
                      <Text style={[styles.statValue, { color: theme.colors.success }]}>
                        {toolStats.validFormat}/{toolStats.total} ({toolStats.validPercentage.toFixed(1)}%)
                      </Text>
                    </View>
                    <View style={styles.statsRow}>
                      <Text style={styles.statLabel}>Extracted (any format):</Text>
                      <Text style={styles.statValue}>{toolStats.extracted}</Text>
                    </View>
                    <View style={styles.statsRow}>
                      <Text style={[styles.statLabel, { color: theme.colors.warning }]}>Failed to Extract:</Text>
                      <Text style={[styles.statValue, { color: theme.colors.warning }]}>{toolStats.failed}</Text>
                    </View>
                  </View>
                ) : null;
              })()}
              
              {currentSession.failedProblemIds && currentSession.failedProblemIds.length > 0 && (
                <Text style={styles.failedProblemsText}>
                  Failed Problems: {currentSession.failedProblemIds.join(', ')}
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {currentSession && (
        <TouchableOpacity
          style={styles.exportButton}
          onPress={exportResults}
        >
          <Ionicons name="download-outline" size={20} color={theme.colors.background} />
          <Text style={styles.exportButtonText}>Export Results</Text>
        </TouchableOpacity>
      )}

      <BenchmarkConfigModal
        visible={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        onStart={handleBenchmarkStart}
        totalProblems={datasetService.getTotalProblemCount()}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  modelInfo: {
    marginTop: 5,
  },
  modelText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  modeText: {
    fontSize: 14,
    color: theme.colors.primary,
    marginTop: 2,
  },
  setupContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 15,
  },
  modeSelector: {
    marginBottom: 30,
  },
  modeButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 10,
  },
  modeButtonActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  modeButtonText: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: 'center',
  },
  modeButtonTextActive: {
    color: theme.colors.background,
    fontWeight: '600',
  },
  startButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.background,
  },
  benchmarkContainer: {
    flex: 1,
  },
  problemContainer: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  problemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    marginBottom: 10,
  },
  problemDescription: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 15,
    lineHeight: 20,
  },
  codeContainer: {
    backgroundColor: theme.colors.surface,
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: theme.colors.text,
  },
  testTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 5,
  },
  testCase: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginLeft: 10,
    marginBottom: 3,
    fontFamily: 'monospace',
  },
  responseContainer: {
    padding: 20,
    flex: 1,
  },
  responseTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 10,
  },
  responseScroll: {
    maxHeight: 400,
  },
  responseText: {
    fontSize: 14,
    color: theme.colors.text,
    fontFamily: 'monospace',
  },
  extractedCodeContainer: {
    marginTop: 15,
    padding: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: 5,
  },
  extractedCodeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.success,
    marginBottom: 5,
  },
  codeScroll: {
    maxHeight: 300,
  },
  extractedCodeText: {
    fontSize: 12,
    color: theme.colors.text,
    fontFamily: 'monospace',
  },
  noCodeWarning: {
    marginTop: 10,
    fontSize: 14,
    color: theme.colors.warning,
    fontStyle: 'italic',
  },
  controlButtons: {
    flexDirection: 'row',
    padding: 20,
    justifyContent: 'space-around',
  },
  controlButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 70,
    alignItems: 'center',
  },
  controlButtonText: {
    color: theme.colors.background,
    fontWeight: '600',
    fontSize: 14,
  },
  autoRunToggleContainer: {
    width: '100%',
    marginBottom: 10,
  },
  autoRunToggle: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  autoRunToggleActive: {
    backgroundColor: theme.colors.warning,
    borderColor: theme.colors.warning,
  },
  autoRunToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  autoRunToggleTextActive: {
    color: theme.colors.background,
    fontWeight: '600',
  },
  autoRunIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    marginTop: 8,
  },
  autoRunText: {
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  stopButton: {
    backgroundColor: theme.colors.error,
  },
  metricsContainer: {
    padding: 20,
    backgroundColor: theme.colors.surface,
    margin: 20,
    borderRadius: 8,
  },
  metricsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 10,
  },
  metricText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: 5,
  },
  exportButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: theme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 20,
  },
  exportButtonText: {
    color: theme.colors.background,
    marginLeft: 5,
    fontWeight: '600',
  },
  completionContainer: {
    padding: 20,
    backgroundColor: theme.colors.surface,
    margin: 20,
    borderRadius: 8,
  },
  completionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  statLabel: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  progressBar: {
    height: 8,
    backgroundColor: theme.colors.border,
    borderRadius: 4,
    marginTop: 10,
    marginBottom: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
    borderRadius: 4,
  },
  percentageText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 5,
  },
  failedProblemsText: {
    fontSize: 12,
    color: theme.colors.error,
    marginTop: 10,
    fontStyle: 'italic',
  },
  toolCallStatsContainer: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  toolCallStatsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 10,
  },
  modeSelectorCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  modeLabel: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginRight: 10,
  },
  modeButtonsRow: {
    flexDirection: 'row',
    gap: 5,
  },
  modeButtonCompact: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  modeButtonCompactActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  modeButtonCompactText: {
    fontSize: 12,
    color: theme.colors.text,
  },
  modeButtonCompactTextActive: {
    color: theme.colors.background,
    fontWeight: '600',
  },
});