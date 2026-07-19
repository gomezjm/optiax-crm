'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '../../lib/supabase/browser';
import { t } from '../../i18n/index';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFailed(false);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setFailed(true);
      setSubmitting(false);
      return;
    }
    router.replace('/inbox');
    router.refresh();
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 24,
          background: '#ffffff',
          border: '1px solid #e5e5e5',
          borderRadius: 8,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>{t('common.appName')}</h1>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 400, color: '#666' }}>
          {t('login.title')}
        </h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          {t('login.emailLabel')}
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 8, border: '1px solid #d4d4d4', borderRadius: 6 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          {t('login.passwordLabel')}
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: 8, border: '1px solid #d4d4d4', borderRadius: 6 }}
          />
        </label>
        {failed && (
          <p style={{ margin: 0, color: '#b91c1c', fontSize: 13 }}>
            {t('login.invalidCredentials')}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '10px 12px',
            border: 'none',
            borderRadius: 6,
            background: '#128c7e',
            color: '#ffffff',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </main>
  );
}
