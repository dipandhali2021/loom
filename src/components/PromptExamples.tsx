import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { layout } from '../theme/tokens';

export type PromptExample = { title: string; subtitle: string };

/** The two starter prompts shown above the composer on an empty chat (Figma 1:357). */
export const DEFAULT_PROMPTS: PromptExample[] = [
  { title: 'Design a database schema', subtitle: 'for an online merch store' },
  { title: 'Explain airplain', subtitle: 'to someone 5 years old' },
];

type Props = {
  prompts?: PromptExample[];
  onSelect: (prompt: PromptExample) => void;
};

export function PromptExamples({ prompts = DEFAULT_PROMPTS, onSelect }: Props) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.track}
      // The design lets the row run past the right edge, hinting at more chips.
      style={styles.scroll}
    >
      {prompts.map((prompt) => (
        <Pressable
          key={prompt.title}
          onPress={() => onSelect(prompt)}
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: colors.promptChip,
              borderColor: colors.composerBorder,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${prompt.title} ${prompt.subtitle}`}
        >
          <AppText variant="chipTitle">{prompt.title}</AppText>
          <AppText variant="chipBody" tone="secondary">
            {prompt.subtitle}
          </AppText>
        </Pressable>
      ))}
      <View style={styles.tail} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  track: { paddingHorizontal: layout.chatPadding, gap: 10, alignItems: 'flex-start' },
  // Tighter than the original template's 13pt so the chips read as one compact row.
  // The fill matches the page, so the outline is what makes each chip tappable.
  chip: {
    borderRadius: layout.chipRadius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tail: { width: 4 },
});
