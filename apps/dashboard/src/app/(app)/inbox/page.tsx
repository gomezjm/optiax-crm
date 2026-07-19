/**
 * /inbox — bare-bones inbox (spec §4). Server component: loads the
 * conversation list (RLS scopes it to the user's tenant — the anon key +
 * session is the only credential anywhere in the dashboard). The thread pane
 * and the Realtime subscription live in the client component.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { t } from '@/i18n/index';
import { InboxClient, type ConversationListItem } from './inbox-client';

type SnippetSource = {
  conversation_id: string;
  body: string | null;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'template' | 'other';
};

function snippetText(message: SnippetSource | undefined): string {
  if (!message) return t('inbox.noMessagesYet');
  if (message.type === 'text' && message.body) return message.body;
  return t(`inbox.mediaPlaceholder.${message.type === 'text' ? 'other' : message.type}`);
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { conversation: requestedConversationId } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('id, wa_id, last_message_at, customers(name)')
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw error;

  const conversationIds = conversations.map((c) => c.id);
  const latestByConversation = new Map<string, SnippetSource>();
  if (conversationIds.length > 0) {
    const { data: recentMessages, error: messagesError } = await supabase
      .from('messages')
      .select('conversation_id, body, type')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false })
      .limit(200);
    if (messagesError) throw messagesError;
    for (const message of recentMessages) {
      if (!latestByConversation.has(message.conversation_id)) {
        latestByConversation.set(message.conversation_id, message);
      }
    }
  }

  const items: ConversationListItem[] = conversations.map((conversation) => ({
    id: conversation.id,
    waId: conversation.wa_id,
    customerName: conversation.customers?.name ?? null,
    lastMessageAt: conversation.last_message_at,
    snippet: snippetText(latestByConversation.get(conversation.id)),
  }));

  const initialConversationId =
    items.find((item) => item.id === requestedConversationId)?.id ?? null;

  return <InboxClient conversations={items} initialConversationId={initialConversationId} />;
}
