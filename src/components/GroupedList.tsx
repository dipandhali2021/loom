import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Icon, IconName } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../theme/tokens';

/** Uppercase section header above a grouped card (Figma 24:836). */
export function SectionHeader({ children }: { children: string }) {
  return (
    <AppText variant="sectionHeader" tone="secondary" style={styles.sectionHeader}>
      {children.toUpperCase()}
    </AppText>
  );
}

export function SectionFooter({ children }: { children: string }) {
  return (
    <AppText variant="sectionFooter" tone="secondary" style={styles.sectionFooter}>
      {children}
    </AppText>
  );
}

/** The translucent white card that groups rows on the Settings screen. */
export function GroupedCard({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.cardWrap}>
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colors.groupedCard,
            opacity: colors.groupedCardOpacity,
            borderRadius: layout.groupedCardRadius,
          },
        ]}
      />
      <View style={styles.cardInner}>{children}</View>
    </View>
  );
}

type RowProps = {
  icon: IconName;
  label: string;
  /** Right-aligned secondary value, e.g. "ChatGPT Plus". */
  value?: string;
  /** `chevron` = drill-in, `updown` = inline picker, `none` = plain row. */
  accessory?: 'chevron' | 'updown' | 'none';
  toggle?: { value: boolean; onValueChange: (next: boolean) => void };
  onPress?: () => void;
  /** Hides the hairline under the last row of a card. */
  last?: boolean;
  destructive?: boolean;
};

export function Row({
  icon,
  label,
  value,
  accessory = 'none',
  toggle,
  onPress,
  last = false,
  destructive = false,
}: RowProps) {
  const { colors } = useTheme();
  const tint = destructive ? '#FF3B30' : colors.labelPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed && onPress ? 0.55 : 1 }]}
      accessibilityRole={toggle ? 'switch' : onPress ? 'button' : 'text'}
      accessibilityLabel={value ? `${label}, ${value}` : label}
    >
      <Icon name={icon} size={20} color={tint} style={styles.rowIcon} />
      <View style={[styles.rowBody, !last && { borderBottomColor: colors.separatorOpaque, borderBottomWidth: 0.4 }]}>
        <AppText variant="bodyRegular" style={{ color: tint }}>
          {label}
        </AppText>
        <View style={styles.rowTrailing}>
          {value ? (
            <AppText variant="bodyRegular" tone="secondary">
              {value}
            </AppText>
          ) : null}
          {toggle ? (
            <Switch
              value={toggle.value}
              onValueChange={toggle.onValueChange}
              trackColor={{ true: colors.green, false: 'rgba(120,120,128,0.16)' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="rgba(120,120,128,0.16)"
            />
          ) : null}
          {accessory === 'chevron' ? (
            <Icon name="chevron-left" size={13} color={colors.labelTertiary} style={styles.chevron} />
          ) : null}
          {accessory === 'updown' ? (
            <View style={styles.updown}>
              <Icon name="chevron-left" size={11} color={colors.labelTertiary} style={styles.chevronUp} />
              <Icon name="chevron-left" size={11} color={colors.labelTertiary} style={styles.chevronDown} />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { marginLeft: 34, marginBottom: 4 },
  sectionFooter: { marginHorizontal: 34, marginTop: 8, maxWidth: 343 },
  cardWrap: { marginHorizontal: 17, borderRadius: layout.groupedCardRadius, overflow: 'hidden' },
  cardInner: { paddingLeft: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 46 },
  rowIcon: { marginRight: 0 },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingRight: 17,
  },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  // SF Symbol chevron.right, rotated from the exported left-pointing glyph.
  chevron: { transform: [{ rotate: '180deg' }] },
  updown: { width: 13, height: 20, justifyContent: 'center' },
  chevronUp: { transform: [{ rotate: '90deg' }], marginBottom: -3 },
  chevronDown: { transform: [{ rotate: '270deg' }], marginTop: -3 },
});
