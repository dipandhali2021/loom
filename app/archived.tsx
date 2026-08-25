import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../src/components/Icon';
import { AppText } from '../src/components/AppText';
import { GroupedCard, Row } from '../src/components/GroupedList';
import { useTheme } from '../src/theme/ThemeProvider';
import { useChatStore } from '../src/store/ChatStore';
import { layout } from '../src/theme/tokens';

/** Archived Chats, reached from Settings. Unarchiving returns a chat to the drawer. */
export default function ArchivedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { archivedConversations, setArchived } = useChatStore();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgSecondary, paddingTop: insets.top }]}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron-left" size={24} color={colors.labelPrimary} />
        </Pressable>
        <AppText variant="bodySemibold">Archived Chats</AppText>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {archivedConversations.length === 0 ? (
          <AppText variant="bodyRegular" tone="secondary" style={styles.empty}>
            You have no archived chats.
          </AppText>
        ) : (
          <GroupedCard>
            {archivedConversations.map((conversation, i) => (
              <Row
                key={conversation.id}
                icon="archive"
                label={conversation.title}
                accessory="chevron"
                onPress={() => setArchived(conversation.id, false)}
                last={i === archivedConversations.length - 1}
              />
            ))}
          </GroupedCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  navBar: {
    height: layout.navBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  spacer: { width: 24 },
  content: { paddingTop: 20 },
  empty: { paddingHorizontal: 34 },
});
