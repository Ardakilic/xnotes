function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseHex(input: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(input);
  if (match === null) return null;
  let hex = match[1] ?? '';
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function parseRgb(input: string): [number, number, number, number] | null {
  const match =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?)\s*)?\)$/.exec(
      input,
    );
  if (match === null) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  if ([r, g, b].some((v) => !Number.isFinite(v) || v < 0 || v > 255)) return null;
  const rawAlpha = match[4];
  const a = rawAlpha === undefined ? 1 : Number(rawAlpha);
  if (!Number.isFinite(a) || a < 0 || a > 1) return null;
  return [r, g, b, a];
}

export function isDarkBackground(cssColor: string): boolean {
  const input = cssColor.trim().toLowerCase();
  const hex = parseHex(input);
  const rgba: [number, number, number, number] | null =
    hex !== null ? [hex[0], hex[1], hex[2], 1] : parseRgb(input);
  if (rgba === null) return false;
  const [r, g, b, a] = rgba;
  // ponytail: fully transparent counts as light — nothing to measure
  if (a === 0) return false;
  const luminance = 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
  return luminance < 0.5;
}
