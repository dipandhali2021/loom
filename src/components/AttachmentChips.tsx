import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Icon } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import { palette } from '../theme/tokens';
import type { PendingAttachment } from '../store/types';

/**
 * What is attached to the turn being typed, above the composer pill.
 *
 * A photo shows itself from the local file rather than from the uploaded URL: it is
 * already on the device, so the thumbnail is there the instant it is picked instead
 * of after the pipeline finishes with it. Documents get their glyph and their name,
 * which is the only thing that distinguishes two PDFs.
 *
 * Progress is the spinner over the thumbnail, and a failure turns the tile's border
 * red and says why underneath -- the app has no toast, and this is where the file
 * the message is about to carry already is.
 */

const TILE = 56;

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  const { colors } = useTheme();
  if (attachments.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      // The tiles are the interactive part; a drag across them scrolls rather than
      // arming a remove.
      keyboardShouldPersistTaps="handled"
    >
      {attachments.map((item) => {
        const failed = item.status === 'failed';
        return (
          <View key={item.id} style={styles.item}>
            <View
              style={[
                styles.tile,
                {
                  backgroundColor: colors.fillQuaternary,
                  borderColor: failed ? palette.danger : 'transparent',
                },
              ]}
            >
              {item.kind === 'image' ? (
                <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <Icon name="file-02" size={24} color={colors.labelSecondary} />
              )}

              {/* Over the thumbnail rather than beside it: the tile is the file, and
                  its state belongs on it. */}
              {item.status === 'uploading' ? (
                <View style={[styles.veil, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              ) : null}

              <Pressable
                onPress={() => onRemove(item.id)}
                hitSlop={8}
                style={[styles.remove, { backgroundColor: colors.labelPrimary }]}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
              >
                <Feather name="x" size={11} color={colors.bgPrimary} />
              </Pressable>
            </View>

            {/* The name under the tile for a document, since its glyph says nothing
                about which file it is. A photo is its own label. */}
            {item.kind === 'document' ? (
              <AppText
                variant="caption1Regular"
                tone="tertiary"
                numberOfLines={1}
                style={styles.name}
              >
                {item.name}
              </AppText>
            ) : null}

            {failed ? (
              <AppText
                variant="caption1Regular"
                tone="none"
                numberOfLines={2}
                style={[styles.name, { color: palette.danger }]}
              >
                {item.error ?? 'Upload failed'}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingBottom: 8, paddingHorizontal: 2 },
  item: { width: TILE + 12, alignItems: 'center', gap: 2 },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: '100%', height: '100%', borderRadius: 11 },
  veil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Half off the corner, the way a removable chip is drawn everywhere: the tile is
  // only 56pt, and an inset button would cover a sixth of the photo.
  remove: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { textAlign: 'center' },
});
