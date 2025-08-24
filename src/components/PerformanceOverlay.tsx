import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../stores/useStore';
import { SystemMonitorService } from '../services/SystemMonitorService';
import { theme } from '../constants/theme';

interface PerformanceOverlayProps {
  messageId?: string;
}

export const PerformanceOverlay: React.FC<PerformanceOverlayProps> = ({ messageId }) => {
  const { showPerformanceOverlay, togglePerformanceOverlay, performanceMetrics, currentSystemMetrics } = useStore();
  const [fadeAnim] = useState(new Animated.Value(0));
  
  const systemMonitor = SystemMonitorService.getInstance();

  useEffect(() => {
    if (showPerformanceOverlay) {
      systemMonitor.startMonitoring(1000);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        systemMonitor.stopMonitoring();
      });
    }
  }, [showPerformanceOverlay]);

  useEffect(() => {
    const unsubscribe = systemMonitor.addMetricsCallback((metrics) => {
      useStore.getState().updateSystemMetrics(metrics);
    });
    return unsubscribe;
  }, []);

  if (!showPerformanceOverlay) return null;

  const messageMetrics = messageId ? performanceMetrics[messageId] : null;

  return (
    <Animated.View 
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{
            translateY: fadeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, 0],
            }),
          }],
        },
      ]}
    >
      <TouchableOpacity
        style={styles.closeButton}
        onPress={togglePerformanceOverlay}
      >
        <Ionicons name="close" size={20} color={theme.colors.text} />
      </TouchableOpacity>

      <Text style={styles.title}>Performance Metrics</Text>
      
      {messageMetrics && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Inference Metrics</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>TTFT:</Text>
            <Text style={styles.metricValue}>{messageMetrics.ttft?.toFixed(0) || 'N/A'} ms</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>TPS:</Text>
            <Text style={styles.metricValue}>{messageMetrics.tps?.toFixed(1) || 'N/A'} tok/s</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total Time:</Text>
            <Text style={styles.metricValue}>{messageMetrics.totalResponseTime?.toFixed(0) || 'N/A'} ms</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Tokens:</Text>
            <Text style={styles.metricValue}>{messageMetrics.totalTokens}</Text>
          </View>
        </View>
      )}

      {currentSystemMetrics && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System Metrics</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Memory:</Text>
            <Text style={styles.metricValue}>{currentSystemMetrics.memoryUsageMB.toFixed(0)} MB</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Available:</Text>
            <Text style={styles.metricValue}>{currentSystemMetrics.availableMemoryMB.toFixed(0)} MB</Text>
          </View>
          {currentSystemMetrics.cpuUsage !== undefined && (
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>CPU:</Text>
              <Text style={styles.metricValue}>{currentSystemMetrics.cpuUsage.toFixed(1)}%</Text>
            </View>
          )}
          {currentSystemMetrics.batteryLevel !== undefined && (
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Battery:</Text>
              <Text style={styles.metricValue}>
                {currentSystemMetrics.batteryLevel}% ({currentSystemMetrics.batteryState})
              </Text>
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    right: 20,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    minWidth: 250,
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 12,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary,
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  metricLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  metricValue: {
    fontSize: 12,
    color: theme.colors.text,
    fontWeight: '500',
  },
});