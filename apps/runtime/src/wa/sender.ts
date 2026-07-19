/**
 * WhatsApp sender port (spec §3). Only the interface is fixed now — the real
 * 360dialog implementation is a Phase 4 task (`WA_SENDER=360dialog`).
 */
export interface WaSender {
  sendText(to: string, body: string): Promise<{ waMessageId: string | null }>;
}

export class MockWaSender implements WaSender {
  readonly sent: Array<{ to: string; body: string }> = [];

  sendText(to: string, body: string): Promise<{ waMessageId: string | null }> {
    this.sent.push({ to, body });
    console.log(`[wa:mock] → ${to}: ${body}`);
    return Promise.resolve({ waMessageId: null });
  }
}

export function createWaSender(kind: 'mock' | '360dialog'): WaSender {
  if (kind === '360dialog') {
    throw new Error('WA_SENDER=360dialog is not implemented yet (Phase 4) — use "mock"');
  }
  return new MockWaSender();
}
