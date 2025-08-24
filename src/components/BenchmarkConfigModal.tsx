import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface BenchmarkConfig {
  iterations: number;
  startProblemId: number;
  endProblemId: number;
  maxTemperature: number;
  minBatteryLevel: number;
  pauseBetweenProblems: number;
  enableAutonomousMode: boolean;
  maxHours: number;
  enablePassAtK: boolean;
  passAtKValues: number[];
  enableJointMode?: boolean;
  batchSize?: number;
  jointModes?: ('base' | 'tool_submission' | 'full_tool')[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onStart: (config: BenchmarkConfig) => void;
  totalProblems: number;
}

export const BenchmarkConfigModal: React.FC<Props> = ({
  visible,
  onClose,
  onStart,
  totalProblems,
}) => {
  const [config, setConfig] = useState<BenchmarkConfig>({
    iterations: 1,
    startProblemId: 11,
    endProblemId: 20,
    maxTemperature: 80,
    minBatteryLevel: 20,
    pauseBetweenProblems: 1000,
    enableAutonomousMode: false,
    maxHours: 24,
    enablePassAtK: false,
    passAtKValues: [1, 3, 5, 10],
    enableJointMode: false,
    batchSize: 10,
    jointModes: ['base', 'tool_submission', 'full_tool'],
  });

  const iterationOptions = [1, 3, 5, 10];

  const handleStart = () => {
    // Validation
    if (config.startProblemId < 11 || config.startProblemId > 510) {
      Alert.alert('Invalid Range', 'Start problem ID must be between 11 and 510');
      return;
    }
    if (config.endProblemId < config.startProblemId || config.endProblemId > 510) {
      Alert.alert('Invalid Range', 'End problem ID must be after start and ≤ 510');
      return;
    }
    if (config.maxTemperature < 40 || config.maxTemperature > 100) {
      Alert.alert('Invalid Temperature', 'Max temperature must be between 40°C and 100°C');
      return;
    }
    if (config.minBatteryLevel < 5 || config.minBatteryLevel > 100) {
      Alert.alert('Invalid Battery Level', 'Min battery must be between 5% and 100%');
      return;
    }

    onStart(config);
    onClose();
  };

  const updateConfig = (key: keyof BenchmarkConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Benchmark Configuration</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Iterations */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Iterations per Problem</Text>
              <View style={styles.iterationButtons}>
                {iterationOptions.map(num => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.iterationButton,
                      config.iterations === num && styles.iterationButtonActive,
                    ]}
                    onPress={() => updateConfig('iterations', num)}
                  >
                    <Text
                      style={[
                        styles.iterationButtonText,
                        config.iterations === num && styles.iterationButtonTextActive,
                      ]}
                    >
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Problem Range */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Problem Range</Text>
              <Text style={styles.helperText}>
                Dataset has {totalProblems} problems (IDs 11-510)
              </Text>
              <View style={styles.rangeInputs}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Start ID</Text>
                  <TextInput
                    style={styles.textInput}
                    value={String(config.startProblemId)}
                    onChangeText={text => {
                      const num = parseInt(text) || 11;
                      updateConfig('startProblemId', num);
                    }}
                    keyboardType="numeric"
                    placeholder="11"
                  />
                </View>
                <Text style={styles.rangeSeparator}>to</Text>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>End ID</Text>
                  <TextInput
                    style={styles.textInput}
                    value={String(config.endProblemId)}
                    onChangeText={text => {
                      const num = parseInt(text) || 20;
                      updateConfig('endProblemId', num);
                    }}
                    keyboardType="numeric"
                    placeholder="510"
                  />
                </View>
              </View>
              <Text style={styles.rangeInfo}>
                Will run {Math.max(0, config.endProblemId - config.startProblemId + 1)} problems
                × {config.iterations} iterations = {' '}
                {Math.max(0, (config.endProblemId - config.startProblemId + 1) * config.iterations)} total runs
              </Text>
            </View>

            {/* Thermal Limits */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Thermal Limits</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Max Temperature (°C)</Text>
                <TextInput
                  style={styles.textInput}
                  value={String(config.maxTemperature)}
                  onChangeText={text => {
                    const num = parseInt(text) || 80;
                    updateConfig('maxTemperature', num);
                  }}
                  keyboardType="numeric"
                  placeholder="80"
                />
              </View>
              <Text style={styles.helperText}>
                Benchmark will pause if temperature exceeds {config.maxTemperature}°C
              </Text>
            </View>

            {/* Power Limits */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Power Limits</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Min Battery Level (%)</Text>
                <TextInput
                  style={styles.textInput}
                  value={String(config.minBatteryLevel)}
                  onChangeText={text => {
                    const num = parseInt(text) || 20;
                    updateConfig('minBatteryLevel', num);
                  }}
                  keyboardType="numeric"
                  placeholder="20"
                />
              </View>
              <Text style={styles.helperText}>
                Benchmark will pause if battery drops below {config.minBatteryLevel}%
              </Text>
            </View>

            {/* Timing */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Timing</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Pause Between Problems (ms)</Text>
                <TextInput
                  style={styles.textInput}
                  value={String(config.pauseBetweenProblems)}
                  onChangeText={text => {
                    const num = parseInt(text) || 1000;
                    updateConfig('pauseBetweenProblems', num);
                  }}
                  keyboardType="numeric"
                  placeholder="1000"
                />
              </View>
            </View>

            {/* Autonomous Mode */}
            <View style={styles.section}>
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.sectionTitle}>Autonomous Mode</Text>
                  <Text style={styles.helperText}>
                    Run continuously with automatic pause/resume
                  </Text>
                </View>
                <Switch
                  value={config.enableAutonomousMode}
                  onValueChange={value => {
                    updateConfig('enableAutonomousMode', value);
                    if (value) updateConfig('enableJointMode', false);
                  }}
                  trackColor={{ false: '#767577', true: '#81b0ff' }}
                  thumbColor={config.enableAutonomousMode ? '#007AFF' : '#f4f3f4'}
                />
              </View>
              {config.enableAutonomousMode && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Max Runtime (hours)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={String(config.maxHours)}
                    onChangeText={text => {
                      const num = parseInt(text) || 24;
                      updateConfig('maxHours', num);
                    }}
                    keyboardType="numeric"
                    placeholder="24"
                  />
                </View>
              )}
            </View>

            {/* Joint Benchmarking Mode */}
            <View style={styles.section}>
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.sectionTitle}>Joint Benchmarking Mode</Text>
                  <Text style={styles.helperText}>
                    Run all modes in batches to prevent memory issues
                  </Text>
                </View>
                <Switch
                  value={config.enableJointMode || false}
                  onValueChange={value => {
                    updateConfig('enableJointMode', value);
                    if (value) updateConfig('enableAutonomousMode', false);
                  }}
                  trackColor={{ false: '#767577', true: '#81b0ff' }}
                  thumbColor={config.enableJointMode ? '#007AFF' : '#f4f3f4'}
                />
              </View>
              {config.enableJointMode && (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Batch Size</Text>
                    <TextInput
                      style={styles.textInput}
                      value={String(config.batchSize)}
                      onChangeText={text => {
                        const num = parseInt(text) || 10;
                        updateConfig('batchSize', num);
                      }}
                      keyboardType="numeric"
                      placeholder="10"
                    />
                  </View>
                  <Text style={styles.helperText}>
                    Will run {config.batchSize} problems at a time through all selected modes
                  </Text>
                  
                  <Text style={styles.inputLabel}>Modes to Run</Text>
                  <View style={styles.checkboxGroup}>
                    {(['base', 'tool_submission', 'full_tool'] as const).map(mode => (
                      <TouchableOpacity
                        key={mode}
                        style={styles.checkboxRow}
                        onPress={() => {
                          const currentModes = config.jointModes || [];
                          const newModes = currentModes.includes(mode)
                            ? currentModes.filter(m => m !== mode)
                            : [...currentModes, mode];
                          updateConfig('jointModes', newModes);
                        }}
                      >
                        <View style={[
                          styles.checkbox,
                          (config.jointModes || []).includes(mode) && styles.checkboxChecked
                        ]}>
                          {(config.jointModes || []).includes(mode) && (
                            <Ionicons name="checkmark" size={16} color="#fff" />
                          )}
                        </View>
                        <Text style={styles.checkboxLabel}>
                          {mode.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.rangeInfo}>
                    Total batches: {Math.ceil((config.endProblemId - config.startProblemId + 1) / (config.batchSize || 10))}
                    {' '}× {(config.jointModes || []).length} modes
                  </Text>
                </>
              )}
            </View>

            {/* Pass@K Evaluation */}
            <View style={styles.section}>
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.sectionTitle}>Pass@K Evaluation</Text>
                  <Text style={styles.helperText}>
                    Generate multiple solutions per problem
                  </Text>
                </View>
                <Switch
                  value={config.enablePassAtK}
                  onValueChange={value => updateConfig('enablePassAtK', value)}
                  trackColor={{ false: '#767577', true: '#81b0ff' }}
                  thumbColor={config.enablePassAtK ? '#007AFF' : '#f4f3f4'}
                />
              </View>
              {config.enablePassAtK && (
                <Text style={styles.warningText}>
                  ⚠️ Pass@K will generate {config.iterations} samples per problem
                </Text>
              )}
            </View>

            {/* Estimated Time */}
            <View style={styles.estimateSection}>
              <Text style={styles.estimateTitle}>Estimated Completion Time</Text>
              <Text style={styles.estimateValue}>
                {estimateTime(config)}
              </Text>
              <Text style={styles.estimateDetails}>
                Based on ~30 seconds per problem
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.startButton} onPress={handleStart}>
              <Text style={styles.startButtonText}>Start Benchmark</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

function estimateTime(config: BenchmarkConfig): string {
  const problemCount = Math.max(0, config.endProblemId - config.startProblemId + 1);
  const totalRuns = problemCount * config.iterations;
  const secondsPerRun = 30; // Estimate
  const totalSeconds = totalRuns * secondsPerRun;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `~${hours}h ${minutes}m`;
  } else {
    return `~${minutes} minutes`;
  }
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxWidth: 500,
    flex: 1,
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    padding: 4,
  },
  scrollContent: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  helperText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  iterationButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  iterationButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  iterationButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  iterationButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  iterationButtonTextActive: {
    color: 'white',
  },
  rangeInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#f8f8f8',
  },
  rangeSeparator: {
    fontSize: 16,
    color: '#666',
    marginTop: 20,
  },
  rangeInfo: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 8,
    fontStyle: 'italic',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  warningText: {
    fontSize: 12,
    color: '#FF9800',
    marginTop: 8,
    fontStyle: 'italic',
  },
  estimateSection: {
    backgroundColor: '#f0f8ff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  estimateTitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  estimateValue: {
    fontSize: 24,
    fontWeight: '600',
    color: '#007AFF',
  },
  estimateDetails: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    fontStyle: 'italic',
  },
  checkboxGroup: {
    marginTop: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 4,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#007AFF',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#333',
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  startButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  startButtonText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '600',
  },
});
