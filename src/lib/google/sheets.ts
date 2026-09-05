/**
 * Google Sheets reads for the sheet seed.
 *
 * Read-only. Finds a spreadsheet by name in a user's Drive rather than by ID, because
 * the IDs are not written down anywhere and a name is what a person can check.
 */

import { accessToken, DRIVE, SHEETS } from './auth'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

async function get<T>(url: string, subject: string): Promise<T> {
  const token = await accessToken([DRIVE, SHEETS], subject)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${url} for ${subject}: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

export class SheetNotFound extends Error {}

export async function findSpreadsheet(subject: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and ` +
      `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
  )
  const d = await get<{ files?: { id: string; name: string }[] }>(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name)`,
    subject,
  )
  const file = d.files?.[0]
  if (!file) throw new SheetNotFound(`No spreadsheet named "${name}" in ${subject}'s Drive`)
  return file.id
}

export async function tabNames(subject: string, spreadsheetId: string): Promise<string[]> {
  const d = await get<{ sheets?: { properties: { title: string } }[] }>(
    `${SHEETS_API}/${spreadsheetId}?fields=sheets(properties(title))`,
    subject,
  )
  return (d.sheets ?? []).map((s) => s.properties.title)
}

/** Raw cell values. Ragged rows are normal — a short row means trailing blanks. */
export async function readTab(
  subject: string,
  spreadsheetId: string,
  tab: string,
  range = 'A1:R600',
): Promise<string[][]> {
  const d = await get<{ values?: string[][] }>(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${tab}!${range}`)}`,
    subject,
  )
  return d.values ?? []
}
