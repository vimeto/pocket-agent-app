import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from '../constants/theme';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onStopGeneration?: () => void;
  disabled?: boolean;
  isGenerating?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ 
  onSendMessage, 
  onStopGeneration, 
  disabled, 
  isGenerating 
}) => {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (text.trim() && !disabled && !isGenerating) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSendMessage(text.trim());
      setText('');
    }
  };

  const handleStop = () => {
    if (isGenerating && onStopGeneration) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onStopGeneration();
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message Pocket Agent..."
          placeholderTextColor={theme.colors.textMuted}
          multiline
          maxHeight={120}
          editable={!disabled}
          onSubmitEditing={handleSend}
          selectionColor={theme.colors.primary}
        />
        {isGenerating ? (
          <TouchableOpacity
            style={[styles.sendButton, styles.stopButton]}
            onPress={handleStop}
            activeOpacity={0.7}
          >
            <Ionicons name="stop" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, (!text.trim() || disabled) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || disabled}
            activeOpacity={0.7}
          >
            <Ionicons
              name="arrow-up"
              size={20}
              color={!text.trim() ? theme.colors.textMuted : theme.colors.text}
            />
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.xl,
    fontSize: theme.typography.sizes.md,
    marginRight: theme.spacing.sm,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sendButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.full,
    marginBottom: 4,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.surface,
  },
  stopButton: {
    backgroundColor: theme.colors.error,
  },
});