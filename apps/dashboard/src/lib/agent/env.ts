/**
 * Runtime base URL for the Playground / Publish calls (ws-d3 §2). The literal
 * `process.env.NEXT_PUBLIC_…` reference is required for Next.js build-time
 * inlining — don't refactor into a dynamic lookup.
 */
export function runtimeBaseUrl(): string {
  return process.env.NEXT_PUBLIC_RUNTIME_URL ?? 'http://localhost:8787';
}
