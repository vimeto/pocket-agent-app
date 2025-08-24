import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { StatisticalAnalysisService, StatisticalReport } from '../services/StatisticalAnalysisService';
import { BenchmarkSession } from '../types/benchmark';
import * as Sharing from 'expo-sharing';

interface Props {
  session: BenchmarkSession;
  onClose?: () => void;
}

export const StatisticalAnalysisView: React.FC<Props> = ({ session, onClose }) => {
  const [report, setReport] = useState<StatisticalReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(true);

  useEffect(() => {
    analyzeSession();
  }, [session]);

  const analyzeSession = async () => {
    try {
      const analysisService = StatisticalAnalysisService.getInstance();
      const analysisReport = await analysisService.analyzeSession(session);
      setReport(analysisReport);
    } catch (error) {
      console.error('Error analyzing session:', error);
      Alert.alert('Error', 'Failed to analyze session');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportReport = async (format: 'json' | 'csv') => {
    if (!report) return;

    try {
      const analysisService = StatisticalAnalysisService.getInstance();
      const filePath = await analysisService.exportReportToFile(report, format);
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: format === 'csv' ? 'text/csv' : 'application/json',
          dialogTitle: 'Export Statistical Analysis',
        });
      } else {
        Alert.alert('Success', `Report saved to: ${filePath}`);
      }
    } catch (error) {
      console.error('Error exporting report:', error);
      Alert.alert('Error', 'Failed to export report');
    }
  };

  if (isAnalyzing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Analyzing session...</Text>
      </View>
    );
  }

  if (!report) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>No analysis available</Text>
      </View>
    );
  }

  const renderPercentileBar = (value: number, max: number, label: string) => {
    const percentage = (value / max) * 100;
    return (
      <View style={styles.percentileContainer}>
        <Text style={styles.percentileLabel}>{label}</Text>
        <View style={styles.percentileBarBackground}>
          <View style={[styles.percentileBar, { width: `${percentage}%` }]} />
        </View>
        <Text style={styles.percentileValue}>{value.toFixed(0)}ms</Text>
      </View>
    );
  };

  const renderAnomaly = (anomaly: any, index: number) => {
    const severityColors = {
      low: '#FFC107',
      medium: '#FF9800',
      high: '#F44336',
    };

    return (
      <View key={index} style={[styles.anomalyCard, { borderLeftColor: severityColors[anomaly.severity] }]}>
        <View style={styles.anomalyHeader}>
          <Text style={styles.anomalyType}>{anomaly.type.replace(/_/g, ' ').toUpperCase()}</Text>
          <View style={[styles.severityBadge, { backgroundColor: severityColors[anomaly.severity] }]}>
            <Text style={styles.severityText}>{anomaly.severity.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.anomalyDescription}>{anomaly.description}</Text>
        <Text style={styles.anomalyMetrics}>Affected: {anomaly.affectedMetrics.join(', ')}</Text>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Statistical Analysis</Text>
          <Text style={styles.subtitle}>Session: {report.sessionId}</Text>
          <Text style={styles.subtitle}>Model: {report.modelId}</Text>
          <Text style={styles.subtitle}>Mode: {report.mode}</Text>
        </View>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Export Buttons */}
      <View style={styles.exportButtons}>
        <TouchableOpacity
          style={[styles.exportButton, styles.jsonButton]}
          onPress={() => exportReport('json')}
        >
          <Text style={styles.exportButtonText}>Export JSON</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.exportButton, styles.csvButton]}
          onPress={() => exportReport('csv')}
        >
          <Text style={styles.exportButtonText}>Export CSV</Text>
        </TouchableOpacity>
      </View>

      {/* Latency Distribution */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Latency Distribution</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Mean</Text>
            <Text style={styles.statValue}>{report.latencyDistribution.mean.toFixed(1)}ms</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Median</Text>
            <Text style={styles.statValue}>{report.latencyDistribution.median.toFixed(1)}ms</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Std Dev</Text>
            <Text style={styles.statValue}>{report.latencyDistribution.standardDeviation.toFixed(1)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Outliers</Text>
            <Text style={styles.statValue}>{report.latencyDistribution.outlierPercentage.toFixed(1)}%</Text>
          </View>
        </View>
      </View>

      {/* Performance Metrics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Performance Metrics</Text>
        
        {/* TTFT */}
        <View style={styles.metricGroup}>
          <Text style={styles.metricTitle}>Time to First Token (TTFT)</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Mean</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.ttft.mean.toFixed(0)}ms</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Median</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.ttft.median.toFixed(0)}ms</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>P95</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.ttft.p95.toFixed(0)}ms</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>P99</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.ttft.p99.toFixed(0)}ms</Text>
            </View>
          </View>
        </View>

        {/* TPS */}
        <View style={styles.metricGroup}>
          <Text style={styles.metricTitle}>Tokens Per Second (TPS)</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Mean</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.tps.mean.toFixed(1)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Median</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.tps.median.toFixed(1)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Min</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.tps.min.toFixed(1)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Max</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.tps.max.toFixed(1)}</Text>
            </View>
          </View>
          <View style={styles.stabilityContainer}>
            <Text style={styles.stabilityLabel}>Stability:</Text>
            <View style={styles.stabilityBarBackground}>
              <View 
                style={[
                  styles.stabilityBar, 
                  { 
                    width: `${report.performanceMetrics.tps.stability * 100}%`,
                    backgroundColor: report.performanceMetrics.tps.stability > 0.8 ? '#4CAF50' : 
                                   report.performanceMetrics.tps.stability > 0.6 ? '#FFC107' : '#F44336'
                  }
                ]} 
              />
            </View>
            <Text style={styles.stabilityValue}>
              {(report.performanceMetrics.tps.stability * 100).toFixed(0)}%
            </Text>
          </View>
        </View>

        {/* Inter-Token Latency */}
        <View style={styles.metricGroup}>
          <Text style={styles.metricTitle}>Inter-Token Latency</Text>
          <View style={styles.percentileChart}>
            {renderPercentileBar(
              report.performanceMetrics.interTokenLatency.percentiles.p50,
              report.performanceMetrics.interTokenLatency.percentiles.p99,
              'P50'
            )}
            {renderPercentileBar(
              report.performanceMetrics.interTokenLatency.percentiles.p75,
              report.performanceMetrics.interTokenLatency.percentiles.p99,
              'P75'
            )}
            {renderPercentileBar(
              report.performanceMetrics.interTokenLatency.percentiles.p90,
              report.performanceMetrics.interTokenLatency.percentiles.p99,
              'P90'
            )}
            {renderPercentileBar(
              report.performanceMetrics.interTokenLatency.percentiles.p95,
              report.performanceMetrics.interTokenLatency.percentiles.p99,
              'P95'
            )}
            {renderPercentileBar(
              report.performanceMetrics.interTokenLatency.percentiles.p99,
              report.performanceMetrics.interTokenLatency.percentiles.p99,
              'P99'
            )}
          </View>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Jitter</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.interTokenLatency.jitter.toFixed(1)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Burstiness</Text>
              <Text style={styles.statValue}>{report.performanceMetrics.interTokenLatency.burstiness.toFixed(2)}x</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Consistency</Text>
              <Text style={styles.statValue}>
                {(report.performanceMetrics.interTokenLatency.consistency * 100).toFixed(0)}%
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Tool Performance */}
      {report.toolPerformance && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tool Performance</Text>
          <View style={styles.toolsContainer}>
            {Array.from(report.toolPerformance.byTool.entries()).map(([toolName, stats]) => (
              <View key={toolName} style={styles.toolCard}>
                <Text style={styles.toolName}>{toolName}</Text>
                <View style={styles.toolStats}>
                  <Text style={styles.toolStat}>Calls: {stats.callCount}</Text>
                  <Text style={styles.toolStat}>Avg Exec: {stats.avgExecutionTime.toFixed(0)}ms</Text>
                  <Text style={styles.toolStat}>Avg Total: {stats.avgTotalTime.toFixed(0)}ms</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={styles.toolSummary}>
            <Text style={styles.toolSummaryText}>
              Total Overhead: {report.toolPerformance.totalToolOverhead.toFixed(0)}ms
            </Text>
            <Text style={styles.toolSummaryText}>
              Avg Calls/Problem: {report.toolPerformance.toolCallFrequency.toFixed(1)}
            </Text>
          </View>
        </View>
      )}

      {/* Anomalies */}
      {report.anomalies.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Anomalies Detected</Text>
          {report.anomalies.map((anomaly, index) => renderAnomaly(anomaly, index))}
        </View>
      )}

      {/* Correlations */}
      {report.contextCorrelation && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Context Correlations</Text>
          <View style={styles.correlationContainer}>
            <View style={styles.correlationItem}>
              <Text style={styles.correlationLabel}>Token Count vs Latency</Text>
              <Text style={[
                styles.correlationValue,
                { color: Math.abs(report.contextCorrelation.tokenCountVsLatency) > 0.5 ? '#F44336' : '#4CAF50' }
              ]}>
                {report.contextCorrelation.tokenCountVsLatency.toFixed(3)}
              </Text>
            </View>
            <View style={styles.correlationItem}>
              <Text style={styles.correlationLabel}>Position vs Latency</Text>
              <Text style={[
                styles.correlationValue,
                { color: Math.abs(report.contextCorrelation.positionVsLatency) > 0.5 ? '#F44336' : '#4CAF50' }
              ]}>
                {report.contextCorrelation.positionVsLatency.toFixed(3)}
              </Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#F44336',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    borderRadius: 4,
    backgroundColor: '#f0f0f0',
  },
  closeButtonText: {
    fontSize: 14,
    color: '#333',
  },
  exportButtons: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  exportButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  jsonButton: {
    backgroundColor: '#007AFF',
  },
  csvButton: {
    backgroundColor: '#4CAF50',
  },
  exportButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  section: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#fff',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  statItem: {
    width: '50%',
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  metricGroup: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  metricTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
    color: '#444',
  },
  percentileChart: {
    marginVertical: 12,
  },
  percentileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  percentileLabel: {
    width: 40,
    fontSize: 12,
    color: '#666',
  },
  percentileBarBackground: {
    flex: 1,
    height: 20,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  percentileBar: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  percentileValue: {
    width: 60,
    fontSize: 12,
    color: '#333',
    textAlign: 'right',
  },
  stabilityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  stabilityLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  stabilityBarBackground: {
    flex: 1,
    height: 24,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  stabilityBar: {
    height: '100%',
    borderRadius: 4,
  },
  stabilityValue: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  toolsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toolCard: {
    backgroundColor: '#f8f8f8',
    padding: 12,
    borderRadius: 8,
    minWidth: '45%',
  },
  toolName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
    color: '#333',
  },
  toolStats: {
    marginTop: 4,
  },
  toolStat: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  toolSummary: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
  },
  toolSummaryText: {
    fontSize: 14,
    color: '#333',
    marginVertical: 2,
  },
  anomalyCard: {
    marginVertical: 8,
    padding: 12,
    backgroundColor: '#fff5f5',
    borderRadius: 8,
    borderLeftWidth: 4,
  },
  anomalyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  anomalyType: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  anomalyDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  anomalyMetrics: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  correlationContainer: {
    marginTop: 8,
  },
  correlationItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  correlationLabel: {
    fontSize: 14,
    color: '#666',
  },
  correlationValue: {
    fontSize: 16,
    fontWeight: '600',
  },
});