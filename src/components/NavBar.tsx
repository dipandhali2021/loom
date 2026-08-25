import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../theme/tokens';

type Props = {
  /** Model label shown after the "ChatGPT" wordmark, e.g. "4". */
  modelBadge?: string;
  onPressMenu?: () => void;
  onPressEdit?: () => void;
  onPressTitle?: () => void;
  onPressMore?: () => void;
};

/**
 * One nav icon's hit target. The grey circle it used to carry now belongs to the
 * `Group` around it -- the bar is transparent, so a filled shape is what keeps
 * the icons legible over transcript text moving underneath, and the compose and
 * overflow pair share one so they read as a single control.
 */
function IconButton({
  onPress,
  label,
  children,
}: {
  onPress?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

/**
 * The filled capsule the icons sit in. One child gives a circle, two give the pill
 * the design draws around compose + overflow; either way the radius is half the
 * height, so the shape follows from how many buttons it holds.
 */
function Group({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.group, { backgroundColor: colors.fillPrimary }]}>{children}</View>;
}

/**
 * Chat nav bar in the shipping app's arrangement: hamburger on the left with
 * "ChatGPT <model> ›" sitting directly beside it, and the compose + overflow
 * pair on the right. The icons are 42pt, which is what pushes the bar to
 * `chatNavBarHeight`'s 50.
 *
 * The bar has no background of its own -- the transcript runs full-screen beneath
 * it and dissolves into `TopFade`'s gradient, which is what the screen composes
 * behind this. Only the icon groups are filled.
 */
export function NavBar({ modelBadge = '4', onPressMenu, onPressEdit, onPressTitle, onPressMore }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.row, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        {/* Menu and title travel together on the left, as one leading group. */}
        <View style={styles.leading}>
          <Group>
            <IconButton onPress={onPressMenu} label="Open chat history">
              <Icon name="menu" size={25} color={colors.labelPrimary} />
            </IconButton>
          </Group>

          <Pressable
            onPress={onPressTitle}
            hitSlop={10}
            style={styles.title}
            accessibilityRole="button"
            accessibilityLabel={`ChatGPT ${modelBadge}, change model`}
          >
            {/* The app draws the wordmark at full strength and the model number
                a step back, so the pair reads as one label with a qualifier. */}
            <AppText variant="navTitle">ChatGPT</AppText>
            <AppText variant="navTitle" tone="secondary" style={styles.badge}>
              {modelBadge}
            </AppText>
            <Icon name="chevron-left" size={15} color={colors.labelSecondary} style={styles.chevron} />
          </Pressable>
        </View>

        {/* Compose and overflow share one pill, as the app draws them. */}
        <Group>
          <IconButton onPress={onPressEdit} label="New chat">
            <Icon name="edit" size={22} color={colors.labelPrimary} />
          </IconButton>
          <IconButton onPress={onPressMore} label="More options">
            <Feather name="more-horizontal" size={22} color={colors.labelPrimary} />
          </IconButton>
        </Group>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: '100%' },
  bar: {
    height: layout.chatNavBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.chatPadding,
  },
  // Square, so a lone button's group comes out a circle. The fill lives on the
  // group; this is only the hit target.
  iconButton: {
    width: layout.navIconButton,
    height: layout.navIconButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    height: layout.navIconButton,
    // Half the height, so one 42pt child rounds to a circle and two round to a pill.
    borderRadius: layout.navIconButton / 2,
  },
  // 12pt between the hamburger's circle and the wordmark: the circle carries its
  // own padding, so the old 14pt gap read as too much air.
  leading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // The model number carries its own gap, so the chevron sits tight after it.
  badge: { marginRight: 1 },
  // The design uses SF Symbol `chevron.right`; the exported glyph points left,
  // so it is rotated to match.
  chevron: { transform: [{ rotate: '180deg' }] },
});
