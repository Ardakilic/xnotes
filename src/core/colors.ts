export const COLOR_KEYS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'teal',
  'lime',
  'brown',
  'indigo',
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABELS: Record<ColorKey, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  teal: 'Teal',
  lime: 'Lime',
  brown: 'Brown',
  indigo: 'Indigo',
};

export function isColorKey(value: unknown): value is ColorKey {
  return typeof value === 'string' && (COLOR_KEYS as readonly string[]).includes(value);
}
