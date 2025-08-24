import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  Text,
  TouchableOpacity,
  StatusBar,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useStore } from '../stores/useStore';
import { MessageItem } from '../components/MessageItem';
import { ChatInput } from '../components/ChatInput';
import { ModelSelector } from '../components/ModelSelector';
import { TypingIndicator } from '../components/TypingIndicator';
import { PerformanceOverlay } from '../components/PerformanceOverlay';
import { ModelService } from '../services/ModelService';
import { InferenceService } from '../services/InferenceService';
import { Message, Model } from '../types';
import { theme } from '../constants/theme';
import { DownloadStatus } from '../types/download';
import { PythonTestButton } from '../components/PythonTestButton';
import { getToolsForLlama } from '../config/tools';
import { executeToolCallsSequentially } from '../utils/toolExecutor';

export const ChatScreen: React.FC = () => {
  const {
    sessions,
    currentSessionId,
    models,
    selectedModelId,
    inferenceConfig,
    isGenerating,
    createSession,
    addMessage,
    updateMessage,
    updateModels,
    setSelectedModel,
    setGenerating,
    togglePerformanceOverlay,
  } = useStore();

  const [showModelSelector, setShowModelSelector] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const scrollAnimation = useRef(new Animated.Value(0)).current;
  const modelService = ModelService.getInstance();
  const inferenceService = InferenceService.getInstance();

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  useEffect(() => {
    loadModels();
  }, []);

  useEffect(() => {
    StatusBar.setBarStyle('light-content');
  }, []);

  const loadModels = async () => {
    const availableModels = await modelService.getAvailableModels();
    updateModels(availableModels);

    const downloadedModel = availableModels.find((m) => m.downloaded);
    if (downloadedModel && !selectedModelId) {
      setSelectedModel(downloadedModel.id);
    }
  };

  /**
   * Scroll helper that:
   * 1. Resets `scrollAnimation` so the empty-state icon keeps its nice fade / scale
   *    every time the chat grows.
   * 2. Immediately asks the list to scroll to the bottom using the native
   *    built-in animation. This is more reliable than waiting for an
   *    unrelated timing callback and means it will also work for every new
   *    streamed token.
   */
  const scrollToBottom = useCallback(() => {
    if (!flatListRef.current) return;

    // Restart the placeholder animation (only visible when the list is empty).
    scrollAnimation.setValue(0);
    Animated.timing(scrollAnimation, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // A tiny delay ensures the FlatList has laid out new content before we try
    // to scroll – this prevents occasional no-ops during very fast streaming.
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
  }, [scrollAnimation]);

  const handleSendMessage = async (text: string) => {
    if (!selectedModelId) {
      Alert.alert('No Model Selected', 'Please select a model first');
      return;
    }

    let sessionId = currentSessionId;
    if (!sessionId) {
      const session = createSession(selectedModelId);
      sessionId = session.id;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      text,
      sender: 'user',
      timestamp: new Date(),
    };

    addMessage(sessionId, userMessage);
    setGenerating(true);
    scrollToBottom();

    try {
      await inferenceService.loadModel(selectedModelId);

      // Get chat history in the format llama.rn expects
      const session = sessions.find(s => s.id === sessionId);
      const chatHistory = session ? session.messages : [];
      
      // Format messages for llama.rn
      const messages = [
        {
          role: 'system',
          content: `You are a helpful AI assistant with access to Python code execution and file management tools.

When you need to use a tool, respond ONLY with a JSON object. Choose ONE of these formats:

Format 1 (preferred): {"name": "tool_name", "parameters": {"param1": "value1"}}
Format 2: {"tool_call": {"name": "tool_name", "arguments": {"param1": "value1"}}}

Available tools:
- run_python_code: Execute Python code directly (parameters: code)
- run_python_file: Execute a Python file by name (parameters: filename)
- upsert_file: Create or update a file (parameters: filename, content)
- delete_file: Delete a file (parameters: filename)
- list_files: List all files (no parameters)
- read_file: Read a file's contents (parameters: filename)

Important: 
- Files must exist before you can run them. Use upsert_file to create files first.
- When calling tools: Respond with ONLY the JSON, no other text.
- After receiving tool results, continue with the next tool if needed.
- When all tasks are complete: Provide a plain text summary (NOT JSON) describing what was accomplished.`
        },
        ...chatHistory.map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        })),
        {
          role: 'user',
          content: text
        }
      ];

      // Execute tool calls sequentially
      await executeToolCallsSequentially(
        messages,
        inferenceService,
        { ...inferenceConfig, tools: getToolsForLlama() },
        sessionId,
        addMessage,
        updateMessage,
        scrollToBottom
      );

      scrollToBottom();
    } catch (error) {
      console.error('[ChatScreen] Error in handleSendMessage:', error);
      Alert.alert('Error', `Failed to generate response: ${error}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadModel = async (model: Model) => {
    const { initDownload, updateDownload, addDownloadLog, clearDownload } = useStore.getState();

    // Initialize download state
    initDownload(model.id);

    try {
      await modelService.downloadModel(
        model,
        (bytesWritten, contentLength, speed) => {
          const progress = contentLength > 0 ? bytesWritten / contentLength : 0;
          useStore.getState().updateDownload(model.id, {
            bytesDownloaded: bytesWritten,
            totalBytes: contentLength,
            progress: progress,
            speed,
          });
        },
        (level, message, details) => {
          addDownloadLog(model.id, level, message, details);
        }
      );

      // Update download state to completed
      updateDownload(model.id, {
        status: DownloadStatus.COMPLETED,
        endTime: new Date(),
        progress: 1,
      });

      await loadModels();
      setSelectedModel(model.id);

      // Clear download state after a delay
      setTimeout(() => clearDownload(model.id), 5000);
    } catch (error: any) {
      updateDownload(model.id, {
        status: DownloadStatus.FAILED,
        error: error.message,
        endTime: new Date(),
      });
      addDownloadLog(model.id, 'error', 'Download failed', { error: error.message });
    }
  };

  const handleModelPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowModelSelector(true);
  };

  const handleStopGeneration = async () => {
    try {
      await inferenceService.stopGeneration();
      setGenerating(false);
    } catch (error) {
      console.error('Error stopping generation:', error);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      // If we're deleting the currently loaded model, unload it first
      if (inferenceService.getCurrentModelId() === modelId) {
        await inferenceService.unloadModel();
      }

      await modelService.deleteModel(modelId);
      await loadModels();

      // If we deleted the selected model, clear selection
      if (selectedModelId === modelId) {
        setSelectedModel('');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to delete model');
    }
  };

  const selectedModel = models.find((m) => m.id === selectedModelId);

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isLastMessage = index === (currentSession?.messages.length || 0) - 1;
    const isCurrentlyGenerating = isGenerating && isLastMessage && item.sender === 'assistant';

    return (
      <MessageItem
        message={item}
        isGenerating={isCurrentlyGenerating}
      />
    );
  }, [isGenerating, currentSession?.messages.length]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const EmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Animated.View
        style={{
          transform: [{
            scale: scrollAnimation.interpolate({
              inputRange: [0, 1],
              outputRange: [0.9, 1],
            }),
          }],
          opacity: scrollAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1],
          }),
        }}
      >
        <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textMuted} />
      </Animated.View>
      <Text style={styles.emptyTitle}>Welcome to Pocket Agent</Text>
      <Text style={styles.emptyText}>
        Select a model and start chatting with your local AI assistant
      </Text>
    </View>
  );

  const ListFooterComponent = () => {
    // Show typing indicator only when generating and the last message is from user
    const lastMessage = currentSession?.messages[currentSession.messages.length - 1];
    const showTyping = isGenerating && lastMessage?.sender === 'user';
    return <TypingIndicator visible={showTyping} />;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.modelButton}
          onPress={handleModelPress}
          activeOpacity={0.7}
        >
          <Ionicons name="cube-outline" size={20} color={theme.colors.primary} />
          <Text style={styles.modelButtonText} numberOfLines={1}>
            {selectedModel?.name || 'Select Model'}
          </Text>
          <Ionicons name="chevron-down" size={16} color={theme.colors.primary} />
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.performanceButton}
          onPress={togglePerformanceOverlay}
          activeOpacity={0.7}
        >
          <Ionicons name="speedometer-outline" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <PythonTestButton />

      <FlatList
        ref={flatListRef}
        data={currentSession?.messages || []}
        renderItem={renderMessage}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.messagesContent}
        ListEmptyComponent={EmptyComponent}
        ListFooterComponent={ListFooterComponent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={scrollToBottom}
        onLayout={scrollToBottom}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={10}
        initialNumToRender={10}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
        }}
      />

      <ChatInput
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        disabled={isGenerating}
        isGenerating={isGenerating}
      />

      <ModelSelector
        models={models}
        selectedModelId={selectedModelId}
        onSelectModel={setSelectedModel}
        onDownloadModel={handleDownloadModel}
        onDeleteModel={handleDeleteModel}
        visible={showModelSelector}
        onClose={() => setShowModelSelector(false)}
      />
      
      <PerformanceOverlay 
        messageId={currentSession?.messages[currentSession.messages.length - 1]?.id}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  modelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  performanceButton: {
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modelButtonText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text,
    marginHorizontal: theme.spacing.sm,
    flex: 1,
    fontWeight: theme.typography.weights.medium,
  },
  messagesContent: {
    paddingVertical: theme.spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: 100,
  },
  emptyTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  emptyText: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
