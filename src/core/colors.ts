export type ColorKey =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'teal'
  | 'lime'
  | 'brown'
  | 'indigo';

export const COLOR_KEYS: readonly ColorKey[] = [
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
];

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
