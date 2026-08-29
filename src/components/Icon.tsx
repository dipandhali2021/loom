import React from 'react';
import { View, ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { ICONS, IconName } from '../assets/icons';

type Props = {
  name: IconName;
  /** Rendered box size in points. Icons are square in the source design. */
  size?: number;
  /** Applied to icons exported as single-ink glyphs (they use `currentColor`). */
  color?: string;
  width?: number;
  height?: number;
  style?: ViewStyle;
};

/**
 * Renders one of the SVGs in `assets/icons`. The generated module tokenizes
 * single-color glyphs to `currentColor` so `color` can theme them; multi-color
 * marks (Google, Doge, the provider avatars) ignore it and keep their own fills.
 */
export function Icon({ name, size = 24, color, width, height, style }: Props) {
  const w = width ?? size;
  const h = height ?? size;
  return (
    <View style={[{ width: w, height: h }, style]}>
      <SvgXml xml={ICONS[name]} width={w} height={h} color={color} />
    </View>
  );
}

export type { IconName };
