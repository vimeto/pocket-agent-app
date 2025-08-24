import React, { useEffect, useRef } from 'react';
import { Text, Animated } from 'react-native';

interface TokenAnimatedTextProps {
  text: string;
  isAnimating: boolean;
  style?: any;
}

export const TokenAnimatedText: React.FC<TokenAnimatedTextProps> = ({
  text,
  isAnimating,
  style
}) => {
  const animatedValue = useRef(new Animated.Value(1)).current;
  const previousLengthRef = useRef(0);

  useEffect(() => {
    if (!isAnimating) {
      previousLengthRef.current = text.length;
      animatedValue.setValue(1);
      return;
    }

    if (text.length > previousLengthRef.current) {
      animatedValue.setValue(0);
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }).start(() => {
        // Mark new baseline after the animation completes
        previousLengthRef.current = text.length;
      });
    }
  }, [text, isAnimating, animatedValue]);

  // Split current text into stable and new parts
  const stableText = text.slice(0, previousLengthRef.current);
  const newToken = text.slice(previousLengthRef.current);

  if (!isAnimating || !newToken) {
    return <Text style={style}>{text}</Text>;
  }

  return (
    <Text style={style}>
      {stableText}
      <Animated.Text
        style={[
          style,
          {
            opacity: animatedValue.interpolate({
              inputRange: [0, 1],
              outputRange: [0.3, 1],
            }),
          },
        ]}
      >
        {newToken}
      </Animated.Text>
    </Text>
  );
};
