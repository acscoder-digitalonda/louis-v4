/**
 * Field specs → Airtable Meta API payloads.
 *
 * Shared by `create-base` and `bootstrap-base` so a table created at base-creation time
 * and a table added afterwards come out identical. Link fields are excluded here on
 * purpose: a link needs its target table to exist, so it is always a second pass.
 */

import type { FieldSpec } from './schema'

/**
 * Types the API cannot create at all. Rollups and lookups need a human decision anyway;
 * `lastModifiedTime` is simply not creatable through the Meta API, so it is reported as
 * a manual step rather than failing the run.
 */
export const MANUAL_TYPES = new Set([
  'formula',
  'rollup',
  'lookup',
  // Neither of these can be created through the Meta API. Airtable exposes a record's
  // creation time natively, and the decoder falls back to it, so a missing Created field
  // costs nothing. Last Modified only weakens stale-write detection.
  'createdTime',
  'lastModifiedTime',
])

/**
 * Airtable refuses these at table-creation time — they must be added to a table that
 * already exists, exactly like link fields. So they go in the second pass too.
 */
export const DEFERRED_TYPES = new Set<string>()

export interface MetaFieldPayload {
  name: string
  type: string
  description?: string
  options?: Record<string, unknown>
}

export function toMetaField(field: FieldSpec): MetaFieldPayload {
  const base = { name: field.name, description: field.description }
  switch (field.type) {
    case 'singleSelect':
    case 'multipleSelects':
      return {
        ...base,
        type: field.type,
        options: { choices: (field.choices ?? []).map((name) => ({ name })) },
      }
    // Airtable rejects a checkbox created without an icon and colour.
    case 'checkbox':
      return { ...base, type: 'checkbox', options: { icon: 'check', color: 'greenBright' } }
    case 'currency':
      return { ...base, type: 'currency', options: { precision: 0, symbol: '$' } }
    case 'number':
      return { ...base, type: 'number', options: { precision: 0 } }
    case 'percent':
      return { ...base, type: 'percent', options: { precision: 0 } }
    case 'date':
      return { ...base, type: 'date', options: { dateFormat: { name: 'iso' } } }
    case 'dateTime':
      return {
        ...base,
        type: 'dateTime',
        options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
      }
    case 'createdTime':
      return { ...base, type: 'createdTime', options: { result: { type: 'dateTime' } } }
    case 'lastModifiedTime':
      return { ...base, type: 'lastModifiedTime', options: { result: { type: 'dateTime' } } }
    default:
      return { ...base, type: field.type }
  }
}

/**
 * Airtable makes the first field the primary field, and a primary field cannot be a
 * select, a checkbox or a long-text. Our schema lists fields in reading order, which
 * sometimes puts a select first (Drafts.Type), so the first primary-safe field is
 * promoted to the front and the rest keep their order.
 */
const PRIMARY_SAFE = [
  'singleLineText',
  'email',
  'url',
  'phoneNumber',
  'number',
  'currency',
  'percent',
]
const PRIMARY_FALLBACK = ['date', 'dateTime']

/** The fields a table can be created with in one shot, primary-safe field first. */
export function creatableFields(fields: FieldSpec[]): MetaFieldPayload[] {
  const usable = fields.filter(
    (f) =>
      f.type !== 'multipleRecordLinks' &&
      !MANUAL_TYPES.has(f.type) &&
      !DEFERRED_TYPES.has(f.type),
  )
  const primaryIndex = (() => {
    const preferred = usable.findIndex((f) => PRIMARY_SAFE.includes(f.type))
    if (preferred > -1) return preferred
    return usable.findIndex((f) => PRIMARY_FALLBACK.includes(f.type))
  })()
  if (primaryIndex > 0) {
    const [primary] = usable.splice(primaryIndex, 1)
    if (primary) usable.unshift(primary)
  }
  return usable.map(toMetaField)
}
