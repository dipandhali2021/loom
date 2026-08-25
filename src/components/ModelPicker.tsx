import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { ModelId } from '../store/types';
import { layout } from '../theme/tokens';

const OPTIONS: { id: ModelId; label: string; badge: 'gpt35-badge' | 'gpt4-badge' | 'openai-mark' }[] = [
  { id: 'gpt-3.5', label: 'GPT-3.5', badge: 'gpt35-badge' },
  { id: 'gpt-4', label: 'GPT-4', badge: 'gpt4-badge' },
  // The template predates GPT-5 and ships no badge for it, so the OpenAI mark
  // stands in rather than a drawn one.
  { id: 'gpt-5', label: 'GPT-5', badge: 'openai-mark' },
];

type Props = {
  visible: boolean;
  selected: ModelId;
  onSelect: (model: ModelId) => void;
  onClose: () => void;
  /** Distance from the top of the screen to the nav bar's baseline. */
  topOffset: number;
};

/**
 * The model dropdown from Figma 24:691 — a 262pt card with a check on the active
 * row and a decorative badge on the right. It hangs from the left gutter, under
 * the nav bar's title, which is where the title itself now sits.
 */
export function ModelPicker({ visible, selected, onSelect, onClose, topOffset }: Props) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close model picker">
        <View
          style={[
            styles.card,
            // The card is a raised surface, so it takes the same fill as the
            // other lifted panels rather than its own hardcoded grey.
            { top: topOffset, backgroundColor: colors.groupedCard },
          ]}
        >
          {OPTIONS.map((option, i) => (
            <Pressable
              key={option.id}
              onPress={() => {
                onSelect(option.id);
                onClose();
              }}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === option.id }}
              accessibilityLabel={option.label}
            >
              <View style={styles.check}>
                {selected === option.id ? (
                  <Icon name="check-small" size={18} color={colors.labelPrimary} />
                ) : null}
              </View>
              <AppText variant="bodyRegular" style={styles.label}>
                {option.label}
              </AppText>
              <Icon name={option.badge} size={24} />
              {i < OPTIONS.length - 1 ? (
                <View style={[styles.divider, { backgroundColor: colors.separatorNonOpaque }]} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.12)' },
  card: {
    position: 'absolute',
    // Anchored to the leading edge, so the card opens under the title it belongs to.
    left: layout.chatPadding,
    width: 262,
    borderRadius: layout.buttonRadius,
    overflow: 'hidden',
    // Figma: 0 24 64 24 rgba(0,0,0,0.08)
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  row: { height: 47, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  check: { width: 21, alignItems: 'flex-start' },
  label: { flex: 1 },
  divider: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 0.4 },
});
