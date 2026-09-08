import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  acceptClassification,
  classifyPrompt,
  deriveDomain,
  isKnownIndustry,
  logoUrl,
  normaliseDomain,
  parseAddress,
  parseSite,
} from './enrichment'

describe('normaliseDomain', () => {
  it('strips the scheme, the www and the path', () => {
    assert.equal(normaliseDomain('https://www.Acme.com/about?x=1'), 'acme.com')
    assert.equal(normaliseDomain('  ACME.CO.UK  '), 'acme.co.uk')
  })

  it('refuses what is not a domain', () => {
    // The column really does contain these.
    for (const junk of ['n/a', 'see email', '', null, undefined, 'acme', 'a b.com']) {
      assert.equal(normaliseDomain(junk), null, JSON.stringify(junk))
    }
  })
})

describe('deriveDomain', () => {
  it('prefers what the record already says', () => {
    assert.equal(deriveDomain({ domain: 'acme.com', website: 'https://other.com' }), 'acme.com')
    assert.equal(deriveDomain({ website: 'https://other.com' }), 'other.com')
  })

  it('takes a work domain two people share', () => {
    const emails = ['a@acme.com', 'b@acme.com', 'c@gmail.com']
    assert.equal(deriveDomain({ emails }), 'acme.com')
  })

  it('will not take one address as evidence', () => {
    // One contractor with a personal-looking address is a coincidence, not a domain.
    assert.equal(deriveDomain({ emails: ['a@acme.com', 'b@gmail.com'] }), null)
  })

  it('never takes a mailbox provider', () => {
    assert.equal(deriveDomain({ emails: ['a@gmail.com', 'b@gmail.com', 'c@gmail.com'] }), null)
  })
})

describe('parseSite', () => {
  const html = `
    <html><head>
    <title>Acme Federal Credit Union &amp; Trust</title>
    <meta property="og:description" content="Banking for members since 1954.">
    <meta property="og:image" content="/img/logo.png">
    <link rel="apple-touch-icon" href="https://cdn.acme.com/touch.png">
    </head><body></body></html>`

  it('reads the title, the description and the logo', () => {
    const facts = parseSite(html, 'acme.com')
    assert.equal(facts.title, 'Acme Federal Credit Union & Trust')
    assert.equal(facts.description, 'Banking for members since 1954.')
    assert.equal(facts.logo, 'https://acme.com/img/logo.png', 'a relative og:image is made absolute')
  })

  it('falls back to the touch icon, then the favicon', () => {
    const noOg = html.replace(/<meta property="og:image"[^>]*>/, '')
    assert.equal(parseSite(noOg, 'acme.com').logo, 'https://cdn.acme.com/touch.png')

    const bare = parseSite('<html><head><title>x</title></head></html>', 'acme.com')
    assert.equal(logoUrl(bare), 'https://acme.com/favicon.ico')
  })

  it('survives a page with nothing in it', () => {
    const facts = parseSite('', 'acme.com')
    assert.deepEqual(facts, { domain: 'acme.com', title: null, description: null, logo: null, address: null })
  })
})

describe('parseAddress', () => {
  it('takes an address the site publishes about itself', () => {
    const html = `<script type="application/ld+json">
      {"@type":"Organization","name":"Acme","address":
        {"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Austin",
         "addressRegion":"TX","postalCode":"78701"}}
    </script>`
    assert.equal(parseAddress(html), '1 Main St, Austin, TX, 78701')
  })

  it('finds one nested in a graph', () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"WebSite"},{"@type":"LocalBusiness","address":
        {"@type":"PostalAddress","addressLocality":"Boston","addressRegion":"MA"}}]}
    </script>`
    assert.equal(parseAddress(html), 'Boston, MA')
  })

  it('ignores a fragment too thin to be an address', () => {
    const html = `<script type="application/ld+json">
      {"@type":"PostalAddress","addressCountry":"US"}</script>`
    assert.equal(parseAddress(html), null)
  })

  it('shrugs off malformed JSON-LD', () => {
    // Extremely common, and not an error worth raising.
    assert.equal(parseAddress('<script type="application/ld+json">{oops</script>'), null)
  })

  it('never invents one from the footer', () => {
    // The whole point: a plausible wrong address is worse than a blank one.
    assert.equal(parseAddress('<footer>123 Elm Street, Springfield, IL 62704</footer>'), null)
  })
})

describe('acceptClassification', () => {
  const facts = { domain: 'acme.com', title: 'Acme Credit Union', description: 'Banking.', logo: null, address: null }

  it('takes a confident label from the taxonomy', () => {
    const out = acceptClassification({ industry: 'Financial Services', confidence: 0.92, because: 'a credit union' }, facts)
    assert.equal(out.industry, 'Financial Services')
  })

  it('refuses a label that is not in the taxonomy', () => {
    // Airtable's typecast would create a nineteenth industry rather than reject it.
    const out = acceptClassification({ industry: 'Insurance', confidence: 0.99 }, facts)
    assert.equal(out.industry, null)
    assert.match(out.because, /not one of the eighteen/)
  })

  it('refuses a low-confidence answer', () => {
    const out = acceptClassification({ industry: 'Technology', confidence: 0.4, because: 'unclear' }, facts)
    assert.equal(out.industry, null)
  })

  it('refuses anything at all when the page was empty', () => {
    const blank = { domain: 'acme.com', title: null, description: null, logo: null, address: null }
    const out = acceptClassification({ industry: 'Technology', confidence: 0.99 }, blank)
    assert.equal(out.industry, null)
    assert.match(out.because, /said nothing to read/)
  })
})

describe('classifyPrompt', () => {
  it('carries the taxonomy, so the prompt cannot drift from the list', () => {
    const prompt = classifyPrompt({ domain: 'acme.com', title: 'Acme', description: null, logo: null, address: null })
    assert.ok(prompt.includes('- Financial Services'))
    assert.ok(prompt.includes('- Sports & Entertainment'))
    assert.ok(isKnownIndustry('Financial Services'))
    assert.equal(isKnownIndustry('Insurance'), false)
  })
})

describe('deriveDomain — name beats majority', () => {
  it('picks the domain carrying the company name over the more common one', () => {
    // Live case: a company called Stratum had three people at tidewell.org and one at
    // stratumhealthsystem.org. Counting votes picked Tidewell, a different organisation.
    const emails = [
      'phancock@tidewell.org',
      'acromie@tidewell.org',
      'jschilson@stratumhealthsystem.org',
      'katie@alignanywhere.com',
    ]
    assert.equal(deriveDomain({ name: 'Stratum', emails }), 'stratumhealthsystem.org')
  })

  it('still takes the majority when no domain carries the name', () => {
    const emails = ['a@acme.com', 'b@acme.com', 'c@other.com']
    assert.equal(deriveDomain({ name: 'Ridgeline Partners', emails }), 'acme.com')
  })

  it('will not match on a name too short to mean anything', () => {
    // "A-Speakers" reduces to "a", which is in almost every hostname. That is the bureau
    // match-key bug wearing a different hat.
    const emails = ['x@alpha.com', 'y@alpha.com', 'z@beta.com']
    assert.equal(deriveDomain({ name: 'A', emails }), 'alpha.com')
  })

  it('matches a name that is a prefix of the host', () => {
    assert.equal(deriveDomain({ name: 'BLP', emails: ['m@blplegal.com'] }), 'blplegal.com')
  })
})
