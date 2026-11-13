/** Public base URL used to build absolute links (OAuth callbacks, reset links). */
export function serverBase(): string {
  const raw = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  return raw.replace(/\/+$/, '');
}