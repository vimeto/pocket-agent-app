import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DownloadLog } from '../types/download';
import { theme } from '../constants/theme';

interface DownloadLogsModalProps {
  visible: boolean;
  logs: DownloadLog[];
  modelName: string;
  onClose: () => void;
}

export const DownloadLogsModal: React.FC<DownloadLogsModalProps> = ({
  visible,
  logs,
  modelName,
  onClose,
}) => {
  const getLogIcon = (level: DownloadLog['level']) => {
    switch (level) {
      case 'info':
        return <Ionicons name="information-circle" size={16} color={theme.colors.primary} />;
      case 'warning':
        return <Ionicons name="warning" size={16} color={theme.colors.warning} />;
      case 'error':
        return <Ionicons name="alert-circle" size={16} color={theme.colors.error} />;
    }
  };

  const formatTimestamp = (date: Date) => {
    return new Date(date).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const renderLog = ({ item }: { item: DownloadLog }) => (
    <View style={styles.logItem}>
      <View style={styles.logHeader}>
        {getLogIcon(item.level)}
        <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
      </View>
      <Text style={styles.logMessage}>{item.message}</Text>
      {item.details && (
        <Text style={styles.logDetails}>{JSON.stringify(item.details, null, 2)}</Text>
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalContainer}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Download Logs: {modelName}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
          
          <FlatList
            data={logs}
            renderItem={renderLog}
            keyExtractor={(item, index) => `${item.timestamp}-${index}`}
            contentContainerStyle={styles.logsList}
            showsVerticalScrollIndicator={true}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No logs available</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    maxHeight: '70%',
    ...theme.shadows.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text,
  },
  closeButton: {
    padding: theme.spacing.xs,
  },
  logsList: {
    paddingVertical: theme.spacing.sm,
  },
  logItem: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  timestamp: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textMuted,
    marginLeft: theme.spacing.sm,
    fontFamily: 'Menlo',
  },
  logMessage: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text,
    marginLeft: theme.spacing.lg + 4,
  },
  logDetails: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    marginLeft: theme.spacing.lg + 4,
    marginTop: theme.spacing.xs,
    fontFamily: 'Menlo',
    backgroundColor: theme.colors.background,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
  },
  emptyText: {
    textAlign: 'center',
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.md,
    paddingVertical: theme.spacing.xl,
  },
});