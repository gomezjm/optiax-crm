/**
 * Send an arbitrary customer message to the local runtime as a signed
 * 360dialog webhook (ws-r2). `simulate.ts` posts fixtures verbatim, which is
 * what you want for replaying captured payloads; this is for driving a real
 * conversation with the agent, where the words change every turn.
 *
 *   pnpm say "¿Cuánto cuesta la blusa de lino?"
 *   pnpm say "Quiero dos" --wa 573015559990 --name "Camila Ríos"
 *
 * Imported from source so it works without a prior `pnpm build`, same as
 * simulate.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signWebhookPayload,
  WEBHOOK_SIGNATURE_HEADER,
} from '../packages/shared/src/webhook-signature.js';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/shared/fixtures/360dialog/inbound-text.json',
);

const argv = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const text = argv[0];
if (!text || text.startsWith('--')) {
  console.error('Usage: pnpm say "<message>" [--wa <wa_id>] [--name <profile name>] [--port 8787]');
  process.exit(1);
}

const waId = flag('--wa') ?? '573015559990';
const profileName = flag('--name') ?? 'Camila Ríos';
const port = Number(flag('--port') ?? 8787);

interface TextWebhook {
  entry: {
    changes: {
      value: {
        contacts: { profile: { name: string }; wa_id: string }[];
        messages: { from: string; id: string; text: { body: string }; timestamp: string }[];
      };
    }[];
  }[];
}

const payload = JSON.parse(readFileSync(FIXTURE, 'utf8')) as TextWebhook;
const value = payload.entry[0]!.changes[0]!.value;
value.contacts[0]!.wa_id = waId;
value.contacts[0]!.profile.name = profileName;

const message = value.messages[0]!;
message.from = waId;
// Unique per send, or the pipeline's wa_message_id dedupe swallows the turn.
message.id = `wamid.demo.${Date.now()}`;
message.text.body = text;
message.timestamp = String(Math.floor(Date.now() / 1000));

async function main(): Promise<void> {
  const rawBody = JSON.stringify(payload);
  const res = await fetch(`http://localhost:${port}/webhooks/wa`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(rawBody),
    },
    body: rawBody,
  });
  console.log(`→ ${waId}: "${text}"  [${res.status}] ${await res.text()}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
