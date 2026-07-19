/**
 * Provider-agnostic model interface (spec §2). The rest of the runtime never
 * sees Gemini payload shapes — only this.
 */
export interface ModelHistoryEntry {
  role: 'user' | 'assistant';
  text: string;
}

export interface GenerateReplyInput {
  systemPrompt: string;
  history: ModelHistoryEntry[];
}

export interface GenerateReplyResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AgentModel {
  generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult>;
}
