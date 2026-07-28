import { Cormorant_Garamond, Manrope } from 'next/font/google';

export const displayFont = Cormorant_Garamond({
  display: 'swap',
  fallback: ['Georgia', 'serif'],
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600'],
});

export const uiFont = Manrope({
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
  subsets: ['latin'],
  variable: '--font-ui',
  weight: ['400', '500', '600', '700'],
});
