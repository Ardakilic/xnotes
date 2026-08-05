export async function waitForReady(
  attempt: () => Promise<void>,
  timeoutMs = 90_000,
  intervalMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = new Error('never attempted');
  while (Date.now() < deadline) {
    try {
      await attempt();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw lastError;
}

export function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing env var ${name}`);
  return value;
}
