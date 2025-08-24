import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Haptics from 'expo-haptics';
import { Message } from '../types';
import { theme } from '../constants/theme';
import { parseMessageContent } from '../utils/messageParser';
import { ThinkingSection } from './ThinkingSection';
import { TokenAnimatedText } from './TokenAnimatedText';
import { ToolMessage } from './ToolMessage';

interface MessageItemProps {
  message: Message;
  isGenerating?: boolean;
}

const MessageItemComponent: React.FC<MessageItemProps> = ({ message, isGenerating = false }) => {
  const isUser = message.sender === 'user';
  const [expandedThinking, setExpandedThinking] = useState<string[]>([]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const [hasSeenThinking, setHasSeenThinking] = useState(false);

  // Parse message content with isGenerating flag
  const parsedContent = useMemo(() =>
    parseMessageContent(message.text, isGenerating),
    [message.text, isGenerating]
  );

  // Initial appearance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: isUser ? 200 : 300,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: isUser ? 80 : 50,
        friction: isUser ? 8 : 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Auto-collapse thinking sections after generation
  useEffect(() => {
    const hasThinking = parsedContent.some(p => p.type === 'thinking');
    const hasIncompleteThinking = parsedContent.some(p => p.type === 'incomplete-thinking');

    // Mark that we've seen thinking content
    if ((hasThinking || hasIncompleteThinking) && !hasSeenThinking) {
      setHasSeenThinking(true);
    }

    // When generation completes and we had thinking content, ensure it's collapsed
    if (!isGenerating && hasSeenThinking && hasThinking && !hasIncompleteThinking) {
      // Clear expanded state to collapse all thinking sections
      setExpandedThinking([]);
    }
  }, [isGenerating, message.id]);

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleThinking = (index: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedThinking((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index]
    );
  };

  const markdownStyles = StyleSheet.create({
    body: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.md,
      lineHeight: 24,
    },
    text: {
      color: theme.colors.text,
    },
    code_inline: {
      backgroundColor: isUser ? 'rgba(0,0,0,0.2)' : theme.colors.surface,
      borderRadius: theme.borderRadius.sm,
      paddingHorizontal: 6,
      paddingVertical: 2,
      fontFamily: 'Menlo',
      fontSize: theme.typography.sizes.sm,
    },
    code_block: {
      backgroundColor: isUser ? 'rgba(0,0,0,0.2)' : theme.colors.surface,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      marginVertical: theme.spacing.sm,
    },
    fence: {
      backgroundColor: isUser ? 'rgba(0,0,0,0.2)' : theme.colors.surface,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      marginVertical: theme.spacing.sm,
    },
    link: {
      color: theme.colors.primaryLight,
      textDecorationLine: 'underline',
    },
  });

  // Render content with token animations
  const renderContent = () => {
    if (isUser) {
      return (
        <Markdown style={markdownStyles} mergeStyle={false}>
          {message.text}
        </Markdown>
      );
    }

    // Simple case: no thinking tags
    if (!message.text.includes('<think>')) {
      if (isGenerating) {
        return (
          <TokenAnimatedText
            text={message.text}
            isAnimating={true}
            style={[markdownStyles.body]}
          />
        );
      }

      return (
        <Markdown style={markdownStyles} mergeStyle={false}>
          {message.text}
        </Markdown>
      );
    }

    // Complex case: has thinking tags
    return (
      <>
        {parsedContent.map((part, index) => {
          if (part.type === 'thinking') {
            // Completed thinking section
            const isExpanded = expandedThinking.includes(`${message.id}-${index}`);

            return (
              <Pressable
                key={`thinking-${index}`}
                onPress={() => toggleThinking(`${message.id}-${index}`)}
              >
                <ThinkingSection
                  content={part.content}
                  isExpanded={isExpanded}
                  isGenerating={false}
                />
              </Pressable>
            );
          }

          if (part.type === 'incomplete-thinking') {
            // Currently generating thinking section - always expanded
            return (
              <ThinkingSection
                key={`incomplete-thinking-${index}`}
                content={part.content}
                isExpanded={true}
                isGenerating={true}
              />
            );
          }

          // Regular text
          if (part.content) {
            // Check if this is the last part and we're generating
            const isLastPart = index === parsedContent.length - 1;
            const shouldAnimate = isGenerating && isLastPart && !parsedContent.some(p => p.type === 'incomplete-thinking');

            if (shouldAnimate) {
              return (
                <TokenAnimatedText
                  key={`text-${index}`}
                  text={part.content}
                  isAnimating={true}
                  style={[markdownStyles.body]}
                />
              );
            }

            return (
              <Markdown key={`text-${index}`} style={markdownStyles} mergeStyle={false}>
                {part.content}
              </Markdown>
            );
          }

          return null;
        })}
      </>
    );
  };

  // Handle tool messages differently
  if (message.isToolCall || message.isToolResult) {
    return (
      <Animated.View
        style={[
          styles.container,
          styles.assistantContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }
        ]}
      >
        <ToolMessage message={message} />
      </Animated.View>
    );
  }

  return (
    <Pressable onLongPress={handleLongPress}>
      <Animated.View
        style={[
          styles.container,
          isUser ? styles.userContainer : styles.assistantContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }
        ]}
      >
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          {renderContent()}
          <Text style={[styles.timestamp, isUser && styles.userTimestamp]}>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
};

export const MessageItem = memo(MessageItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.text === nextProps.message.text &&
    prevProps.isGenerating === nextProps.isGenerating
  );
});

MessageItem.displayName = 'MessageItem';

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
  },
  userBubble: {
    backgroundColor: theme.colors.primary,
    borderBottomRightRadius: theme.spacing.xs,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surfaceLight,
    borderBottomLeftRadius: theme.spacing.xs,
  },
  timestamp: {
    fontSize: theme.typography.sizes.xs,
    marginTop: theme.spacing.xs,
    color: theme.colors.textMuted,
  },
  userTimestamp: {
    color: 'rgba(255,255,255,0.7)',
  },
});
