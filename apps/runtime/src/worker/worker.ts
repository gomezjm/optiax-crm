/**
 * pgmq worker for `wa_inbound` (spec §1). Poll with a 60s visibility timeout;
 * a failed message reappears when the timeout lapses. After MAX_READS reads it
 * is archived with the error recorded on its webhook_events row — the
 * poison-message guard.
 */
import type { Json } from '@optiax/shared';
import type { RuntimeDb } from '../db/index.js';
import { processWebhookEvent, type PipelineDeps } from './pipeline.js';

export const VISIBILITY_TIMEOUT_SECONDS = 60;
export const MAX_READS = 3;
const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 1000;

function webhookEventIdOf(message: Json): string | null {
  if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
    const id = (message as Record<string, Json | undefined>)['webhook_event_id'];
    if (typeof id === 'string') return id;
  }
  return null;
}

/**
 * One poll cycle: read a batch and process each message. Returns how many
 * queue messages were handled (processed or archived). Exposed for tests and
 * reused by the long-running loop.
 */
export async function drainQueueOnce(
  deps: PipelineDeps,
  opts: { vtSeconds?: number } = {},
): Promise<number> {
  const { db, log = console.log } = deps;
  const vt = opts.vtSeconds ?? VISIBILITY_TIMEOUT_SECONDS;
  let handled = 0;

  const batch = await db.queue.read(BATCH_SIZE, vt);
  for (const queueMessage of batch) {
    const webhookEventId = webhookEventIdOf(queueMessage.message);
    if (!webhookEventId) {
      // Malformed queue payload: nothing to retry, archive immediately.
      log(`[worker] malformed queue message ${queueMessage.msgId} — archiving`);
      await db.queue.archive(queueMessage.msgId);
      handled++;
      continue;
    }

    try {
      await processWebhookEvent(deps, webhookEventId);
      await db.queue.archive(queueMessage.msgId);
      handled++;
    } catch (err) {
      const description = err instanceof Error ? err.message : String(err);
      if (queueMessage.readCt >= MAX_READS) {
        log(
          `[worker] poison message ${queueMessage.msgId} (read_ct=${queueMessage.readCt}): ${description} — archiving`,
        );
        await recordPoison(db, webhookEventId, queueMessage.readCt, description, log);
        await db.queue.archive(queueMessage.msgId);
        handled++;
      } else {
        // Leave it invisible; the visibility timeout will re-deliver it.
        log(
          `[worker] webhook_event ${webhookEventId} failed (read_ct=${queueMessage.readCt}), will retry: ${description}`,
        );
      }
    }
  }
  return handled;
}

async function recordPoison(
  db: RuntimeDb,
  webhookEventId: string,
  readCt: number,
  description: string,
  log: (message: string) => void,
): Promise<void> {
  try {
    await db.webhookEvents.markError(webhookEventId, {
      reason: 'poison_message',
      read_ct: readCt,
      error: description,
    });
  } catch (markErr) {
    // Never let bookkeeping failure keep the poison message in the queue.
    log(`[worker] failed to record poison error for ${webhookEventId}: ${String(markErr)}`);
  }
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

/** Long-running polling loop (`pnpm dev` runs it in-process with the server). */
export function startWorker(deps: PipelineDeps): WorkerHandle {
  const log = deps.log ?? console.log;
  let running = true;
  const done = (async () => {
    log('[worker] polling wa_inbound');
    while (running) {
      try {
        const handled = await drainQueueOnce(deps);
        if (handled === 0) await sleep(POLL_INTERVAL_MS);
      } catch (err) {
        // e.g. DB connection hiccup — back off and keep polling.
        log(`[worker] poll failed: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(POLL_INTERVAL_MS * 5);
      }
    }
  })();

  return {
    async stop() {
      running = false;
      await done;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
