type Listener = (changes: Record<string, StorageChange>, areaName: string) => void;

interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

const PREFIX = 'xnotes-demo:';
const listeners = new Set<Listener>();

function emit(key: string, change: StorageChange): void {
  for (const listener of listeners) listener({ [key]: change }, 'local');
}

function read(key: string): unknown {
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

// ponytail: demo-only subset of the WebExtension API — string keys, 'local' area only
export const browser = {
  runtime: {
    id: 'demo',
    getURL: (path: string): string => path,
    sendMessage: async (): Promise<{ ok: boolean }> => ({ ok: true }),
  },
  permissions: {
    contains: async (): Promise<boolean> => true,
    request: async (): Promise<boolean> => true,
  },
  storage: {
    local: {
      async get(key: string): Promise<Record<string, unknown>> {
        const value = read(key);
        return value === undefined ? {} : { [key]: value };
      },
      async set(items: Record<string, unknown>): Promise<void> {
        for (const [key, value] of Object.entries(items)) {
          const old = read(key);
          localStorage.setItem(PREFIX + key, JSON.stringify(value));
          emit(key, old === undefined ? { newValue: value } : { oldValue: old, newValue: value });
        }
      },
      async remove(key: string): Promise<void> {
        const old = read(key);
        localStorage.removeItem(PREFIX + key);
        if (old !== undefined) emit(key, { oldValue: old });
      },
    },
    onChanged: {
      addListener(listener: Listener): void {
        listeners.add(listener);
      },
      removeListener(listener: Listener): void {
        listeners.delete(listener);
      },
    },
  },
};
