/**
 * Canned-reply model for all automated tests (spec §2) and for local dev
 * without a GEMINI_API_KEY. Never touches the network.
 *
 * ws-r2 §1: takes a script of turns so a whole tool loop is testable —
 * `[toolCalls(...), toolCalls(...), text('…')]` replays in order. Once the
 * script runs out it falls back to the canned text, which keeps the loop
 * terminating even when a test under-scripts it.
 */
import type {
  AgentModel,
  GenerateReplyInput,
  GenerateReplyResult,
  ToolCall,
} from './types.js';

/** One scripted turn, minus the usage bookkeeping the fake fills in. */
export type ScriptedTurn =
  | { kind: 'text'; text: string }
  | { kind: 'tool_calls'; toolCalls: ToolCall[] };

export function textTurn(text: string): ScriptedTurn {
  return { kind: 'text', text };
}

export function toolCallTurn(...toolCalls: ToolCall[]): ScriptedTurn {
  return { kind: 'tool_calls', toolCalls };
}

export class FakeModel implements AgentModel {
  readonly calls: GenerateReplyInput[] = [];
  private readonly script: ScriptedTurn[];

  constructor(
    private readonly cannedText = 'Respuesta de prueba del agente.',
    script: ScriptedTurn[] = [],
  ) {
    this.script = [...script];
  }

  /** Turns consumed so far — lets a test assert how many rounds the loop ran. */
  get roundsRun(): number {
    return this.calls.length;
  }

  /** True when every scripted turn was used; catches over-scripted tests. */
  get scriptExhausted(): boolean {
    return this.script.length === 0;
  }

  generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
    this.calls.push(input);
    const next = this.script.shift() ?? { kind: 'text' as const, text: this.cannedText };
    return Promise.resolve({
      ...next,
      model: 'fake-model',
      inputTokens: input.history.length,
      outputTokens: 1,
      latencyMs: 0,
    });
  }
}
