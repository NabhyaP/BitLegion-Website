const LOCAL_ORIGIN = 'https://bitlegion.invalid';

function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '\\' || code < 32 || code === 127) return true;
  }
  return false;
}

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  if (hasUnsafeCharacters(value)) return null;

  try {
    const decoded = decodeURIComponent(value);
    if (hasUnsafeCharacters(decoded)) return null;
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
