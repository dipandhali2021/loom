import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { hueOf, initialOf, iconSlug, loadIcon } from '../lib/modelIcon';

/**
 * The little brand mark beside a model's name.
 *
 * Two states, and the fallback is the important one: a provider lobehub has no icon
 * for, a device that has never been online, and a mark still in flight all render as
 * a lettered circle rather than as a gap. Rows then line up whatever happened to the
 * network, which is what keeps a list of models from reflowing as icons land.
 *
 * The circle follows `Favicon`'s treatment on purpose -- one visual idea for "a mark
 * we could not fetch", rather than a second one invented here.
 */

type Props = {
  /** The model id, which is what the slug is derived from. */
  modelId: string;
  /** Used for the fallback letter; the id is often less recognisable. */
  label: string;
  size?: number;
};

export function ProviderMark({ modelId, label, size = 22 }: Props) {
  const [xml, setXml] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    // Never rejects; see loadIcon. An empty string means "no mark exists".
    void loadIcon(modelId).then((source) => {
      if (alive) setXml(source);
    });
    return () => {
      alive = false;
    };
  }, [modelId]);

  if (xml) {
    /*
     * width/height override whatever the file declares, which is how one set of
     * marks drawn at different intrinsic sizes ends up optically equal in a row.
     */
    return <SvgXml xml={xml} width={size} height={size} />;
  }

  const hue = hueOf(iconSlug(modelId) || label);

  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `hsl(${hue}, 44%, 42%)`,
        },
      ]}
    >
      {/* Sized off the circle, so the same component works at 20pt in a control
          row and at 28pt in the sheet without the letter overflowing either. */}
      <Text
        style={[styles.letter, { fontSize: Math.round(size * 0.52), lineHeight: size }]}
        allowFontScaling={false}
      >
        {initialOf(label)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // White on a mid-lightness hue clears contrast at every hue in the ramp, which is
  // why lightness is fixed rather than derived alongside it.
  letter: { color: '#FFFFFF', fontWeight: '700', textAlign: 'center' },
});
