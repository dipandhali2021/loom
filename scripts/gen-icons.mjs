import fs from 'node:fs';
import path from 'node:path';

const DIR = 'assets/icons';
// Icons drawn with a single ink color -> tokenize to currentColor so they can be themed.
const MONO = new Set([
  'menu','edit','camera','image','folder','microphone','headphones','headphones-01',
  'log-out','help-circle','file-02','lock-01','database-01','recording','globe-01','sun',
  'phone-01','mail-01','plus-square','refresh-cw','archive','book-closed','xmark',
  'recording-01','message-check','flag-06','volume-max','check','mail','mail-big','logo-dot',
  'loading-dot','apple','chevron-left','check-small','gpt35-badge','gpt4-badge',
  'temporary-chat','temporary-chat-on',
]);

const out = [];
for (const file of fs.readdirSync(DIR).sort()) {
  if (!file.endsWith('.svg')) continue;
  const name = path.basename(file, '.svg');
  let xml = fs.readFileSync(path.join(DIR, file), 'utf8').trim();
  // Preserve aspect ratio + drop web-only display styles on the root element.
  xml = xml.replace(/\s*preserveAspectRatio="none"/g, '');
  xml = xml.replace(/\s*overflow="visible"/g, '');
  xml = xml.replace(/\s*style="display: block;"/g, '');
  if (MONO.has(name)) {
    // The design tool emits a duplicate inline `style` that pins the literal color; strip it,
    // then hand the ink over to `currentColor` so the Icon component controls it.
    xml = xml.replace(/\s*style="[^"]*(?:stroke|fill)\s*:[^"]*"/g, '');
    // Every literal ink, not just black and white: the export carries a glyph in whatever
    // color the frame happened to use (`edit` came out #3C3C3C at 0.3), and leaving
    // that in place is what makes an icon invisible on a background it was not drawn
    // against. `none` is structural -- an unfilled stroke path -- so it stays.
    xml = xml.replace(/(stroke|fill)="(?!none\b|currentColor\b)[^"]*"/g, '$1="currentColor"');
    // The baked-in alpha goes with it. `color` carries its own, and multiplying the
    // two dims a themed icon for no reason anyone chose.
    xml = xml.replace(/\s*(?:stroke|fill)-opacity="[^"]*"/g, '');
  }
  xml = xml.replace(/\s*\n\s*/g, '');
  out.push([name, xml]);
}

const body = out.map(([n, x]) => `  ${JSON.stringify(n)}: ${JSON.stringify(x)},`).join('\n');
fs.writeFileSync(
  'src/assets/icons.ts',
  `// AUTO-GENERATED from the SVGs in assets/icons — do not edit by hand.\n` +
  `// Regenerate with: node scripts/gen-icons.mjs\n\n` +
  `export const ICONS = {\n${body}\n} as const;\n\n` +
  `export type IconName = keyof typeof ICONS;\n`
);
console.log('wrote src/assets/icons.ts with', out.length, 'icons');
