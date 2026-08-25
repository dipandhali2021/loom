/**
 * Design tokens transcribed from the ChatGPT iOS Figma template.
 * Values are the raw iOS system semantic colors the design leans on, so the
 * light/dark pairs below match Apple's own definitions where the design used them.
 */
import { Platform, TextStyle } from 'react-native';

/** The design canvas width (iPhone 15/16 Pro). All px values below are at this width. */
export const BASE_WIDTH = 393;

export const palette = {
  black: '#000000',
  white: '#FFFFFF',
  /** Accent used by the ChatGPT wordmark on the Login 1 / Login 3 variants. */
  brandBlue: '#0000F5',
  /** Voice-onboarding primary button. */
  voiceBlue: '#3F46F5',
  green: '#34C759',
  promptChipLight: '#F6F6F6',
  buttonGrayLight: '#EEEEEE',
  supportBanner: '#F5F5F5',
  buyMeACoffee: '#FFD800',
  /**
   * Form-error text. iOS system red, which clears the contrast bar on both the
   * light and the dark surface, so it needs no per-scheme variant.
   */
  danger: '#FF3B30',
} as const;

export type ColorTokens = {
  /** Base surface behind full-screen content. */
  bgPrimary: string;
  /** Grouped-list surface (Settings). */
  bgSecondary: string;
  /** Cards floating on bgSecondary. */
  groupedCard: string;
  groupedCardOpacity: number;
  labelPrimary: string;
  labelSecondary: string;
  labelTertiary: string;
  separatorNonOpaque: string;
  separatorOpaque: string;
  fillPrimary: string;
  fillQuaternary: string;
  /** Regular material (blurred nav bars). */
  materialRegular: string;
  materialTint: string;
  promptChip: string;
  composerBorder: string;
  /**
   * User turn capsule: a light, filled block in both schemes, so the turn reads
   * as the one solid surface in the transcript.
   */
  bubbleUser: string;
  /** Outline of that capsule, matching its fill so no ring shows. */
  bubbleUserBorder: string;
  /**
   * Label inside the capsule. The capsule is light in both schemes, so this is
   * dark in both and cannot follow `labelPrimary`.
   */
  bubbleUserText: string;
  /**
   * The chat type box. This is one of only two surfaces allowed to be grey in
   * dark mode; the other is a circular icon button (`sendButton`).
   */
  composerFill: string;
  /** The round submit / stop / voice button and its glyph. */
  sendButton: string;
  sendGlyph: string;
  /**
   * A fenced code block: the body surface, the header strip above it carrying the
   * language and its controls, and the hairline the "Run" pill is outlined in.
   * Its own trio rather than `fillQuaternary`, because the block is two stacked
   * surfaces and needs the header to read a step off the code behind it.
   */
  codeSurface: string;
  codeHeader: string;
  codeBorder: string;
  /** Selected row in a list (drawer history). */
  rowActive: string;
  /** Submit / send affordance. */
  accent: string;
  accentOn: string;
  green: string;
  blurTint: 'light' | 'dark';
};

export const lightColors: ColorTokens = {
  bgPrimary: '#FFFFFF',
  bgSecondary: '#F2F2F7',
  groupedCard: '#FFFFFF',
  groupedCardOpacity: 0.4,
  labelPrimary: '#000000',
  labelSecondary: 'rgba(60,60,67,0.6)',
  labelTertiary: 'rgba(60,60,60,0.3)',
  separatorNonOpaque: '#E5E5EA',
  separatorOpaque: 'rgba(60,60,67,0.36)',
  fillPrimary: 'rgba(120,120,128,0.2)',
  fillQuaternary: 'rgba(120,120,128,0.18)',
  materialRegular: 'rgba(249,249,249,0.78)',
  materialTint: 'rgba(249,249,249,0.94)',
  promptChip: palette.promptChipLight,
  composerBorder: '#E5E5EA',
  bubbleUser: '#F4F4F4',
  bubbleUserBorder: '#E5E5EA',
  bubbleUserText: '#000000',
  composerFill: '#F4F4F4',
  sendButton: '#000000',
  sendGlyph: '#FFFFFF',
  codeSurface: '#F7F7F8',
  codeHeader: '#EDEDF0',
  codeBorder: '#D8D8DE',
  rowActive: 'rgba(120,120,128,0.18)',
  accent: '#000000',
  accentOn: '#FFFFFF',
  green: palette.green,
  blurTint: 'light',
};

/**
 * Dark mode follows the shipping ChatGPT app rather than the iOS system greys:
 * every page, panel and chip sits on pure black, the user's turn is the one white
 * block in the transcript, and grey is spent on exactly two things — the chat type box (`composerFill`, and the raised cards
 * that share its value) and circular icon buttons (`sendButton`, `fillPrimary`),
 * which need one step of lift to read as a circle inside the type box.
 */
export const darkColors: ColorTokens = {
  bgPrimary: palette.black,
  bgSecondary: palette.black,
  groupedCard: '#1E1E1E',
  groupedCardOpacity: 1,
  labelPrimary: '#FFFFFF',
  labelSecondary: 'rgba(235,235,245,0.6)',
  labelTertiary: 'rgba(235,235,245,0.36)',
  separatorNonOpaque: '#2A2A2A',
  separatorOpaque: 'rgba(84,84,88,0.65)',
  fillPrimary: '#333333',
  fillQuaternary: '#1E1E1E',
  materialRegular: 'rgba(0,0,0,0.78)',
  materialTint: 'rgba(0,0,0,0.94)',
  promptChip: palette.black,
  composerBorder: '#2A2A2A',
  bubbleUser: '#FFFFFF',
  bubbleUserBorder: '#FFFFFF',
  bubbleUserText: '#000000',
  composerFill: '#1E1E1E',
  sendButton: '#333333',
  sendGlyph: '#FFFFFF',
  codeSurface: '#161616',
  codeHeader: '#242424',
  codeBorder: '#3A3A3A',
  rowActive: '#1E1E1E',
  accent: '#FFFFFF',
  accentOn: '#000000',
  green: palette.green,
  blurTint: 'dark',
};

/**
 * iOS type ramp as used by the design. `fontFamily` resolves to the platform UI
 * font: SF Pro on iOS (via `System`), Roboto on Android — the closest available
 * match, since SF Pro cannot be redistributed with the app.
 */
const systemFont = Platform.select({ ios: 'System', default: 'Roboto' });

const weight = (w: '400' | '510' | '590' | '700'): TextStyle => {
  // SF Pro's optical weights (510 = Medium, 590 = Semibold) have no direct
  // Android equivalent, so they snap to the nearest supported numeric weight.
  if (Platform.OS === 'ios') return { fontWeight: w as TextStyle['fontWeight'] };
  const map = { '400': '400', '510': '500', '590': '600', '700': '700' } as const;
  return { fontWeight: map[w] as TextStyle['fontWeight'] };
};

export const type = {
  largeTitle: { fontFamily: systemFont, fontSize: 34, lineHeight: 41, ...weight('700') },
  /** Login wordmark: SF Pro Medium 34/41, +0.4 tracking. */
  wordmark: { fontFamily: systemFont, fontSize: 34, lineHeight: 41, letterSpacing: 0.4, ...weight('510') },
  /** "Chat with voice" — Semibold 34/41, +1 tracking. */
  voiceTitle: { fontFamily: systemFont, fontSize: 34, lineHeight: 41, letterSpacing: 1, ...weight('590') },
  /** "Verify your email" — Bold 35, +0.1 tracking. */
  verifyTitle: { fontFamily: systemFont, fontSize: 35, lineHeight: 42, letterSpacing: 0.1, ...weight('700') },
  title3Bold: { fontFamily: systemFont, fontSize: 20, lineHeight: 27, letterSpacing: -0.1, ...weight('700') },
  /** "Choose a voice" — Regular 20/25. */
  title3Regular: { fontFamily: systemFont, fontSize: 20, lineHeight: 25, ...weight('400') },
  title3Semibold: { fontFamily: systemFont, fontSize: 20, lineHeight: 24, letterSpacing: 0.38, ...weight('590') },
  /** Auth buttons — Medium 20/25, -0.8 tracking. */
  authButton: { fontFamily: systemFont, fontSize: 20, lineHeight: 25, letterSpacing: -0.8, ...weight('510') },
  bodyRegular: { fontFamily: systemFont, fontSize: 17, lineHeight: 22, ...weight('400') },
  bodySemibold: { fontFamily: systemFont, fontSize: 17, lineHeight: 22, letterSpacing: -0.4, ...weight('590') },
  bodyBold: { fontFamily: systemFont, fontSize: 17, lineHeight: 22, letterSpacing: -0.4, ...weight('700') },
  /** Message body — Regular 17/27, -0.1 tracking. */
  message: { fontFamily: systemFont, fontSize: 17, lineHeight: 27, letterSpacing: -0.1, ...weight('400') },
  /**
   * Chat transcript body. A point larger than `message` with tighter leading, so
   * the text reads bigger while each turn takes less vertical room.
   */
  chatBody: { fontFamily: systemFont, fontSize: 18, lineHeight: 25, letterSpacing: -0.2, ...weight('400') },
  /**
   * Markdown headings inside a reply. Three steps are enough: a model rarely
   * goes past `###`, and deeper levels fall back to the smallest of the three
   * rather than shrinking below the body text.
   */
  chatH1: { fontFamily: systemFont, fontSize: 24, lineHeight: 31, letterSpacing: -0.4, ...weight('700') },
  chatH2: { fontFamily: systemFont, fontSize: 21, lineHeight: 27, letterSpacing: -0.3, ...weight('700') },
  chatH3: { fontFamily: systemFont, fontSize: 19, lineHeight: 25, letterSpacing: -0.2, ...weight('590') },
  /** Fenced code and inline spans in a reply — a point down, since mono runs wide. */
  chatCode: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 15,
    lineHeight: 22,
  },
  /**
   * Markdown table text. Three points down from `chatBody`: a table is the one
   * block that has to fit several columns across a phone, and body size leaves
   * room for barely two of them before it starts scrolling.
   */
  chatTable: { fontFamily: systemFont, fontSize: 15, lineHeight: 21, letterSpacing: -0.1, ...weight('400') },
  /**
   * The language name in a fenced block's header strip. UI font rather than mono:
   * it labels the block, it is not part of the code.
   */
  chatCodeLabel: { fontFamily: systemFont, fontSize: 13, lineHeight: 17, letterSpacing: -0.1, ...weight('590') },
  /** "Run" inside its pill, and any other control text in that strip. */
  chatCodeAction: { fontFamily: systemFont, fontSize: 12, lineHeight: 15, letterSpacing: -0.1, ...weight('590') },
  /** Node and edge labels inside a rendered Mermaid diagram. */
  chatDiagram: { fontFamily: systemFont, fontSize: 12, lineHeight: 15, letterSpacing: -0.1, ...weight('510') },
  /** User bubble text — matches chatBody so both sides share a baseline rhythm. */
  chatBubble: { fontFamily: systemFont, fontSize: 18, lineHeight: 25, letterSpacing: -0.2, ...weight('400') },
  /** Nav bar title, "ChatGPT 5" — Semibold 22/27, two steps up from the kit's 18. */
  navTitle: { fontFamily: systemFont, fontSize: 22, lineHeight: 27, letterSpacing: -0.4, ...weight('590') },
  /** Composer field and its "Ask anything" placeholder. */
  composer: { fontFamily: systemFont, fontSize: 18, lineHeight: 24, letterSpacing: -0.2, ...weight('400') },
  /** Starter-prompt chips — a point up from the template's callout, with tighter leading. */
  chipTitle: { fontFamily: systemFont, fontSize: 17, lineHeight: 21, letterSpacing: -0.4, ...weight('590') },
  chipBody: { fontFamily: systemFont, fontSize: 17, lineHeight: 21, letterSpacing: -0.4, ...weight('400') },
  /** Voice-onboarding item titles — Bold 17/22, -0.1 tracking. */
  itemTitle: { fontFamily: systemFont, fontSize: 17, lineHeight: 22, letterSpacing: -0.1, ...weight('700') },
  itemBody: { fontFamily: systemFont, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, ...weight('400') },
  calloutSemibold: { fontFamily: systemFont, fontSize: 16, lineHeight: 21, letterSpacing: -0.4, ...weight('590') },
  calloutRegular: { fontFamily: systemFont, fontSize: 16, lineHeight: 21, letterSpacing: -0.4, ...weight('400') },
  subheadRegular: { fontFamily: systemFont, fontSize: 15, lineHeight: 20, ...weight('400') },
  footnote: { fontFamily: systemFont, fontSize: 13, lineHeight: 18, letterSpacing: -0.4, ...weight('400') },
  /** Grouped-list section headers — 13/22, +0.2 tracking, uppercased. */
  sectionHeader: { fontFamily: systemFont, fontSize: 13, lineHeight: 22, letterSpacing: 0.2, ...weight('400') },
  sectionFooter: { fontFamily: systemFont, fontSize: 13, lineHeight: 17, letterSpacing: 0.2, ...weight('400') },
  caption1Medium: { fontFamily: systemFont, fontSize: 12, lineHeight: 16, letterSpacing: -0.4, ...weight('510') },
  caption1Regular: { fontFamily: systemFont, fontSize: 12, lineHeight: 16, letterSpacing: -0.2, ...weight('400') },
  /** Support screen uses SF Mono for wallet addresses / links. */
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 14,
    lineHeight: 24,
  },
} satisfies Record<string, TextStyle>;

/** Layout constants read straight off the Figma frames. */
export const layout = {
  navBarHeight: 44,
  /**
   * The chat screen's bar only. 50pt rather than 44 because its icons sit in
   * 42pt circles, which need the extra room to keep air above and below; the
   * plain-header screens stay on `navBarHeight`.
   */
  chatNavBarHeight: 50,
  /** Nav bar + status bar on the design's 393x852 frame. */
  designStatusBarHeight: 59,
  screenPadding: 16,
  /**
   * Chat screen gutter — 16pt on the Apps UI Kit's 390x844 frame. That frame is
   * 3pt narrower than BASE_WIDTH, under 1%, so the chat screen lays out in flex
   * against the device width rather than forking the scale factor.
   */
  chatPadding: 16,
  /** Vertical air between one turn and the next. */
  turnGap: 10,
  /** User bubble corner radius and insets. */
  bubbleRadius: 20,
  bubblePaddingH: 16,
  bubblePaddingV: 10,
  /**
   * The chat type box. `composerFieldHeight` is the one-line height of the field
   * itself; adding `composerPaddingV` twice gives the pill's 56pt height, and
   * `composerRadius` is exactly half of that so the pill stays a true capsule.
   */
  composerFieldHeight: 40,
  composerPaddingV: 8,
  composerRadius: 28,
  /** Roughly four lines of `type.composer` before the field starts scrolling. */
  composerMaxHeight: 132,
  /** Round icon buttons inside the type box. */
  sendButtonSize: 36,
  /**
   * Round grey icon buttons in the nav bar. 42pt inside the 50pt bar leaves 4pt
   * of air above and below, so the circles read as buttons without crowding it.
   */
  navIconButton: 42,
  /**
   * Standalone single-line fields, and the button directly paired with one, kept
   * level with the chat type box so every type area on the app is one height.
   */
  inputHeight: 56,
  /** Auth sheet: 301pt tall, 38pt top corners. */
  authSheetHeight: 301,
  authSheetRadius: 38,
  buttonRadius: 14,
  groupedCardRadius: 10,
  chipRadius: 14,
} as const;
