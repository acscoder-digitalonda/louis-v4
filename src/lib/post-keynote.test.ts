import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { alertMessage, alertReason } from './post-keynote'
import type { Deal } from './types'

const deal = (over: Partial<Deal> = {}) =>
  ({
    id: 'rec1',
    name: 'Acme keynote',
    client: { id: 'c1', name: 'Acme' },
    postKeynoteAlert: false,
    postKeynoteNotes: null,
    ...over,
  }) as unknown as Deal

describe('alertReason', () => {
  it('fires on the tick', () => {
    assert.equal(alertReason(deal(), { postKeynoteAlert: true }), 'ticked')
  })

  it('does not fire again on a deal that is already ticked', () => {
    // Otherwise every logistics edit for the rest of the deal's life re-alerts.
    const already = deal({ postKeynoteAlert: true })
    assert.equal(alertReason(already, { postKeynoteAlert: true }), null)
    assert.equal(alertReason(already, { location: 'Austin' }), null)
  })

  it('ignores an untick', () => {
    assert.equal(alertReason(deal({ postKeynoteAlert: true }), { postKeynoteAlert: false }), null)
  })

  it('sends an update when the notes arrive afterwards', () => {
    // The real sequence: tick from the room, write the notes in the car.
    const ticked = deal({ postKeynoteAlert: true, postKeynoteNotes: null })
    assert.equal(alertReason(ticked, { postKeynoteNotes: 'Standing ovation.' }), 'notes-updated')
  })

  it('stays quiet when notes change on a deal nobody ticked', () => {
    assert.equal(alertReason(deal(), { postKeynoteNotes: 'Went well.' }), null)
  })

  it('stays quiet on a no-op save or an emptied note', () => {
    const ticked = deal({ postKeynoteAlert: true, postKeynoteNotes: 'Standing ovation.' })
    assert.equal(alertReason(ticked, { postKeynoteNotes: 'Standing ovation. ' }), null)
    assert.equal(alertReason(ticked, { postKeynoteNotes: '   ' }), null)
  })
})

describe('alertMessage', () => {
  it('carries the notes', () => {
    const m = alertMessage(deal({ postKeynoteNotes: 'Standing ovation.' }), 'ticked')
    assert.equal(m.title, 'Post-keynote — Acme')
    assert.match(m.body, /Standing ovation\./)
  })

  it('says so when he ticked with nothing typed', () => {
    // A blank alert would teach the office that the alert says nothing.
    const m = alertMessage(deal(), 'ticked')
    assert.match(m.body, /no notes written yet/)
    assert.match(m.body, /while he still remembers/)
  })

  it('marks an update as an update', () => {
    const m = alertMessage(deal({ postKeynoteNotes: 'Later thoughts.' }), 'notes-updated')
    assert.match(m.title, /notes updated/)
  })
})
