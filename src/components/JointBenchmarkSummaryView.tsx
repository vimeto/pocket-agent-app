import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { AutonomousBenchmarkService } from '../services/AutonomousBenchmarkService';

interface JointBenchmarkSummaryViewProps {
  summary: any;
  onClose: () => void;
}

export const JointBenchmarkSummaryView: React.FC<JointBenchmarkSummaryViewProps> = ({ summary, onClose }) => {
  const autonomousService = AutonomousBenchmarkService.getInstance();

  const handleClose = () => {
    // Reset the joint benchmark state only when closing the summary
    // This ensures the export path is available while the summary is open
    autonomousService.resetJointBenchmarkState();
    onClose();
  };

  const handleExport = async () => {
    try {
      await autonomousService.shareJointBenchmarkResults();
    } catch (error: any) {
      Alert.alert('Export Failed', error.message || 'Could not export results');
    }
  };

  const formatNumber = (num: number): string => {
    if (typeof num !== 'number' || isNaN(num)) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toFixed(2);
  };

  const formatPercentage = (num: number): string => {
    if (typeof num !== 'number' || isNaN(num)) return '0%';
    return `${(num * 100).toFixed(1)}%`;
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Joint Benchmark Complete
        </Text>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Overall Summary</Text>
        
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Total Problems</Text>
            <Text style={[styles.statValue, { color: theme.colors.primary }]}>
              {summary.totalProblems}
            </Text>
          </View>
          
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Success Rate</Text>
            <Text style={[styles.statValue, { color: theme.colors.primary }]}>
              {formatPercentage(summary.overallSuccessRate)}
            </Text>
          </View>
          
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Total Tokens</Text>
            <Text style={[styles.statValue, { color: theme.colors.primary }]}>
              {formatNumber(summary.totalTokens)}
            </Text>
          </View>
          
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Total Energy</Text>
            <Text style={[styles.statValue, { color: theme.colors.primary }]}>
              {formatNumber(summary.totalEnergy)}J
            </Text>
          </View>
          
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Avg Tokens/Problem</Text>
            <Text style={[styles.statValue, { color: theme.colors.primary }]}>
              {formatNumber(summary.avgTokensPerProblem)}
            </Text>
          </View>
          
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Energy/Token</Text>
            <Text style={[styles.statValue, { color: theme.colors.primary }]}>
              {formatNumber(summary.avgEnergyPerToken * 1000)}mJ
            </Text>
          </View>
        </View>
      </View>

      {/* Mode-specific results */}
      {Object.entries(summary.modeResults).map(([mode, modeData]: [string, any]) => (
        <View key={mode} style={[styles.modeCard, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.modeTitle, { color: theme.colors.text }]}>
            {mode.replace(/_/g, ' ').toUpperCase()}
          </Text>
          
          <View style={styles.modeStats}>
            <View style={styles.modeStatRow}>
              <Text style={[styles.modeStatLabel, { color: theme.colors.textSecondary }]}>
                Problems Solved:
              </Text>
              <Text style={[styles.modeStatValue, { color: theme.colors.text }]}>
                {modeData.successfulProblems} / {modeData.totalProblems}
              </Text>
            </View>
            
            <View style={styles.modeStatRow}>
              <Text style={[styles.modeStatLabel, { color: theme.colors.textSecondary }]}>
                Success Rate:
              </Text>
              <Text style={[styles.modeStatValue, { color: theme.colors.text }]}>
                {formatPercentage(modeData.successRate)}
              </Text>
            </View>
            
            <View style={styles.modeStatRow}>
              <Text style={[styles.modeStatLabel, { color: theme.colors.textSecondary }]}>
                Avg TTFT:
              </Text>
              <Text style={[styles.modeStatValue, { color: theme.colors.text }]}>
                {formatNumber(modeData.avgTTFT)}ms
              </Text>
            </View>
            
            <View style={styles.modeStatRow}>
              <Text style={[styles.modeStatLabel, { color: theme.colors.textSecondary }]}>
                Avg TPS:
              </Text>
              <Text style={[styles.modeStatValue, { color: theme.colors.text }]}>
                {formatNumber(modeData.avgTPS)}
              </Text>
            </View>
          </View>
        </View>
      ))}

      {/* Export buttons */}
      <View style={styles.exportSection}>
        <TouchableOpacity
          style={[styles.exportButton, { backgroundColor: theme.colors.primary }]}
          onPress={handleExport}
        >
          <Ionicons name="share-outline" size={20} color={theme.colors.background} />
          <Text style={[styles.exportButtonText, { color: theme.colors.background }]}>
            Export Combined Results
          </Text>
        </TouchableOpacity>
        
        <Text style={[styles.exportNote, { color: theme.colors.textSecondary }]}>
          Total Batches: {summary.totalBatches}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 8,
  },
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statItem: {
    width: '48%',
    marginBottom: 16,
  },
  statLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '600',
  },
  modeCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  modeTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  modeStats: {
    gap: 8,
  },
  modeStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  modeStatLabel: {
    fontSize: 14,
  },
  modeStatValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  exportSection: {
    marginTop: 20,
    marginBottom: 40,
    alignItems: 'center',
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  exportButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  exportNote: {
    fontSize: 12,
    marginTop: 8,
  },
});