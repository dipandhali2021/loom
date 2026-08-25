import React from 'react';
import { StyleProp, Text, TextProps, TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { type as typeTokens } from '../theme/tokens';

type Variant = keyof typeof typeTokens;

type Props = TextProps & {
  variant?: Variant;
  /** Semantic label color; defaults to the primary label. */
  tone?: 'primary' | 'secondary' | 'tertiary' | 'none';
  style?: StyleProp<TextStyle>;
};

/** Text with the design's iOS type ramp applied. */
export function AppText({ variant = 'bodyRegular', tone = 'primary', style, ...rest }: Props) {
  const { colors } = useTheme();
  const toneColor =
    tone === 'primary'
      ? colors.labelPrimary
      : tone === 'secondary'
        ? colors.labelSecondary
        : tone === 'tertiary'
          ? colors.labelTertiary
          : undefined;
  return <Text {...rest} style={[typeTokens[variant], toneColor ? { color: toneColor } : null, style]} />;
}
