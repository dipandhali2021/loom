import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { Diagram, LaidOutNode, layoutMermaid, parseMermaid, wrapLabel } from '../lib/mermaid';
import { type } from '../theme/tokens';

/** Stroke weight of a node's outline, and of a normal edge. */
const NODE_STROKE = 1.4;
const EDGE_STROKE = 1.3;
const THICK_STROKE = 2.6;
/** Arrowhead: length along the line, and half-width across it. */
const HEAD = 8;
const HEAD_HALF = 3.6;
/** Corner radius of a rounded node, and the inset of a hexagon's angled sides. */
const ROUND = 9;
const HEX_INSET = 10;

/**
 * The outline of one node.
 *
 * `Polygon` for the shapes that have no primitive, and the primitives themselves
 * for the ones that do -- a rect drawn as a polygon loses `rx`, and a circle drawn
 * as one is only ever an approximation of the curve.
 */
function NodeShape({ node, fill, stroke }: { node: LaidOutNode; fill: string; stroke: string }) {
  const { x, y, width: w, height: h } = node;
  const common = { fill, stroke, strokeWidth: NODE_STROKE };

  switch (node.shape) {
    case 'circle':
      return <Circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} {...common} />;
    case 'stadium':
      // Radius is half the height, which is what makes the ends true semicircles.
      return <Rect x={x} y={y} width={w} height={h} rx={h / 2} ry={h / 2} {...common} />;
    case 'round':
      return <Rect x={x} y={y} width={w} height={h} rx={ROUND} ry={ROUND} {...common} />;
    case 'diamond':
      return (
        <Polygon
          points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
          {...common}
        />
      );
    case 'hexagon':
      return (
        <Polygon
          points={[
            `${x + HEX_INSET},${y}`,
            `${x + w - HEX_INSET},${y}`,
            `${x + w},${y + h / 2}`,
            `${x + w - HEX_INSET},${y + h}`,
            `${x + HEX_INSET},${y + h}`,
            `${x},${y + h / 2}`,
          ].join(' ')}
          {...common}
        />
      );
    default:
      return <Rect x={x} y={y} width={w} height={h} rx={4} ry={4} {...common} />;
  }
}

/**
 * A filled triangle at the end of an edge, pointing along it.
 *
 * Drawn rather than attached as a marker: `react-native-svg` supports SVG markers
 * unevenly across platforms, and a triangle is three points either way.
 */
function ArrowHead({ from, to, color }: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // Back along the line for the base, then out to both sides of it.
  const bx = to.x - ux * HEAD;
  const by = to.y - uy * HEAD;
  return (
    <Polygon
      points={[
        `${to.x},${to.y}`,
        `${bx - uy * HEAD_HALF},${by + ux * HEAD_HALF}`,
        `${bx + uy * HEAD_HALF},${by - ux * HEAD_HALF}`,
      ].join(' ')}
      fill={color}
    />
  );
}

/**
 * The labels, as real `Text` on top of the SVG.
 *
 * SVG `<Text>` is available, but it cannot wrap, has no access to the app's type
 * ramp, and is not selectable. Absolutely-positioned RN text over the drawing
 * gives all three, and the layout already knows every box's centre -- so the text
 * lands on the shape without either half having to measure the other.
 */
function Labels({ diagram, color, dim, chip }: {
  diagram: Diagram;
  color: string;
  dim: string;
  chip: string;
}) {
  return (
    <>
      {diagram.nodes.map((node) => (
        <View
          key={node.id}
          // Centred on the box rather than filling it: a diamond's usable width is
          // narrower than its bounding box, and centred text is unaffected by that.
          style={[styles.label, { left: node.x, top: node.y, width: node.width, height: node.height }]}
          pointerEvents="none"
        >
          <Text style={[type.chatDiagram, styles.labelText, { color }]} numberOfLines={3}>
            {wrapLabel(node.label).join('\n')}
          </Text>
        </View>
      ))}

      {diagram.edges.map((edge, index) =>
        edge.label ? (
          <View
            key={`${edge.from}-${edge.to}-${index}`}
            /*
             * Sits on the line's midpoint, carrying the diagram's own background as
             * a fill so the edge appears to pass behind the text instead of
             * through it -- which is how Mermaid draws it, and the reason the label
             * needs a width to centre against.
             */
            style={[
              styles.edgeLabel,
              {
                left: edge.labelX - edge.labelWidth / 2,
                top: edge.labelY - 8,
                width: edge.labelWidth,
                backgroundColor: chip,
              },
            ]}
            pointerEvents="none"
          >
            <Text style={[type.chatDiagram, styles.labelText, { color: dim }]} numberOfLines={1}>
              {edge.label}
            </Text>
          </View>
        ) : null,
      )}
    </>
  );
}

/**
 * The laid-out diagram for a Mermaid source, or `null` when there is nothing worth
 * drawing.
 *
 * A hook rather than something `MermaidView` does internally, so the caller can
 * decide the fallback: a sequence diagram, a Gantt chart and the first few frames
 * of a flowchart that is still arriving all come back `null`, and for every one of
 * them showing the fence as code is more honest than a wrong picture. Doing it
 * this way also keeps the parse to once per source rather than once per attempt.
 */
export function useDiagram(source: string | null): Diagram | null {
  return useMemo(() => {
    if (source === null) return null;
    const parsed = parseMermaid(source);
    if (!parsed.ok) return null;
    // One node and no edges is a fence that has barely started; the source reads
    // better than a lone box would.
    if (parsed.nodes.length < 2 && parsed.edges.length === 0) return null;
    return layoutMermaid(parsed);
  }, [source]);
}

/**
 * Draws a laid-out flowchart.
 *
 * Scrolls sideways when the chart is wider than the transcript. It is never scaled
 * down to fit: a flowchart shrunk to a phone's width is unreadable, and panning is
 * how the app treats a wide table already.
 */
export function MermaidView({ diagram }: { diagram: Diagram }) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      directionalLockEnabled
      contentContainerStyle={styles.scroll}
    >
      <View style={{ width: diagram.width, height: diagram.height }}>
        <Svg width={diagram.width} height={diagram.height}>
          {diagram.edges.map((edge, index) => {
            const [from, to] = edge.points;
            const width = edge.stroke === 'thick' ? THICK_STROKE : EDGE_STROKE;
            return (
              <React.Fragment key={`${edge.from}-${edge.to}-${index}`}>
                <Line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={colors.labelSecondary}
                  strokeWidth={width}
                  strokeLinecap="round"
                  // Mermaid's own dotted edge: a short dash with an equal gap.
                  strokeDasharray={edge.stroke === 'dotted' ? '4 4' : undefined}
                />
                {edge.arrow ? <ArrowHead from={from} to={to} color={colors.labelSecondary} /> : null}
              </React.Fragment>
            );
          })}

          {diagram.nodes.map((node) => (
            <NodeShape key={node.id} node={node} fill={colors.codeHeader} stroke={colors.codeBorder} />
          ))}
        </Svg>

        <Labels
          diagram={diagram}
          color={colors.labelPrimary}
          dim={colors.labelSecondary}
          chip={colors.codeSurface}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Centres a narrow chart and lets a wide one run past the edge.
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 4 },
  label: { position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  edgeLabel: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderRadius: 3 },
  labelText: { textAlign: 'center' },
});
