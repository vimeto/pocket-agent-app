import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Model } from '../types';
import { theme } from '../constants/theme';
import { useStore } from '../stores/useStore';
import { DownloadProgress } from './DownloadProgress';
import { DownloadLogsModal } from './DownloadLogsModal';
import { HuggingFaceAuthModal } from './HuggingFaceAuthModal';
import { DownloadStatus } from '../types/download';
import { AuthService } from '../services/AuthService';

interface ModelSelectorProps {
  models: Model[];
  selectedModelId: string | null;
  onSelectModel: (modelId: string) => void;
  onDownloadModel: (model: Model) => void;
  onDeleteModel?: (modelId: string) => void;
  visible: boolean;
  onClose: () => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModelId,
  onSelectModel,
  onDownloadModel,
  onDeleteModel,
  visible,
  onClose,
}) => {
  const { downloads } = useStore();
  const [logsModalVisible, setLogsModalVisible] = useState(false);
  const [selectedLogsModelId, setSelectedLogsModelId] = useState<string | null>(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [pendingModel, setPendingModel] = useState<Model | null>(null);
  const authService = AuthService.getInstance();
  const handleViewLogs = (modelId: string) => {
    setSelectedLogsModelId(modelId);
    setLogsModalVisible(true);
  };

  const handleDownloadPress = async (model: Model) => {
    if (model.requiresAuth) {
      const hasToken = await authService.getHuggingFaceToken();
      if (!hasToken) {
        setPendingModel(model);
        setAuthModalVisible(true);
        return;
      }
    }
    onDownloadModel(model);
  };

  const handleAuthSuccess = () => {
    if (pendingModel) {
      onDownloadModel(pendingModel);
      setPendingModel(null);
    }
  };

  const renderModel = ({ item }: { item: Model }) => {
    const isSelected = item.id === selectedModelId;
    const sizeInGB = (item.size / 1e9).toFixed(1);
    const download = downloads[item.id];

    const handlePress = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (item.downloaded && (!download || download.status === DownloadStatus.COMPLETED)) {
        onSelectModel(item.id);
        onClose();
      } else if (!download || download.status === DownloadStatus.FAILED) {
        handleDownloadPress(item);
      }
    };

    return (
      <View style={styles.modelContainer}>
        <TouchableOpacity
          style={[styles.modelItem, isSelected && styles.selectedModel]}
          onPress={handlePress}
          activeOpacity={0.7}
          disabled={download?.status === DownloadStatus.DOWNLOADING}
        >
          <View style={styles.modelInfo}>
            <Text style={styles.modelName}>{item.name}</Text>
            <View style={styles.modelMetadata}>
              <Text style={styles.modelDetails}>
                {sizeInGB}GB • {item.quantization}
              </Text>
              {item.requiresAuth && (
                <View style={styles.authBadge}>
                  <Ionicons name="lock-closed" size={12} color={theme.colors.warning} />
                  <Text style={styles.authBadgeText}>Protected</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.modelStatus}>
            {item.downloaded && (!download || download.status !== DownloadStatus.DOWNLOADING) ? (
              <View style={styles.downloadedActions}>
                {isSelected ? (
                  <View style={styles.selectedIcon}>
                    <Ionicons name="checkmark-circle" size={24} color={theme.colors.primary} />
                  </View>
                ) : (
                  <Ionicons name="checkmark-circle-outline" size={24} color={theme.colors.textMuted} />
                )}
                {onDeleteModel && (
                  <TouchableOpacity 
                    onPress={() => {
                      Alert.alert(
                        'Delete Model',
                        `Are you sure you want to delete ${item.name}?${isSelected ? '\n\nThis is your currently selected model.' : ''}`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { 
                            text: 'Delete', 
                            style: 'destructive',
                            onPress: () => onDeleteModel(item.id)
                          },
                        ]
                      );
                    }}
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            ) : !download ? (
              <TouchableOpacity onPress={() => handleDownloadPress(item)}>
                <Ionicons name="download-outline" size={24} color={theme.colors.primary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
        
        {download && (
          <DownloadProgress
            download={download}
            onViewLogs={() => handleViewLogs(item.id)}
            onRetry={() => onDownloadModel(item)}
            onCancel={() => {/* Implement cancel */}}
          />
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalContainer}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={styles.modalContent}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Select Model</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={models}
            renderItem={renderModel}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </View>
      
      {logsModalVisible && selectedLogsModelId && downloads[selectedLogsModelId] && (
        <DownloadLogsModal
          visible={logsModalVisible}
          logs={downloads[selectedLogsModelId].logs}
          modelName={models.find(m => m.id === selectedLogsModelId)?.name || 'Model'}
          onClose={() => {
            setLogsModalVisible(false);
            setSelectedLogsModelId(null);
          }}
        />
      )}
      
      <HuggingFaceAuthModal
        visible={authModalVisible}
        onClose={() => setAuthModalVisible(false)}
        onSuccess={handleAuthSuccess}
      />
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
    maxHeight: '80%',
    ...theme.shadows.md,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: theme.spacing.sm,
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
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text,
  },
  closeButton: {
    padding: theme.spacing.xs,
  },
  list: {
    paddingVertical: theme.spacing.sm,
  },
  modelContainer: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modelItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  selectedModel: {
    backgroundColor: theme.colors.primaryDark + '15',
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.medium,
    marginBottom: theme.spacing.xs,
    color: theme.colors.text,
  },
  modelDetails: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textSecondary,
  },
  modelStatus: {
    marginLeft: theme.spacing.md,
  },
  selectedIcon: {
    transform: [{ scale: 1.1 }],
  },
  progressContainer: {
    alignItems: 'center',
  },
  progressText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.primary,
    marginTop: theme.spacing.xs,
  },
  modelMetadata: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.warning + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
    marginLeft: theme.spacing.sm,
  },
  authBadgeText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.warning,
    marginLeft: 4,
    fontWeight: theme.typography.weights.medium,
  },
  downloadedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  deleteButton: {
    padding: theme.spacing.xs,
  },
});