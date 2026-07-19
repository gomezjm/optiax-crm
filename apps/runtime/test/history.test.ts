import { describe, expect, it } from 'vitest';
import { toModelHistory } from '../src/model/history.js';
import type { MessageRow } from '../src/db/index.js';

let counter = 0;
function msg(partial: Partial<MessageRow>): MessageRow {
  counter++;
  return {
    id: `id-${counter}`,
    created_at: new Date(1752861600000 + counter * 1000).toISOString(),
    tenant_id: 'tenant-1',
    conversation_id: 'conv-1',
    wa_message_id: `wamid.${counter}`,
    direction: 'inbound',
    source: 'customer',
    type: 'text',
    body: 'hola',
    media_path: null,
    template_name: null,
    campaign_id: null,
    wa_status: null,
    error: null,
    ...partial,
  };
}

describe('toModelHistory (spec §2 mapping)', () => {
  it('maps customer to user and bot/owner_app/dashboard to assistant', () => {
    const history = toModelHistory([
      msg({ source: 'customer', body: 'hola' }),
      msg({ source: 'bot', direction: 'outbound', body: 'buenas' }),
      msg({ source: 'owner_app', direction: 'outbound', body: 'soy la dueña' }),
      msg({ source: 'dashboard', direction: 'outbound', body: 'desde el panel' }),
    ]);
    expect(history.map((h) => h.role)).toEqual(['user', 'assistant', 'assistant', 'assistant']);
  });

  it('skips system messages', () => {
    const history = toModelHistory([
      msg({ source: 'system', body: 'Pedido creado' }),
      msg({ body: 'hola' }),
    ]);
    expect(history).toHaveLength(1);
    expect(history[0]?.text).toBe('hola');
  });

  it('replaces non-text messages with placeholder lines', () => {
    const history = toModelHistory([
      msg({ type: 'image', body: null }),
      msg({ type: 'image', body: 'el comprobante' }),
      msg({ type: 'audio', body: null }),
    ]);
    expect(history.map((h) => h.text)).toEqual([
      '[imagen]',
      '[imagen] el comprobante',
      '[audio]',
    ]);
  });

  it('drops text messages with no body', () => {
    expect(toModelHistory([msg({ body: null })])).toEqual([]);
  });
});
