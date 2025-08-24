import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';

interface ToolMessageProps {
  message: {
    text: string;
    isToolCall?: boolean;
    isToolResult?: boolean;
    toolCalls?: any[];
  };
}

export const ToolMessage: React.FC<ToolMessageProps> = ({ message }) => {
  if (message.isToolCall) {
    // Parse the message text to format it nicely
    const lines = message.text.split('\n');
    const formattedSections = [];
    let currentSection = { tool: '', result: '' };
    
    for (const line of lines) {
      if (line.startsWith('**') && line.endsWith('**')) {
        if (currentSection.tool) {
          formattedSections.push(currentSection);
        }
        currentSection = { 
          tool: line.replace(/\*\*/g, ''), 
          result: '' 
        };
      } else if (line.trim()) {
        currentSection.result += (currentSection.result ? '\n' : '') + line;
      }
    }
    if (currentSection.tool) {
      formattedSections.push(currentSection);
    }
    
    return (
      <View style={styles.toolCallContainer}>
        <View style={styles.toolHeader}>
          <Ionicons name="construct-outline" size={16} color={theme.colors.primary} />
          <Text style={styles.toolTitle}>Tool Execution</Text>
        </View>
        {formattedSections.map((section, index) => (
          <View key={index} style={styles.toolSection}>
            <View style={styles.toolNameContainer}>
              <Ionicons name="code-working" size={14} color={theme.colors.primary} />
              <Text style={styles.toolName}>{section.tool}</Text>
            </View>
            <View style={styles.toolResultContainer}>
              <Text style={styles.toolResult}>{section.result}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (message.isToolResult) {
    return (
      <View style={styles.toolResultMessageContainer}>
        <View style={styles.toolHeader}>
          <Ionicons name="checkmark-circle-outline" size={16} color={theme.colors.success} />
          <Text style={styles.toolTitle}>Tool Results</Text>
        </View>
        <View style={styles.resultContent}>
          <Text style={styles.resultText}>{message.text}</Text>
        </View>
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  toolCallContainer: {
    backgroundColor: theme.colors.primary + '10',
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginVertical: theme.spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
  },
  toolResultMessageContainer: {
    backgroundColor: theme.colors.success + '10',
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginVertical: theme.spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.success,
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  toolTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text,
    marginLeft: theme.spacing.sm,
  },
  toolSection: {
    marginBottom: theme.spacing.md,
  },
  toolNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  toolName: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.primary,
    marginLeft: theme.spacing.xs,
  },
  toolResultContainer: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginLeft: theme.spacing.md,
  },
  toolResult: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text,
    fontFamily: 'Menlo',
    lineHeight: 20,
  },
  toolText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
  },
  toolDetails: {
    marginTop: theme.spacing.sm,
  },
  toolCall: {
    marginBottom: theme.spacing.sm,
  },
  toolArgs: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textMuted,
    fontFamily: 'Menlo',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
  },
  resultContent: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
  },
  resultText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text,
    fontFamily: 'Menlo',
    lineHeight: 20,
  },
});