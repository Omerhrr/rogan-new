/**
 * Rogan Live v3 — Root Layout
 * Dark theme, Geist fonts, metadata.
 */

import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rogan Live — Stream. Earn. Connect.',
  description: 'The live streaming economy platform. Go live, earn TK, send gifts, and build your creator empire.',
  icons: { icon: '/logo.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0A0A0A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased bg-surface-dark text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
