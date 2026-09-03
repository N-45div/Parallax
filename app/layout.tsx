import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Parallax — four readings of one document',
  description:
    'A PDF says different things depending on who reads it. Parallax reads it five ways at once and treats the disagreements as evidence.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
