import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icon';
import { AppText } from '../../src/components/AppText';
import { useDesignScale } from '../../src/lib/scale';
import { palette, type } from '../../src/theme/tokens';

/** Design frame height; the absolute coordinates below are relative to it. */
const FRAME_HEIGHT = 852;

/** Voice Chat > Talking (Figma 13:631). */
export default function TalkingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scale = useDesignScale();
  const [muted, setMuted] = useState(false);

  const breathe = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  // The big blob pulses; the small one drifts in a slow rotation. Both stop
  // while muted, which is what the design's Stop affordance implies.
  useEffect(() => {
    if (muted) {
      breathe.stopAnimation();
      spin.stopAnimation();
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const rotate = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }),
    );
    pulse.start();
    rotate.start();
    return () => {
      pulse.stop();
      rotate.stop();
    };
  }, [breathe, muted, spin]);

  const bigScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] });
  const smallSpin = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Design places the shapes by absolute y on an 852pt frame; on a taller or
  // shorter device the same fractions keep the composition intact.
  const y = (designY: number) => insets.top + (designY - 59) * ((FRAME_HEIGHT - 59) / FRAME_HEIGHT);

  return (
    <View style={styles.screen}>
      <Animated.View
        style={[
          styles.bigShape,
          { left: 45 * scale, top: y(223), transform: [{ scale: bigScale }] },
        ]}
      >
        <Icon name="voice-shape-big" width={331 * scale} height={323 * scale} />
      </Animated.View>

      <Animated.View
        style={[
          styles.smallShape,
          { left: 39 * scale, top: y(508), transform: [{ rotate: smallSpin }] },
        ]}
      >
        <Icon name="voice-shape-small" width={50 * scale} height={52 * scale} />
      </Animated.View>

      <Pressable
        onPress={() => router.back()}
        style={[styles.cancel, { top: y(648) }]}
        accessibilityRole="button"
        accessibilityLabel="Tap to cancel"
      >
        <AppText tone="none" style={[type.bodyRegular, styles.cancelLabel]}>
          Tap to cancel
        </AppText>
      </Pressable>

      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}>
        <Pressable
          onPress={() => setMuted((m) => !m)}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Resume listening' : 'Stop listening'}
        >
          <Icon name="voice-stop" size={73} />
        </Pressable>
        <Pressable
          onPress={() => router.dismissTo('/')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="End voice chat"
        >
          <Icon name="voice-end" size={73} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.black },
  bigShape: { position: 'absolute' },
  smallShape: { position: 'absolute' },
  cancel: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  cancelLabel: { color: palette.white },
  controls: {
    position: 'absolute',
    left: 32,
    right: 32,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
