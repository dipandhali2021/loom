import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { palette } from '../theme/tokens';

/**
 * Launch Screen (Figma 36:668) — a single 27pt "Shape Animation" dot centred on
 * the frame. It carries the same treatment as the first Login variant it hands
 * off to, so the dot survives the transition into the auth stack.
 */
export function LaunchScreen() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.dot, { opacity, transform: [{ scale }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.brandBlue, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 27, height: 27, borderRadius: 13.5, backgroundColor: palette.white },
});
