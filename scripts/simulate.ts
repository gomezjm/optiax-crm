/**
 * POST a 360dialog webhook fixture at a local server with a valid (stub) signature.
 *
 *   pnpm simulate <fixture> [--port 8787] [--url http://...]
 *
 * <fixture> is a file name (with or without .json) from
 * packages/shared/fixtures/360dialog/, e.g. `inbound-text`.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Imported from source so the script works without a prior `pnpm build`.
import {
  signWebhookPayload,
  WEBHOOK_SIGNATURE_HEADER,
} from '../packages/shared/src/webhook-signature.js';

const FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/shared/fixtures/360dialog',
);

function parseArgs(argv: string[]): { fixture: string; url: string } {
  const args = [...argv];
  let port = 8787;
  let url: string | undefined;
  let fixture: string | undefined;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--port') {
      port = Number(args.shift());
      if (!Number.isInteger(port) || port <= 0) throw new Error('--port must be a positive integer');
    } else if (arg === '--url') {
      url = args.shift();
      if (!url) throw new Error('--url needs a value');
    } else if (arg && !arg.startsWith('-') && !fixture) {
      fixture = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!fixture) throw new Error('Usage: pnpm simulate <fixture> [--port 8787] [--url http://...]');
  return { fixture, url: url ?? `http://localhost:${port}/webhooks/wa` };
}

async function main(): Promise<void> {
  const { fixture, url } = parseArgs(process.argv.slice(2));
  const fileName = fixture.endsWith('.json') ? fixture : `${fixture}.json`;
  const filePath = resolve(FIXTURES_DIR, fileName);

  let rawBody: string;
  try {
    rawBody = await readFile(filePath, 'utf8');
  } catch {
    const available = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json'));
    console.error(`Fixture not found: ${fileName}`);
    console.error(`Available fixtures:\n  ${available.map((f) => f.replace('.json', '')).join('\n  ')}`);
    process.exit(1);
  }

  const signature = signWebhookPayload(rawBody);
  console.log(`POST ${url}  (${fileName}, ${rawBody.length} bytes)`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WEBHOOK_SIGNATURE_HEADER]: signature,
    },
    body: rawBody,
  });

  const responseText = await response.text();
  console.log(`→ ${response.status} ${response.statusText}`);
  console.log(responseText);
  process.exit(response.ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
