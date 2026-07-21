/**
 * Eval harness (ws-r3 §1). Replays a fixture's customer turns through the REAL
 * pipeline (processWebhookEvent → real R2 tool loop → real executors) against a
 * fresh in-memory EvalDb, then scores the outcome with deterministic checks and
 * the LLM-judge.
 *
 * Each customer turn is a synthesized webhook event, so the R1 guards (pause,
 * 24h window, operating hours) and the §0 round-limit handoff all run exactly as
 * they do in production — the harness asserts on what the pipeline actually did.
 */
import { randomUUID } from 'node:crypto';
import { compilePrompt } from '@optiax/shared';
import type {
  ConversationFixture,
  EvalCaseResult,
  EvalCheck,
  EvalCheckResult,
  EvalSuite,
  Json,
} from '@optiax/shared';
import type { AgentModel } from '../model/types.js';
import { toModelHistory } from '../model/history.js';
import { MockWaSender } from '../wa/sender.js';
import { processWebhookEvent } from '../worker/pipeline.js';
import { EvalDb } from './eval-db.js';
import { judgeTranscript } from './judge.js';
import type { AgentConfig } from '@optiax/shared';

const EVAL_TIMEZONE = 'America/Bogota';
const EVAL_CURRENCY = 'COP';

export interface RunFixtureInput {
  suite: EvalSuite;
  fixture: ConversationFixture;
  /** The config to compile (the tenant's draft, or the suite's reference config). */
  config: AgentConfig;
  /** Drives the conversation. FakeModel (scripted) or GeminiModel (live). */
  model: AgentModel;
  /** Runs the LLM-judge. Omit to skip judging entirely (schema-only runs). */
  judgeModel?: AgentModel;
  log?: (message: string) => void;
}

export interface RunFixtureResult {
  result: EvalCaseResult;
  /** Tool names called during each customer turn's loop (probe analysis). */
  toolCallsByTurn: string[][];
}

/** Build a 360dialog-shaped inbound webhook for one customer turn. */
function buildInboundPayload(opts: {
  phoneNumberId: string;
  from: string;
  waMessageId: string;
  body: string;
  type: 'text' | 'image';
}): Json {
  const message: Record<string, Json> =
    opts.type === 'image'
      ? {
          from: opts.from,
          id: opts.waMessageId,
          timestamp: '1752861600',
          type: 'image',
          image: { id: `media.${randomUUID()}`, mime_type: 'image/jpeg', caption: opts.body },
        }
      : {
          from: opts.from,
          id: opts.waMessageId,
          timestamp: '1752861600',
          type: 'text',
          text: { body: opts.body },
        };
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1000000000000001',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '573001112233', phone_number_id: opts.phoneNumberId },
              contacts: [{ profile: { name: 'Cliente Eval' }, wa_id: opts.from }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

/** Extract tool-call names from an agent_turns `tool_calls` jsonb value. */
function toolNamesFrom(toolCalls: Json): string[] {
  if (!Array.isArray(toolCalls)) return [];
  const names: string[] = [];
  for (const call of toolCalls) {
    if (call && typeof call === 'object' && !Array.isArray(call) && typeof call.name === 'string') {
      names.push(call.name);
    }
  }
  return names;
}

export async function runFixture(input: RunFixtureInput): Promise<RunFixtureResult> {
  const { suite, fixture, config, model, judgeModel } = input;
  const log = input.log ?? (() => {});

  const compiled = compilePrompt(config, { vertical: suite.vertical });
  const db = new EvalDb({
    vertical: suite.vertical,
    config,
    compiledPrompt: compiled.prompt,
    currency: EVAL_CURRENCY,
    timezone: EVAL_TIMEZONE,
    catalog: suite.catalog,
  });

  const waId = `57eval${fixture.id.replace(/[^0-9]/g, '').slice(0, 6).padEnd(6, '0')}`;
  const { conversationId, customerId } = db.seedConversation(waId, fixture.state ?? {});
  const ordersBefore = new Set(db.orders.map((o) => o.id));

  const sender = new MockWaSender();
  const deps = { db, model, sender, log };

  // Pre-generate a wa_message_id per turn. The outside-window scenario needs the
  // first turn's message pre-seeded as a redelivery so it does not reset the
  // window (see EvalDb.seedInboundMessage).
  const wamids = fixture.customerTurns.map(() => `wamid.eval.${randomUUID()}`);
  const stale = (fixture.state?.lastCustomerMessageAtHoursAgo ?? 0) >= 24;
  if (stale && fixture.customerTurns[0]) {
    db.seedInboundMessage(conversationId, wamids[0]!, fixture.customerTurns[0].body);
  }

  const toolCallsByTurn: string[][] = [];
  for (const [i, turn] of fixture.customerTurns.entries()) {
    const before = db.agentTurns.length;
    const payload = buildInboundPayload({
      phoneNumberId: db.phoneNumberId,
      from: waId,
      waMessageId: wamids[i]!,
      body: turn.body,
      type: turn.type ?? 'text',
    });
    const eventId = db.addEvent(payload);
    await processWebhookEvent(deps, eventId);
    const names = db.agentTurns.slice(before).flatMap((t) => toolNamesFrom(t.tool_calls ?? []));
    toolCallsByTurn.push(names);
  }

  // ── Collect outcome ────────────────────────────────────────────────────────
  const conversation = db.getConversation(conversationId);
  const customer = db.getCustomer(customerId);
  const createdOrders = db.orders.filter((o) => !ordersBefore.has(o.id));
  const allToolNames = toolCallsByTurn.flat();
  const turnErrors = db.agentTurns
    .map((t) => (t.error && typeof t.error === 'object' && !Array.isArray(t.error) ? t.error.reason : null))
    .filter((r): r is string => typeof r === 'string');

  const outcome = {
    needsAttention: conversation?.needs_attention ?? false,
    botPaused: conversation?.bot_paused ?? false,
    replySent: sender.sent.length > 0,
    toolNames: allToolNames,
    orderCount: createdOrders.length,
    orderTotal: createdOrders.reduce((sum, o) => sum + Number(o.total), 0),
    customer,
    turnErrors,
  };

  const checks = fixture.checks.map((check): EvalCheckResult => evaluateCheck(check, outcome));
  const deterministicPass = checks.every((c) => c.pass);

  // Transcript for the judge: the customer/agent messages the pipeline persisted.
  const transcript = toModelHistory(db.messages).map((e) => ({ role: e.role, text: e.text }));

  const tokens = db.agentTurns.reduce(
    (acc, t) => ({ input: acc.input + (t.input_tokens ?? 0), output: acc.output + (t.output_tokens ?? 0) }),
    { input: 0, output: 0 },
  );

  // ── LLM-judge ──────────────────────────────────────────────────────────────
  let judgement: EvalCaseResult['judgement'] = null;
  let judgePass = true;
  const runJudge = judgeModel && !fixture.skipJudge && outcome.replySent;
  if (runJudge) {
    const { judgement: verdict, tokens: judgeTokens } = await judgeTranscript(
      judgeModel,
      fixture.rubric.prompt,
      transcript,
    );
    judgement = verdict;
    judgePass = verdict.score >= fixture.rubric.threshold;
    tokens.input += judgeTokens.input;
    tokens.output += judgeTokens.output;
  }

  const result: EvalCaseResult = {
    fixtureId: fixture.id,
    title: fixture.title,
    ...(fixture.probe ? { probe: fixture.probe } : {}),
    deterministicPass,
    checks,
    judgement,
    judgePass,
    threshold: fixture.rubric.threshold,
    tokens,
    transcript,
  };
  return { result, toolCallsByTurn };
}

interface CheckOutcome {
  needsAttention: boolean;
  botPaused: boolean;
  replySent: boolean;
  toolNames: string[];
  orderCount: number;
  orderTotal: number;
  customer: { [key: string]: unknown; attributes?: unknown } | undefined;
  turnErrors: string[];
}

function fail(check: EvalCheck, detail: string): EvalCheckResult {
  return { check, pass: false, detail };
}

function ok(check: EvalCheck): EvalCheckResult {
  return { check, pass: true };
}

function evaluateCheck(check: EvalCheck, o: CheckOutcome): EvalCheckResult {
  switch (check.kind) {
    case 'needs_attention':
      return o.needsAttention === check.value ? ok(check) : fail(check, `needs_attention=${o.needsAttention}`);
    case 'bot_paused':
      return o.botPaused === check.value ? ok(check) : fail(check, `bot_paused=${o.botPaused}`);
    case 'reply_sent':
      return o.replySent === check.value ? ok(check) : fail(check, `reply_sent=${o.replySent}`);
    case 'tool_called':
      return o.toolNames.includes(check.name) ? ok(check) : fail(check, `tools=[${o.toolNames.join(',')}]`);
    case 'tool_not_called':
      return !o.toolNames.includes(check.name) ? ok(check) : fail(check, `tools=[${o.toolNames.join(',')}]`);
    case 'order_count':
      return o.orderCount === check.value ? ok(check) : fail(check, `order_count=${o.orderCount}`);
    case 'order_total':
      return o.orderTotal === check.value ? ok(check) : fail(check, `order_total=${o.orderTotal}`);
    case 'customer_field': {
      const actual = readCustomerField(o.customer, check.key);
      return actual === check.value ? ok(check) : fail(check, `${check.key}=${String(actual)}`);
    }
    case 'turn_error':
      return o.turnErrors.includes(check.reason) ? ok(check) : fail(check, `errors=[${o.turnErrors.join(',')}]`);
  }
}

/** A capture field is either a customer column (name, city…) or an attribute. */
function readCustomerField(customer: CheckOutcome['customer'], key: string): unknown {
  if (!customer) return undefined;
  if (customer[key] !== undefined && customer[key] !== null) return customer[key];
  const attributes = customer.attributes;
  if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
    return (attributes as Record<string, unknown>)[key];
  }
  return undefined;
}
