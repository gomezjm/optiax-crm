/**
 * Gemini implementation of `AgentModel` via the official `@google/genai` SDK.
 * One retry on 5xx/timeout with jitter; hard 30s deadline per attempt.
 * Exercised manually only — automated tests use `FakeModel` (spec §2).
 *
 * TODO (R-phase): context caching — needs stable prompt identity plumbing.
 */
import { GoogleGenAI } from '@google/genai';
import type { AgentModel, GenerateReplyInput, GenerateReplyResult } from './types.js';

const DEADLINE_MS = 30_000;

function isRetryable(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true; // our deadline
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === 'number' && status >= 500;
  }
  return false;
}

function jitterMs(): number {
  return 250 + Math.floor(Math.random() * 500);
}

export class GeminiModel implements AgentModel {
  private readonly ai: GoogleGenAI;
  private readonly modelId: string;

  constructor(opts: { apiKey: string; modelId: string }) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.modelId = opts.modelId;
  }

  async generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
    const started = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, jitterMs()));
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), DEADLINE_MS);
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelId,
          contents: input.history.map((entry) => ({
            role: entry.role === 'user' ? 'user' : 'model',
            parts: [{ text: entry.text }],
          })),
          config: {
            systemInstruction: input.systemPrompt,
            abortSignal: controller.signal,
          },
        });

        const text = response.text;
        if (!text) throw new Error('Gemini returned an empty response');
        return {
          text,
          model: this.modelId,
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          latencyMs: Date.now() - started,
        };
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
      } finally {
        clearTimeout(deadline);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
