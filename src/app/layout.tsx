import type { Metadata, Viewport } from 'next'
import './globals.css'
import { baseThemeCss, overridesToCss } from '@/lib/theme'
import { db } from '@/lib/data'
import { defaultThemeSettings } from '@/lib/theme'
import { speaker } from '~/speaker.config'
import { ThemeScript } from '@/components/ThemeScript'

export const metadata: Metadata = {
  title: `${speaker.wordmark} — keynote pipeline`,
  description: `Deal pipeline and operations for ${speaker.speakerName}.`,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: speaker.wordmark, statusBarStyle: 'default' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F3E9' },
    { media: '(prefers-color-scheme: dark)', color: '#131210' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Accent overrides live in Airtable and are injected at load, so an admin's hex edit
  // reaches every screen without a deploy.
  let overrides = ''
  try {
    const settings = await db().getSettings()
    overrides = overridesToCss(settings.theme ?? defaultThemeSettings)
  } catch {
    overrides = ''
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Loaded by link rather than next/font so a build never needs network access.
            The rule below assumes the Pages Router's _document, which App Router has no
            equivalent of — the stylesheet here is already global. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <style id="louis-tokens" dangerouslySetInnerHTML={{ __html: baseThemeCss() }} />
        {overrides ? (
          <style id="louis-accents" dangerouslySetInnerHTML={{ __html: overrides }} />
        ) : null}
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  )
}
