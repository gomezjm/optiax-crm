/**
 * LLM-judge (ws-r3 §2). A judge is just a model call through the same
 * provider-agnostic adapter the agent uses: it takes a rubric + transcript and
 * returns a structured {score, rationale} validated by EvalJudgementSchema.
 *
 * Determinism caveat (spec §2): judge scores vary run-to-run. The gate treats
 * them as thresholds with a margin, never exact values; rationales are logged
 * for D3's "what broke" view. No customer PII beyond the transcript itself is
 * sent.
 */
import { EvalJudgementSchema, type EvalJudgement } from '@optiax/shared';
import type { AgentModel } from '../model/types.js';

export interface JudgeTranscriptEntry {
  role: string;
  text: string;
}

const JUDGE_SYSTEM = [
  'You are a strict QA reviewer for a WhatsApp sales assistant that serves small businesses in Colombia (messages are in Spanish).',
  'You are given a RUBRIC and a TRANSCRIPT of one conversation. Score how well the assistant met the rubric.',
  'Score 1–5 where 5 = fully meets the rubric, 3 = partial, 1 = fails or violates it.',
  'Respond with ONLY a JSON object, no prose, no code fences: {"score": <1-5 integer>, "rationale": "<one or two sentences>"}.',
].join('\n');

function renderTranscript(transcript: JudgeTranscriptEntry[]): string {
  if (transcript.length === 0) return '(no assistant reply was produced)';
  return transcript
    .map((entry) => `${entry.role === 'user' ? 'CLIENTE' : 'AGENTE'}: ${entry.text}`)
    .join('\n');
}

/** Pull the first balanced JSON object out of a model reply (tolerates fences/prose). */
function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export interface JudgeResult {
  judgement: EvalJudgement;
  tokens: { input: number; output: number };
}

export async function judgeTranscript(
  model: AgentModel,
  rubric: string,
  transcript: JudgeTranscriptEntry[],
): Promise<JudgeResult> {
  const reply = await model.generateReply({
    systemPrompt: JUDGE_SYSTEM,
    history: [
      {
        role: 'user',
        text: `RUBRIC:\n${rubric}\n\nTRANSCRIPT:\n${renderTranscript(transcript)}`,
      },
    ],
  });

  const tokens = { input: reply.inputTokens, output: reply.outputTokens };
  if (reply.kind !== 'text') {
    throw new Error('judge model returned tool calls instead of a verdict');
  }

  const raw = extractJson(reply.text);
  if (!raw) throw new Error(`judge reply had no JSON object: ${reply.text.slice(0, 200)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`judge reply was not valid JSON: ${raw.slice(0, 200)}`);
  }

  const validated = EvalJudgementSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`judge verdict failed schema: ${JSON.stringify(validated.error.issues)}`);
  }
  return { judgement: validated.data, tokens };
}
