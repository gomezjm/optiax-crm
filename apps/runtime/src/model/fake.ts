/**
 * Canned-reply model for all automated tests (spec §2) and for local dev
 * without a GEMINI_API_KEY. Never touches the network.
 */
import type { AgentModel, GenerateReplyInput, GenerateReplyResult } from './types.js';

export class FakeModel implements AgentModel {
  readonly calls: GenerateReplyInput[] = [];

  constructor(private readonly cannedText = 'Respuesta de prueba del agente.') {}

  generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
    this.calls.push(input);
    return Promise.resolve({
      text: this.cannedText,
      model: 'fake-model',
      inputTokens: input.history.length,
      outputTokens: 1,
      latencyMs: 0,
    });
  }
}
