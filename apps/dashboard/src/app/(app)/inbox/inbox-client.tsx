'use client';

/**
 * Inbox client pane: conversation list (left) + selected thread (right).
 * Subscribes to Supabase Realtime postgres_changes INSERTs on `messages` for
 * the selected conversation — new agent replies appear live.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from '@optiax/shared';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { t } from '@/i18n/index';

type MessageRow = Database['public']['Tables']['messages']['Row'];

export interface ConversationListItem {
  id: string;
  waId: string;
  customerName: string | null;
  lastMessageAt: string | null;
  snippet: string;
}

const timeFormat = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatTimestamp(iso: string | null): string {
  return iso ? timeFormat.format(new Date(iso)) : '';
}

function messageText(message: MessageRow): string {
  if (message.type === 'text' && message.body) return message.body;
  const placeholder = t(
    `inbox.mediaPlaceholder.${message.type === 'text' ? 'other' : message.type}`,
  );
  return message.body ? `${placeholder} ${message.body}` : placeholder;
}

function sourceLabel(source: MessageRow['source']): string {
  return t(`inbox.source.${source}`);
}

export function InboxClient({
  conversations,
  initialConversationId,
}: {
  conversations: ConversationListItem[];
  initialConversationId: string | null;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId ?? conversations[0]?.id ?? null,
  );
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);

    void supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', selectedId)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setMessages(data);
        setLoading(false);
      });

    const channel = supabase
      .channel(`messages-${selectedId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const incoming = payload.new as MessageRow;
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, selectedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          background: '#075e54',
          color: '#ffffff',
        }}
      >
        <strong>{t('inbox.title')}</strong>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <aside
          style={{
            width: 320,
            borderRight: '1px solid #e0e0e0',
            overflowY: 'auto',
            background: '#ffffff',
          }}
        >
          {conversations.length === 0 && (
            <p style={{ padding: 16, color: '#666', fontSize: 14 }}>{t('inbox.emptyList')}</p>
          )}
          {conversations.map((conversation) => {
            const selected = conversation.id === selectedId;
            return (
              <button
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  border: 'none',
                  borderBottom: '1px solid #f0f0f0',
                  background: selected ? '#e7f5f1' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>
                    {conversation.customerName ?? t('inbox.unnamedCustomer')}
                  </strong>
                  <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
                    {formatTimestamp(conversation.lastMessageAt)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>{conversation.waId}</div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#444',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {conversation.snippet}
                </div>
              </button>
            );
          })}
        </aside>

        <section
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 16,
            overflowY: 'auto',
            background: '#efeae2',
          }}
        >
          {!selectedId && <p style={{ color: '#666' }}>{t('inbox.noneSelected')}</p>}
          {selectedId && loading && <p style={{ color: '#666' }}>{t('common.loading')}</p>}
          {selectedId && !loading && messages.length === 0 && (
            <p style={{ color: '#666' }}>{t('inbox.emptyThread')}</p>
          )}
          {messages.map((message) => {
            const fromCustomer = message.source === 'customer';
            const fromBot = message.source === 'bot';
            return (
              <div
                key={message.id}
                style={{
                  alignSelf: fromCustomer ? 'flex-start' : 'flex-end',
                  maxWidth: '70%',
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: fromCustomer ? '#ffffff' : fromBot ? '#d9fdd3' : '#fff3c4',
                  boxShadow: '0 1px 1px rgba(0,0,0,0.08)',
                }}
              >
                <div style={{ fontSize: 11, color: '#7a7a7a', marginBottom: 2 }}>
                  {sourceLabel(message.source)} · {formatTimestamp(message.created_at)}
                </div>
                <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{messageText(message)}</div>
              </div>
            );
          })}
          <div ref={threadEndRef} />
        </section>
      </div>
    </main>
  );
}
