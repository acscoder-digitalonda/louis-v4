import { NextResponse } from 'next/server'
import { speaker } from '~/speaker.config'

/**
 * PWA manifest (Handoff §6) — installable on a phone, which is where the Review Queue
 * actually gets used. Generated rather than static so a white-label fork picks up its
 * own wordmark without editing a JSON file.
 */
export function GET() {
  return NextResponse.json({
    name: `${speaker.wordmark} — keynote pipeline`,
    short_name: speaker.wordmark,
    description: `Deal pipeline and operations for ${speaker.speakerName}.`,
    start_url: '/',
    display: 'standalone',
    background_color: '#F6F3E9',
    theme_color: '#E24B0F',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  })
}
