import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Picker } from '@react-native-picker/picker';
import { PrefillBenchmarkService } from '../services/PrefillBenchmarkService';
import { ModelService } from '../services/ModelService';
import { ExportService } from '../services/ExportService';
import { PrefillPromptConfig, PrefillBenchmarkResults, calculateStats } from '../utils/prefillBenchmark';

export function PrefillBenchmarkScreen() {
  const navigation = useNavigation();
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [results, setResults] = useState<PrefillBenchmarkResults | null>(null);

  // Benchmark configuration
  const [config, setConfig] = useState<PrefillPromptConfig>({
    minTokens: 50,
    maxTokens: 3000,
    step: 50,
    iterations: 20,
    warmupRuns: 5,
  });

  const benchmarkService = PrefillBenchmarkService.getInstance();
  const modelService = ModelService.getInstance();
  const exportService = ExportService.getInstance();

  useEffect(() => {
    loadModels();

    // Set up progress callback
    benchmarkService.setProgressCallback((progress, status) => {
      setProgress(progress);
      setStatusMessage(status);
    });
  }, []);

  const loadModels = async () => {
    try {
      const models = await modelService.getDownloadedModels();
      setAvailableModels(models);
      if (models.length > 0) {
        setSelectedModel(models[0]);
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const startBenchmark = async () => {
    if (!selectedModel) {
      Alert.alert('Error', 'Please select a model');
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setResults(null);

    try {
      const benchmarkResults = await benchmarkService.runBenchmark(selectedModel, config);
      setResults(benchmarkResults);
      Alert.alert('Success', 'Benchmark completed successfully!');
    } catch (error: any) {
      Alert.alert('Error', `Benchmark failed: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const cancelBenchmark = () => {
    benchmarkService.cancel();
    setIsRunning(false);
    setStatusMessage('Benchmark cancelled');
  };

  const exportResults = async (format: 'json' | 'csv' = 'json') => {
    if (!results) {
      Alert.alert('Error', 'No results to export');
      return;
    }

    try {
      // Use the enhanced export service
      await exportService.exportPrefillBenchmark(results, {
        format,
        includeSystemMetrics: true,
        includePowerMeasurements: true,
      });
    } catch (error: any) {
      Alert.alert('Error', `Failed to export results: ${error.message}`);
    }
  };

  const renderResults = () => {
    if (!results || results.results.length === 0) {
      return null;
    }

    // Calculate statistics for each prompt length
    const uniqueLengths = [...new Set(results.results.map(r => r.actualTokens))].sort((a, b) => a - b);
    const stats = uniqueLengths.map(length => calculateStats(results.results, length)).filter(s => s !== null);

    return (
      <View style={styles.resultsContainer}>
        <Text style={styles.sectionTitle}>Results Summary</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCell, styles.headerCell]}>Tokens</Text>
              <Text style={[styles.tableCell, styles.headerCell]}>Mean TTFT (ms)</Text>
              <Text style={[styles.tableCell, styles.headerCell]}>Std Dev</Text>
              <Text style={[styles.tableCell, styles.headerCell]}>Min</Text>
              <Text style={[styles.tableCell, styles.headerCell]}>Max</Text>
              <Text style={[styles.tableCell, styles.headerCell]}>Samples</Text>
            </View>
            {stats.map((stat: any, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.tableCell}>{stat.tokenLength}</Text>
                <Text style={styles.tableCell}>{stat.mean.toFixed(1)}</Text>
                <Text style={styles.tableCell}>{stat.std.toFixed(1)}</Text>
                <Text style={styles.tableCell}>{stat.min.toFixed(1)}</Text>
                <Text style={styles.tableCell}>{stat.max.toFixed(1)}</Text>
                <Text style={styles.tableCell}>{stat.count}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>Prefill Benchmark</Text>
          <Text style={styles.subtitle}>Measure time-to-first-token across prompt lengths</Text>
        </View>

        {/* Model Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Model Selection</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={selectedModel}
              onValueChange={setSelectedModel}
              enabled={!isRunning}
              style={styles.picker}
            >
              {availableModels.map(model => (
                <Picker.Item key={model} label={model} value={model} />
              ))}
            </Picker>
          </View>
        </View>

        {/* Configuration */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Configuration</Text>

          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Min Tokens:</Text>
            <TextInput
              style={styles.configInput}
              value={config.minTokens.toString()}
              onChangeText={(text) => setConfig({ ...config, minTokens: parseInt(text) || 50 })}
              keyboardType="numeric"
              editable={!isRunning}
            />
          </View>

          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Max Tokens:</Text>
            <TextInput
              style={styles.configInput}
              value={config.maxTokens.toString()}
              onChangeText={(text) => setConfig({ ...config, maxTokens: parseInt(text) || 3000 })}
              keyboardType="numeric"
              editable={!isRunning}
            />
          </View>

          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Step Size:</Text>
            <TextInput
              style={styles.configInput}
              value={config.step.toString()}
              onChangeText={(text) => setConfig({ ...config, step: parseInt(text) || 50 })}
              keyboardType="numeric"
              editable={!isRunning}
            />
          </View>

          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Iterations:</Text>
            <TextInput
              style={styles.configInput}
              value={config.iterations.toString()}
              onChangeText={(text) => setConfig({ ...config, iterations: parseInt(text) || 20 })}
              keyboardType="numeric"
              editable={!isRunning}
            />
          </View>

          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Warmup Runs:</Text>
            <TextInput
              style={styles.configInput}
              value={(config.warmupRuns || 5).toString()}
              onChangeText={(text) => setConfig({ ...config, warmupRuns: parseInt(text) || 5 })}
              keyboardType="numeric"
              editable={!isRunning}
            />
          </View>
        </View>

        {/* Progress */}
        {isRunning && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Progress</Text>
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
              <Text style={styles.progressText}>{(progress * 100).toFixed(0)}%</Text>
            </View>
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        )}

        {/* Results */}
        {results && renderResults()}

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          {!isRunning ? (
            <>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={startBenchmark}
                disabled={!selectedModel}
              >
                <Text style={styles.buttonText}>Start Benchmark</Text>
              </TouchableOpacity>

              {results && (
                <>
                  <TouchableOpacity
                    style={[styles.button, styles.secondaryButton]}
                    onPress={() => exportResults('json')}
                  >
                    <Text style={styles.buttonText}>Export as JSON</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.secondaryButton]}
                    onPress={() => exportResults('csv')}
                  >
                    <Text style={styles.buttonText}>Export as CSV</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={cancelBenchmark}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  scrollContainer: {
    padding: 20,
  },
  header: {
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#999999',
  },
  section: {
    marginBottom: 25,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 15,
  },
  pickerContainer: {
    backgroundColor: '#3a3a3a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    color: '#ffffff',
    height: 50,
  },
  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  configLabel: {
    flex: 1,
    color: '#cccccc',
    fontSize: 16,
  },
  configInput: {
    flex: 1,
    backgroundColor: '#3a3a3a',
    color: '#ffffff',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressBar: {
    flex: 1,
    height: 20,
    backgroundColor: '#3a3a3a',
    borderRadius: 10,
    overflow: 'hidden',
    marginRight: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
  },
  progressText: {
    color: '#ffffff',
    fontSize: 16,
    minWidth: 50,
    textAlign: 'right',
  },
  statusText: {
    color: '#999999',
    fontSize: 14,
    marginTop: 5,
  },
  resultsContainer: {
    marginBottom: 25,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 15,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: '#4a4a4a',
    paddingBottom: 10,
    marginBottom: 10,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#3a3a3a',
  },
  tableCell: {
    width: 100,
    color: '#cccccc',
    fontSize: 14,
    textAlign: 'center',
  },
  headerCell: {
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonContainer: {
    marginTop: 20,
    gap: 10,
  },
  button: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
  },
  secondaryButton: {
    backgroundColor: '#2196F3',
  },
  dangerButton: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});