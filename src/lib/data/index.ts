import { AirtableProvider } from './airtable'
import { MockProvider } from './mock'
import type { DataProvider } from './provider'

export type { DataProvider, DealFilter, DraftFilter, TaskFilter, NewRecord } from './provider'

let cached: DataProvider | null = null

/**
 * Picks the backend once per process.
 *
 * `DATA_BACKEND=mock` forces the in-memory provider; otherwise Airtable is used when
 * credentials exist and mock when they do not. A missing key is a loud console line,
 * never a silent empty screen.
 */
export function db(): DataProvider {
  if (cached) return cached
  const forced = process.env.DATA_BACKEND
  if (forced === 'mock') {
    cached = new MockProvider()
  } else {
    const airtable = AirtableProvider.fromEnv()
    if (airtable) {
      cached = airtable
    } else {
      if (forced === 'airtable') {
        throw new Error('DATA_BACKEND=airtable but AIRTABLE_API_KEY / AIRTABLE_BASE_ID are missing')
      }
      console.warn(
        '[louis] No Airtable credentials found — running on the mock provider. ' +
          'Copy .env.example to .env.local to connect the real base.',
      )
      cached = new MockProvider()
    }
  }
  return cached
}

/** Test seam. */
export function setProvider(provider: DataProvider | null): void {
  cached = provider
}
