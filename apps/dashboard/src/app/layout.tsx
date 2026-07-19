import type { ReactNode } from 'react';
import { t } from '../i18n/index';
import './globals.css';

export const metadata = {
  title: t('common.appName'),
  description: t('common.appDescription'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
