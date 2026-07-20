/**
 * Gemini implementation of `AgentModel` via the official `@google/genai` SDK.
 * One retry on 5xx/timeout with jitter; hard 30s deadline per attempt.
 * Exercised manually only — automated tests use `FakeModel` (spec §2).
 *
 * ws-r2 §1 adds function calling: declarations map to Gemini `functionDeclarations`,
 * and completed tool rounds replay as the `functionCall`/`functionResponse`
 * content pairs Gemini expects, so round N+1 sees what round N did.
 *
 * TODO (R-phase): context caching — needs stable prompt identity plumbing.
 */
import { GoogleGenAI, Type, type Content, type FunctionDeclaration, type Part, type Schema } from '@google/genai';
import type { Json } from '@optiax/shared';
import type {
  AgentModel,
  GenerateReplyInput,
  GenerateReplyResult,
  JsonSchemaNode,
  ToolCall,
  ToolDeclaration,
} from './types.js';

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

/**
 * Our declarations use lowercase JSON-Schema type names; the SDK wants its own
 * uppercase `Type` enum. Mapped explicitly rather than cast, so an unsupported
 * node kind is a compile error here instead of a 400 from the API.
 */
const SCHEMA_TYPES: Record<JsonSchemaNode['type'], Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

function toGeminiSchema(node: JsonSchemaNode): Schema {
  const schema: Schema = { type: SCHEMA_TYPES[node.type] };
  if (node.description !== undefined) schema.description = node.description;
  if (node.enum !== undefined) schema.enum = [...node.enum];
  if (node.items !== undefined) schema.items = toGeminiSchema(node.items);
  if (node.properties !== undefined) {
    schema.properties = Object.fromEntries(
      Object.entries(node.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  if (node.required !== undefined) schema.required = [...node.required];
  return schema;
}

function toFunctionDeclarations(tools: ToolDeclaration[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.parameters),
  }));
}

/**
 * Replay the conversation Gemini needs to see: the customer/agent history,
 * then for each completed tool round the model's own functionCall parts
 * followed by the functionResponse parts carrying our results.
 */
function buildContents(input: GenerateReplyInput): Content[] {
  const contents: Content[] = input.history.map((entry) => ({
    role: entry.role === 'user' ? 'user' : 'model',
    parts: [{ text: entry.text }],
  }));

  for (const turn of input.toolTurns ?? []) {
    contents.push({
      role: 'model',
      parts: turn.calls.map(
        (call): Part => ({
          functionCall: { name: call.name, args: (call.args ?? {}) as Record<string, unknown> },
        }),
      ),
    });
    contents.push({
      role: 'user',
      parts: turn.results.map(
        (result): Part => ({
          functionResponse: {
            name: result.name,
            // Gemini requires an object here; our results are objects already,
            // but a defensive wrap keeps a scalar from breaking the call.
            response:
              result.result !== null && typeof result.result === 'object'
                ? (result.result as Record<string, unknown>)
                : { value: result.result },
          },
        }),
      ),
    });
  }

  return contents;
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
    const tools = input.tools ?? [];

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, jitterMs()));
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), DEADLINE_MS);
      try {
        const response = await this.ai.models.generateContent({
          model: this.modelId,
          contents: buildContents(input),
          config: {
            systemInstruction: input.systemPrompt,
            abortSignal: controller.signal,
            ...(tools.length > 0
              ? { tools: [{ functionDeclarations: toFunctionDeclarations(tools) }] }
              : {}),
          },
        });

        const usage = {
          model: this.modelId,
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          latencyMs: Date.now() - started,
        };

        // Tool calls win over any prose in the same response: text written
        // before the tool ran may contradict what the tool returns.
        const calls = response.functionCalls ?? [];
        if (calls.length > 0) {
          const toolCalls: ToolCall[] = calls.map((call) => ({
            name: call.name ?? '',
            args: (call.args ?? {}) as Json,
          }));
          return { kind: 'tool_calls', toolCalls, ...usage };
        }

        const text = response.text;
        if (!text) throw new Error('Gemini returned an empty response');
        return { kind: 'text', text, ...usage };
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
