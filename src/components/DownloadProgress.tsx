import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Progress from 'react-native-progress';
import { DownloadState, DownloadStatus } from '../types/download';
import { theme } from '../constants/theme';

interface DownloadProgressProps {
  download: DownloadState;
  onViewLogs: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export const DownloadProgress: React.FC<DownloadProgressProps> = ({
  download,
  onViewLogs,
  onRetry,
  onCancel,
}) => {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number) => {
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  const getStatusIcon = () => {
    switch (download.status) {
      case DownloadStatus.DOWNLOADING:
        return <ActivityIndicator size="small" color={theme.colors.primary} />;
      case DownloadStatus.COMPLETED:
        return <Ionicons name="checkmark-circle" size={24} color={theme.colors.success} />;
      case DownloadStatus.FAILED:
        return <Ionicons name="alert-circle" size={24} color={theme.colors.error} />;
      case DownloadStatus.CANCELLED:
        return <Ionicons name="close-circle" size={24} color={theme.colors.textMuted} />;
      default:
        return null;
    }
  };

  const getStatusText = () => {
    switch (download.status) {
      case DownloadStatus.DOWNLOADING:
        return `${Math.round(download.progress * 100)}% • ${formatSpeed(download.speed)}`;
      case DownloadStatus.COMPLETED:
        return 'Download complete';
      case DownloadStatus.FAILED:
        return download.error || 'Download failed';
      case DownloadStatus.CANCELLED:
        return 'Download cancelled';
      default:
        return 'Waiting...';
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.statusContainer}>
          {getStatusIcon()}
          <Text style={styles.statusText}>{getStatusText()}</Text>
        </View>
        
        <View style={styles.actions}>
          {download.status === DownloadStatus.DOWNLOADING && (
            <TouchableOpacity onPress={onCancel} style={styles.actionButton}>
              <Ionicons name="stop-circle-outline" size={20} color={theme.colors.error} />
            </TouchableOpacity>
          )}
          
          {download.status === DownloadStatus.FAILED && (
            <TouchableOpacity onPress={onRetry} style={styles.actionButton}>
              <Ionicons name="refresh" size={20} color={theme.colors.primary} />
            </TouchableOpacity>
          )}
          
          {download.logs.length > 0 && (
            <TouchableOpacity onPress={onViewLogs} style={styles.actionButton}>
              <Ionicons name="document-text-outline" size={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {download.status === DownloadStatus.DOWNLOADING && (
        <>
          <Progress.Bar
            progress={download.progress}
            width={null}
            height={6}
            color={theme.colors.primary}
            unfilledColor={theme.colors.border}
            borderWidth={0}
            borderRadius={3}
            style={styles.progressBar}
          />
          
          <View style={styles.progressDetails}>
            <Text style={styles.progressText}>
              {formatBytes(download.bytesDownloaded)} / {formatBytes(download.totalBytes)}
            </Text>
            {download.retryCount > 0 && (
              <Text style={styles.retryText}>Retry {download.retryCount}</Text>
            )}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: theme.spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textSecondary,
    marginLeft: theme.spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    padding: theme.spacing.xs,
  },
  progressBar: {
    marginBottom: theme.spacing.xs,
  },
  progressDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textMuted,
  },
  retryText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.warning,
  },
});