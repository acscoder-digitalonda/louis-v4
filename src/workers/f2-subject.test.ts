/**
 * The same enquiry, arriving twice by two routes.
 *
 * The website form relays every submission from one robot address, and the team also
 * forwards the notification inwards. Both landed in the live base as separate deals for
 * the same person on the first sweep that worked. Message-ID dedupe cannot see it: a
 * forward is a new message, new id, new sender, new thread. The subject is what survives.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { strippedSubject } from './f2-email-intake'

describe('strippedSubject', () => {
  it('strips forward and reply decoration, however it is stacked', () => {
    const original = strippedSubject('Book Ben - Jillian Farrow')
    assert.equal(strippedSubject('Fwd: Book Ben - Jillian Farrow'), original)
    assert.equal(strippedSubject('Re: Fwd: Book Ben - Jillian Farrow'), original)
    assert.equal(strippedSubject('FW: RE: Book Ben - Jillian Farrow'), original)
  })

  it('is not confused by spacing or case', () => {
    assert.equal(strippedSubject('  Book  Ben  -  Dawn Jacobson '), 'book ben - dawn jacobson')
  })

  it('leaves a subject that only looks like a prefix alone', () => {
    // "Retreat" starts with "re" and is not a reply.
    assert.equal(strippedSubject('Retreat keynote enquiry'), 'retreat keynote enquiry')
    assert.equal(strippedSubject('Fwding notes'), 'fwding notes')
  })

  it('keeps two different enquiries different', () => {
    assert.notEqual(
      strippedSubject('Book Ben - Dawn Jacobson'),
      strippedSubject('Book Ben - Jillian Farrow'),
    )
  })
})
