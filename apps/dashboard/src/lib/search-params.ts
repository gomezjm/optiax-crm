/**
 * Next's `searchParams` shape → `URLSearchParams`, so the filter-model parsers
 * take one plain type instead of Next's record-of-string-or-array. Repeated
 * params keep the first value: every filter in this app is single-valued.
 */
export function toSearchParams(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) params.set(key, value[0]);
  }
  return params;
}
