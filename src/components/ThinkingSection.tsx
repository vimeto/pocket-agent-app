import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { TokenAnimatedText } from './TokenAnimatedText';

interface ThinkingSectionProps {
  content: string;
  isExpanded?: boolean;
  isGenerating?: boolean;
}

export const ThinkingSection: React.FC<ThinkingSectionProps> = ({
  content,
  isExpanded = false,
  isGenerating = false
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  // Always start expanded when generating, otherwise respect isExpanded prop
  const expandAnim = useRef(new Animated.Value(isGenerating || isExpanded ? 1 : 0)).current;

  useEffect(() => {
    // Pulsing animation for the icon
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Rotating animation for the thinking indicator
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  useEffect(() => {
    // Always expanded when generating
    const targetValue = isGenerating || isExpanded ? 1 : 0;
    Animated.timing(expandAnim, {
      toValue: targetValue,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [isExpanded, isGenerating]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const contentOpacity = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0.7],
  });

  const contentHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Animated.View
          style={[
            styles.iconContainer,
            { transform: [{ scale: pulseAnim }] }
          ]}
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons
              name="bulb-outline"
              size={16}
              color={theme.colors.primaryLight}
            />
          </Animated.View>
        </Animated.View>
        <Text style={styles.label}>Thinking</Text>
        {isGenerating && (
          <Text style={styles.generatingLabel}> (in progress)</Text>
        )}
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  opacity: pulseAnim.interpolate({
                    inputRange: [1, 1.2],
                    outputRange: [0.3, 1],
                  }),
                  transform: [{
                    scale: pulseAnim.interpolate({
                      inputRange: [1, 1.2],
                      outputRange: [0.8, 1.2],
                    }),
                  }],
                },
              ]}
            />
          ))}
        </View>
      </View>

      <Animated.View
        style={[
          styles.contentContainer,
          {
            opacity: contentOpacity,
            transform: [{ scaleY: contentHeight }],
          }
        ]}
      >
        {isGenerating ? (
          <TokenAnimatedText
            text={content}
            isAnimating={true}
            style={styles.content}
          />
        ) : (
          <Text style={styles.content}>{content}</Text>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: theme.spacing.sm,
    backgroundColor: theme.colors.primaryDark + '10',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primaryDark + '20',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  iconContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.primaryLight,
    fontWeight: theme.typography.weights.medium,
    marginLeft: theme.spacing.sm,
  },
  generatingLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.primaryLight,
    fontStyle: 'italic',
    opacity: 0.7,
  },
  dots: {
    flexDirection: 'row',
    marginLeft: theme.spacing.sm,
    gap: 4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.primaryLight,
  },
  contentContainer: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  content: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textSecondary,
    lineHeight: 20,
    fontStyle: 'italic',
  },
});
