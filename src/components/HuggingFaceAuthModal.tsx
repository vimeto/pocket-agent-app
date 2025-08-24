import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { AuthService } from '../services/AuthService';

interface HuggingFaceAuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const HuggingFaceAuthModal: React.FC<HuggingFaceAuthModalProps> = ({
  visible,
  onClose,
  onSuccess,
}) => {
  const [token, setToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const authService = AuthService.getInstance();

  const handleSave = async () => {
    if (!token.trim()) {
      Alert.alert('Error', 'Please enter a valid API token');
      return;
    }

    setIsValidating(true);
    try {
      const isValid = await authService.validateToken(token);
      if (!isValid) {
        Alert.alert('Invalid Token', 'The API token you entered is invalid. Please check and try again.');
        setIsValidating(false);
        return;
      }

      await authService.saveHuggingFaceToken(token);
      Alert.alert('Success', 'Hugging Face token saved successfully!');
      setToken('');
      onSuccess();
      onClose();
    } catch (error) {
      Alert.alert('Error', 'Failed to save token. Please try again.');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView 
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Hugging Face Authentication</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.description}>
              Some models require authentication. Enter your Hugging Face API token to download protected models.
            </Text>

            <View style={styles.linkContainer}>
              <Ionicons name="information-circle-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.linkText}>
                Get your token from huggingface.co/settings/tokens
              </Text>
            </View>

            <TextInput
              style={styles.input}
              placeholder="hf_..."
              placeholderTextColor={theme.colors.textMuted}
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!isValidating}
            />

            <TouchableOpacity
              style={[styles.saveButton, (!token.trim() || isValidating) && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={!token.trim() || isValidating}
            >
              {isValidating ? (
                <ActivityIndicator size="small" color={theme.colors.text} />
              ) : (
                <>
                  <Ionicons name="key-outline" size={20} color={theme.colors.text} />
                  <Text style={styles.saveButtonText}>Save Token</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.securityNote}>
              <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textSecondary} />
              {' '}Your token is stored securely on your device
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  body: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
  description: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
    lineHeight: 22,
  },
  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
    backgroundColor: theme.colors.primaryDark + '20',
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  linkText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.primary,
    marginLeft: theme.spacing.sm,
    flex: 1,
  },
  input: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
    fontFamily: 'Menlo',
  },
  saveButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  saveButtonDisabled: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  saveButtonText: {
    color: theme.colors.text,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.medium,
    marginLeft: theme.spacing.sm,
  },
  securityNote: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});