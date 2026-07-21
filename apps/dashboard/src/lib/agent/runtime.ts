/**
 * Client calls to the runtime's authenticated endpoints (ws-d3 §2). Sends the
 * user's Supabase access token as a Bearer; the runtime resolves the tenant from
 * the token, never from the body. Errors are normalized to a small set of codes
 * the UI maps to friendly Spanish messages.
 */
import type {
  AgentConfig,
  EvalRunResult,
  PlaygroundMessage,
  PlaygroundResponse,
  PublishResponse,
} from '@optiax/shared';
import { runtimeBaseUrl } from './env';

export type RuntimeErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'no_draft'
  | 'invalid'
  | 'server'
  | 'network';

export class RuntimeApiError extends Error {
  constructor(readonly code: RuntimeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RuntimeApiError';
  }
}

function codeForStatus(status: number): RuntimeErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 409) return 'no_draft';
  if (status === 400) return 'invalid';
  return 'server';
}

async function postJson<T>(path: string, token: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${runtimeBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    // DNS/connection/timeout — the runtime is unreachable.
    throw new RuntimeApiError('network');
  }
  if (!res.ok) throw new RuntimeApiError(codeForStatus(res.status));
  return (await res.json()) as T;
}

export function callPlayground(
  token: string,
  body: { config: AgentConfig; messages: PlaygroundMessage[]; newMessage: string },
): Promise<PlaygroundResponse> {
  return postJson<PlaygroundResponse>('/playground', token, body);
}

export function callEvaluate(token: string): Promise<EvalRunResult> {
  return postJson<EvalRunResult>('/publish/evaluate', token, {});
}

export function callPublish(token: string): Promise<PublishResponse> {
  return postJson<PublishResponse>('/publish', token, {});
}
