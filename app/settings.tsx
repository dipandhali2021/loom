import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Icon } from '../src/components/Icon';
import { AppText } from '../src/components/AppText';
import { GroupedCard, Row, SectionFooter, SectionHeader } from '../src/components/GroupedList';
import { useTheme } from '../src/theme/ThemeProvider';
import { useChatStore } from '../src/store/ChatStore';
import { layout } from '../src/theme/tokens';

const SCHEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const;
const SCHEME_ORDER = ['system', 'light', 'dark'] as const;

/** Settings: a modal sheet of grouped rows over the secondary background. */
export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, preference, setPreference } = useTheme();
  const { email, voice, hapticsEnabled, setHapticsEnabled, signOut, archivedConversations } = useChatStore();

  const version = `${Constants.expoConfig?.version ?? '1.0.0'} (1)`;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgSecondary }]}>
      {/* Modal card stack: the two stacked rounded edges peeking above the sheet. */}
      <View style={[styles.cardStack, { paddingTop: insets.top > 0 ? 10 : 18 }]}>
        {/* The screen is black in dark mode, so the peeking edge takes the
            raised-card fill rather than the page colour it would vanish into. */}
        <View style={[styles.cardRear, { backgroundColor: colors.groupedCard }]} />
      </View>

      <View style={styles.header}>
        <AppText variant="bodySemibold">Settings</AppText>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.close, { backgroundColor: colors.fillPrimary }]}
          accessibilityRole="button"
          accessibilityLabel="Close settings"
        >
          <Icon name="xmark" size={24} color={colors.labelSecondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader>Account</SectionHeader>
        <GroupedCard>
          <Row icon="mail-01" label="Email" value={email ?? '—'} />
          <Row icon="plus-square" label="Subscription" value="Loom Plus" />
          <Row icon="refresh-cw" label="Restore purchases" onPress={() => {}} />
          <Row icon="database-01" label="Data Controls" accessory="chevron" onPress={() => {}} />
          <Row
            icon="archive"
            label="Archived Chats"
            value={archivedConversations.length ? String(archivedConversations.length) : undefined}
            accessory="chevron"
            onPress={() => router.push('/archived')}
          />
          <Row icon="book-closed" label="Custom instructions" value="On" accessory="chevron" onPress={() => {}} last />
        </GroupedCard>

        <SectionHeader>App</SectionHeader>
        <GroupedCard>
          <Row
            icon="sun"
            label="Color Scheme"
            value={SCHEME_LABEL[preference]}
            accessory="updown"
            onPress={() => {
              const next = SCHEME_ORDER[(SCHEME_ORDER.indexOf(preference) + 1) % SCHEME_ORDER.length];
              setPreference(next);
            }}
          />
          <Row
            icon="phone-01"
            label="Haptic Feedback"
            toggle={{ value: hapticsEnabled, onValueChange: setHapticsEnabled }}
            last
          />
        </GroupedCard>

        <SectionHeader>Speech</SectionHeader>
        <GroupedCard>
          <Row icon="recording" label="Voice" value={voice} accessory="chevron" onPress={() => router.push('/voice/choose')} />
          <Row icon="globe-01" label="Main Language" value="Auto-Detect" accessory="updown" onPress={() => {}} last />
        </GroupedCard>
        <SectionFooter>
          For best results, select the language you mainly speak. If it’s not listed, it may still be supported via
          auto-detection.
        </SectionFooter>

        <SectionHeader>About</SectionHeader>
        <GroupedCard>
          <Row icon="help-circle" label="Help Center" accessory="chevron" onPress={() => router.push('/support')} />
          <Row icon="file-02" label="Terms of Use" accessory="chevron" onPress={() => router.push('/terms')} />
          <Row icon="lock-01" label="Privacy Policy" accessory="chevron" onPress={() => router.push('/privacy')} />
          <Row icon="logo-dot" label="About Loom" accessory="chevron" onPress={() => router.push('/about')} />
          <Row icon="database-01" label="Version" value={version} last />
        </GroupedCard>

        <View style={styles.logoutWrap}>
          <GroupedCard>
            <Row icon="log-out" label="Logout" onPress={signOut} destructive last />
          </GroupedCard>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  cardStack: { alignItems: 'center' },
  cardRear: { width: '92%', height: 10, borderTopLeftRadius: 10, borderTopRightRadius: 10, opacity: 0.6 },
  header: {
    height: layout.navBarHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  close: { position: 'absolute', right: 20, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  content: { paddingTop: 20, gap: 8 },
  logoutWrap: { marginTop: 24 },
});
