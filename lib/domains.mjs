/**
 * Domain forensics — the fifth reading.
 *
 * An invoice redirect has to touch the counterparty's identity somewhere, and
 * the domain is the field it cannot fake cheaply. A real vendor's domain has a
 * history; an impersonator's was registered last month, or is a lookalike of the
 * genuine one that the eye slides straight past.
 *
 * A registrar API answers this better than a search engine can, because
 * "is this domain registered" is a fact rather than a ranking. Two signals fall
 * out of it, and neither needs us to own anything:
 *
 *   1. The domain the document claims is UNREGISTERED. A vendor invoicing from a
 *      domain nobody has bought is not a vendor.
 *   2. A near-neighbour of it IS registered. Then one of the two is wearing the
 *      other's face, and which one is on the invoice matters a great deal.
 */

const DEFAULT_BASE = 'https://api.name.com/v4';

function auth(env) {
  const user = env.NAMECOM_USERNAME;
  const token = env.NAMECOM_TOKEN;
  if (!user || !token) return null;
  return 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');
}

async function call(path, body, env) {
  const base = env.NAMECOM_BASE || DEFAULT_BASE;
  const header = auth(env);
  if (!header) throw new Error('name.com credentials not configured');

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: header, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`name.com ${path} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

const TLDS = ['com', 'co.uk', 'net', 'org', 'io', 'co'];

/** Splits "meridian-systems-group.com" into its label and its suffix. */
function split(domain) {
  const d = String(domain).toLowerCase().replace(/^www\./, '');
  const tld = TLDS.find((t) => d.endsWith('.' + t));
  return tld ? { label: d.slice(0, -(tld.length + 1)), tld } : { label: d.replace(/\.[^.]+$/, ''), tld: 'com' };
}

/**
 * Near-neighbours a human reading quickly would not distinguish. Deliberately
 * conservative: every one of these is a string an eye can mistake for the
 * original, not merely a string that shares some characters with it.
 */
const CORPORATE = ['ltd', 'limited', 'group', 'inc', 'llc', 'global', 'holdings', 'uk', 'intl'];

export function neighbours(domain, limit = 24) {
  const { label, tld } = split(domain);

  // The transformations have to COMPOSE, not fire one at a time. The genuine
  // vendor behind "meridian-systems-group.com" is "meridiansystems.co.uk" —
  // reachable only by dropping the corporate suffix AND the hyphens AND
  // changing the TLD. Applying those singly finds nothing worth finding.
  let labels = new Set([label]);
  for (let pass = 0; pass < 2; pass++) {
    for (const l of [...labels]) {
      labels.add(l.replace(/-/g, ''));                                   // hyphens are invisible to a reader
      for (const s of CORPORATE) {
        labels.add(l.replace(new RegExp(`[-]?${s}$`), ''));              // drop a corporate suffix
        if (!l.endsWith(s)) labels.add(`${l}-${s}`);                     // or add one
      }
      const parts = l.split('-').filter(Boolean);
      if (parts.length > 1) labels.add(parts.slice(0, -1).join('-'));    // drop the trailing word
    }
  }

  const alt = new Set();
  for (const l of labels) {
    if (!l || l.length < 4) continue;
    for (const t of TLDS) {
      const d = `${l}.${t}`;
      if (d !== domain) alt.add(d);
    }
  }

  // Ranking by string distance buries the only variant worth having. What makes
  // two domains confusable is that one CONTAINS the other once the punctuation
  // is gone: "meridiansystems" inside "meridiansystemsgroup" is a brand with
  // corporate dressing removed, and that shorter core is what the real vendor
  // is most likely to own. Additions rank below cores; unrelated strings last.
  const bare = (x) => x.replace(/-/g, '');
  const root = bare(label);
  const rank = (d) => {
    const a = bare(split(d).label);
    if (a === root) return 0;                      // same name, different suffix
    if (root.startsWith(a)) return 1 + (root.length - a.length) / 100;  // a core
    if (a.startsWith(root)) return 3 + (a.length - root.length) / 100;  // an addition
    return 9;
  };
  const ordered = [...alt]
    .filter((d) => /^[a-z0-9-]+\.[a-z.]+$/.test(d) && d.length < 64 && !d.includes('--'))
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length);

  // Same-name-different-suffix is a real confusion but a cheap one, and there
  // are a dozen of them. Left uncapped they fill the whole budget and crowd out
  // the cores — which is where the genuine vendor actually lives.
  const out = [];
  let sameRoot = 0;
  for (const d of ordered) {
    if (rank(d) === 0 && ++sameRoot > 5) continue;
    out.push(d);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @returns {Promise<{domain:string, registered:boolean|null, neighbours:object[], note:string}>}
 */
export async function inspectDomain(domain, env) {
  const candidates = [domain, ...neighbours(domain)];
  const res = await call('/domains:checkAvailability', { domainNames: candidates }, env);

  // The API answers about availability; we care about the inverse. A domain that
  // can be purchased is a domain nobody has registered.
  const byName = new Map((res.results ?? []).map((r) => [String(r.domainName).toLowerCase(), r]));
  const claimed = byName.get(domain.toLowerCase());
  const registered = claimed ? claimed.purchasable !== true : null;

  const bare = (x) => split(x).label.replace(/-/g, '');
  const root = bare(domain);

  const taken = candidates
    .slice(1)
    .map((d) => ({ domain: d, entry: byName.get(d.toLowerCase()) }))
    .filter(({ entry }) => entry && entry.purchasable !== true)
    .map(({ domain: d }) => ({
      domain: d,
      registered: true,
      // A registered domain whose name is a strictly shorter core of the one on
      // the invoice is the interesting case: the invoice is using the dressed-up
      // version of a name somebody else already owns.
      shorterCore: bare(d).length < root.length && root.startsWith(bare(d)),
    }));

  const cores = taken.filter((t) => t.shorterCore);

  // Every established brand defensively registers its own neighbours, so
  // "neighbours exist" is not a signal — it is the default. Only two patterns
  // are worth reporting, and the third case is explicitly cleared.
  let verdict, note;
  if (registered === false) {
    verdict = 'unregistered';
    note = `The domain on this invoice is unregistered and can be purchased right now. A supplier billing from a domain nobody owns is not a supplier.`;
  } else if (cores.length) {
    verdict = 'lookalike';
    note = `The invoice uses ${domain}, a longer variant of ${cores.length === 1 ? 'a domain' : 'domains'} that already exist${cores.length === 1 ? 's' : ''}: ${cores.slice(0, 3).map((c) => c.domain).join(', ')}. The shorter name is the one a reader recognises.`;
  } else {
    verdict = 'clear';
    note = taken.length
      ? `Registered, and the ${taken.length} registered neighbours are all equal-or-longer variants — the ordinary pattern for a brand protecting its own name.`
      : `Registered, with no near-identical neighbour registered alongside it.`;
  }

  return { domain, registered, verdict, checked: candidates.length, neighbours: taken, cores, note };
}

/** Pulls the most plausible vendor domain out of the layer a human can see. */
export function domainFrom(visibleText) {
  const emails = [...String(visibleText).matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].map((m) => m[1]);
  if (emails.length) return emails[0].toLowerCase();
  const bare = String(visibleText).match(/\b([a-z0-9-]+\.(?:co\.uk|com|net|org|io))\b/i);
  return bare ? bare[1].toLowerCase() : null;
}
