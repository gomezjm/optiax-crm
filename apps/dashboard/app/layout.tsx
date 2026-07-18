import type { ReactNode } from 'react';

export const metadata = {
  title: 'Optiax CRM',
  description: 'WhatsApp CRM + AI sales agent',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
