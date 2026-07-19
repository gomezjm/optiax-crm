/**
 * Local capture server for REAL 360dialog webhook deliveries.
 *
 *   pnpm capture                 # listens on :8788
 *   pnpm capture --port 9000
 *   VERIFY_TOKEN=xyz pnpm capture # for the Meta GET verify handshake (coexistence, later)
 *
 * Every request is logged to the console and written verbatim (all headers +
 * exact raw body) to a timestamped file under `captures/360dialog/`, so the
 * bytes are available for BOTH the fixture correction and the signature/auth
 * scheme analysis. `captures/` is gitignored (payloads carry phone numbers).
 *
 * Usage (full steps in docs/runbooks/capture-360dialog-webhook.md):
 *   1. pnpm capture
 *   2. cloudflared tunnel --url http://localhost:8788   (or: ngrok http 8788)
 *   3. Register <tunnel-url>/webhooks/wa as your 360dialog webhook.
 *   4. Trigger events; paste the captured JSON back to the coordinator.
 *
 * Zero external deps on purpose (Node built-ins only) — matches the repo's
 * "no heavy deps" rule and runs via tsx like the other scripts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../captures/360dialog');

// Headers worth surfacing on the console so you can eyeball the transport/auth
// scheme without opening the file. Add candidates 360dialog might use.
const INTERESTING_HEADERS = [
  'content-type',
  'user-agent',
  'authorization',
  'd360-api-key',
  'x-hub-signature',
  'x-hub-signature-256',
  'x-webhook-signature',
  'x-360dialog-signature',
  'x-360-signature',
] as const;

interface Args {
  port: number;
  verifyToken: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const args = [...argv];
  let port = Number(process.env.PORT ?? 8788);
  let verifyToken = process.env.VERIFY_TOKEN;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--port') {
      port = Number(args.shift());
      if (!Number.isInteger(port) || port <= 0) throw new Error('--port must be a positive integer');
    } else if (arg === '--verify-token') {
      verifyToken = args.shift();
      if (!verifyToken) throw new Error('--verify-token needs a value');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { port, verifyToken };
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

function timestampSlug(d: Date): string {
  const p = (n: number, width = 2): string => String(n).padStart(width, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `-${p(d.getMilliseconds(), 3)}`
  );
}

/** Best-effort read of entry[0].changes[0].field for a quick console readout. No `any`. */
function firstChangeField(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const entry = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const first = entry[0];
  if (typeof first !== 'object' || first === null) return null;
  const changes = (first as { changes?: unknown }).changes;
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const change = changes[0];
  if (typeof change !== 'object' || change === null) return null;
  const field = (change as { field?: unknown }).field;
  return typeof field === 'string' ? field : null;
}

let seq = 0;

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  verifyToken: string | undefined,
): Promise<void> {
  const now = new Date();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  // Meta-style GET verification handshake — unused by the 360dialog On-Premise
  // sandbox, but lets the SAME endpoint be reused for a Cloud API / coexistence
  // webhook later. Harmless otherwise.
  if (method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const challenge = url.searchParams.get('hub.challenge');
    const token = url.searchParams.get('hub.verify_token');
    if (mode === 'subscribe' && challenge !== null && (verifyToken === undefined || token === verifyToken)) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(challenge);
      console.log(`[${now.toISOString()}] GET verify → echoed hub.challenge`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('capture server up');
    return;
  }

  const bodyRaw = await readRawBody(req);
  let bodyJson: unknown = null;
  try {
    bodyJson = bodyRaw.length > 0 ? JSON.parse(bodyRaw) : null;
  } catch {
    bodyJson = null; // keep bodyRaw; not all deliveries are JSON
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(', ') : (value ?? '');
  }

  seq += 1;
  const record = {
    receivedAt: now.toISOString(),
    method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers,
    bodyRaw,
    bodyJson,
  };

  const file = resolve(OUT_DIR, `${timestampSlug(now)}-${String(seq).padStart(3, '0')}.json`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  // Respond fast so 360dialog marks it delivered and doesn't retry.
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"status":"captured"}');

  const field = firstChangeField(bodyJson);
  console.log(
    `\n[${now.toISOString()}] ${method} ${url.pathname}` +
      `${field !== null ? `  field=${field}` : ''}  (${bodyRaw.length} bytes)`,
  );
  for (const name of INTERESTING_HEADERS) {
    if (headers[name] !== undefined) console.log(`   ${name}: ${headers[name]}`);
  }
  console.log(`   → ${file}`);
}

async function main(): Promise<void> {
  const { port, verifyToken } = parseArgs(process.argv.slice(2));
  await mkdir(OUT_DIR, { recursive: true });

  const server = createServer((req, res) => {
    handle(req, res, verifyToken).catch((err: unknown) => {
      console.error('capture error:', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.listen(port, () => {
    console.log(`360dialog webhook capture listening on http://localhost:${port}`);
    console.log(`Writing captures to ${OUT_DIR}`);
    console.log('Next: tunnel this port, then register <tunnel-url>/webhooks/wa as your webhook.');
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
