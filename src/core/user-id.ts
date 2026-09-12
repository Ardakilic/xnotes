const BANNER_ID_PATTERN = /profile_banners\/(\d+)/;
const HANDLE_SHAPE = /^[A-Za-z0-9_]{1,15}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDigits(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').trim().toLowerCase();
}

function handleFromUrlField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const segment = value.trim().replace(/\/+$/, '').split('/').pop() ?? '';
  const normalized = normalizeHandle(segment);
  return normalized === '' ? null : normalized;
}

function handleFromFields(candidate: Record<string, unknown>): string | null {
  for (const field of ['alternateName', 'additionalName', 'name']) {
    const raw = candidate[field];
    if (typeof raw === 'string' && HANDLE_SHAPE.test(raw.trim().replace(/^@/, ''))) {
      return normalizeHandle(raw);
    }
  }
  const urlHandle = handleFromUrlField(candidate['url']);
  if (urlHandle !== null) return urlHandle;
  return null;
}

function candidateIdentifier(candidate: Record<string, unknown>): string | null {
  if (isDigits(candidate['identifier'])) return candidate['identifier'];
  const mainEntity = candidate['mainEntity'];
  if (isRecord(mainEntity) && isDigits(mainEntity['identifier'])) {
    return mainEntity['identifier'];
  }
  return null;
}

function candidateHandle(candidate: Record<string, unknown>): string | null {
  const direct = handleFromFields(candidate);
  if (direct !== null) return direct;
  const mainEntity = candidate['mainEntity'];
  if (isRecord(mainEntity)) return handleFromFields(mainEntity);
  return null;
}

function candidatesFromJson(value: unknown): Record<string, unknown>[] {
  const expand = (item: Record<string, unknown>): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [item];
    const mainEntity = item['mainEntity'];
    if (isRecord(mainEntity)) out.push(mainEntity);
    else if (Array.isArray(mainEntity)) {
      for (const sub of mainEntity) {
        if (isRecord(sub)) out.push(sub);
      }
    }
    return out;
  };
  if (isRecord(value)) return expand(value);
  if (Array.isArray(value)) {
    const out: Record<string, unknown>[] = [];
    for (const item of value) {
      if (isRecord(item)) out.push(...expand(item));
    }
    return out;
  }
  return [];
}

/**
 * Parse the stable numeric X user ID from the profile page JSON-LD block
 * (`script[type="application/ld+json"]` → `mainEntity.identifier`). Accepts
 * digits-only identifiers only; accepts a candidate only when its embedded
 * handle is present and matches `urlHandle`. Handle-less candidates are
 * skipped: a stale SPA-navigated block without a handle cannot be
 * cross-checked, and mis-attributing an ID causes rename/hijack misdecisions,
 * worse than delayed coverage. Skips malformed JSON without throwing. Returns
 * `null` when nothing usable exists.
 */
export function parseJsonLdUserId(doc: Document, urlHandle: string): string | null {
  const expected = normalizeHandle(urlHandle);
  if (expected === '') return null;
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    for (const candidate of candidatesFromJson(parsed)) {
      const identifier = candidateIdentifier(candidate);
      if (identifier === null) continue;
      const embedded = candidateHandle(candidate);
      if (embedded === null || embedded !== expected) continue;
      return identifier;
    }
  }
  return null;
}

/**
 * Fallback ID read: first `/profile_banners/(\d+)/` numeric segment found in
 * page images within `[data-testid="primaryColumn"]` when that scope element
 * exists, otherwise document-wide (mid-render fallback). Banner URLs carry no
 * handle, so the cross-check is the page context itself — `urlHandle` (from
 * `parseProfile`) must be non-empty or the read is refused. Returns `null`
 * when no in-scope banner ID exists. Never throws. Residual stale-column risk
 * (stale column content after SPA navigation) is tracked in MANUAL_TESTING.md
 * §8.
 */
export function parseBannerUserId(doc: Document, urlHandle: string): string | null {
  if (normalizeHandle(urlHandle) === '') return null;
  const scope = doc.querySelector('[data-testid="primaryColumn"]');
  const root: Document | Element = scope ?? doc;
  const images = root.querySelectorAll('img[src*="profile_banners/"]');
  for (const image of images) {
    const match = BANNER_ID_PATTERN.exec(image.getAttribute('src') ?? '');
    const identifier = match === null ? undefined : match[1];
    if (isDigits(identifier)) return identifier;
  }
  return null;
}

/**
 * Ordered ID learning for the profile-page flow: JSON-LD first, then the
 * banner fallback, then unknown (`null`). Fail-soft throughout.
 */
export function learnUserId(doc: Document, urlHandle: string): string | null {
  return parseJsonLdUserId(doc, urlHandle) ?? parseBannerUserId(doc, urlHandle);
}
