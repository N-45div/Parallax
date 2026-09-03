/**
 * The evidence layer.
 *
 * A risk score is an opinion. What a human approving a payment actually needs is
 * the source that changed their mind, so every assertion lifted out of the
 * document is turned into a query and carries its citations forward.
 */

const ENDPOINT = 'https://serpapi.com/search.json';

async function search(q, key, num = 5) {
  const url = `${ENDPOINT}?engine=google&q=${encodeURIComponent(q)}&num=${num}&api_key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpApi ${res.status}`);
  const json = await res.json();
  return (json.organic_results ?? []).slice(0, num).map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet ?? '',
    source: r.source ?? null,
  }));
}

/**
 * Each claim is checked on its own so a single unverifiable field cannot sink
 * the rest of the report.
 * @param {{id:string,label:string,value:string,query:string,kind:string}[]} claims
 */
export async function gatherEvidence(claims, key) {
  const out = await Promise.all(
    claims.map(async (c) => {
      try {
        const results = await search(c.query, key);
        return { ...c, ok: true, results };
      } catch (err) {
        return { ...c, ok: false, results: [], error: String(err.message ?? err) };
      }
    }),
  );
  return out;
}

/** Builds the claim set from whatever the readings agreed on. */
export function claimsFrom(fields) {
  const claims = [];
  const add = (id, label, value, query, kind) => {
    if (value && String(value).trim() && String(value).toLowerCase() !== 'null') {
      claims.push({ id, label, value: String(value), query, kind });
    }
  };

  add('vendor', 'Vendor legal identity', fields.vendor_name,
      `"${fields.vendor_name}" company registration`, 'identity');
  add('company_no', 'Companies House registration', fields.company_number,
      `"${fields.company_number}" company number UK registered`, 'registry');
  add('address', 'Registered address', fields.vendor_address,
      `"${fields.vendor_address}" registered office`, 'identity');
  add('bank', 'Receiving institution', fields.bank_name,
      `"${fields.bank_name}" bank SWIFT ${fields.swift ?? ''}`.trim(), 'banking');
  add('account_name', 'Account name vs vendor name', fields.account_name,
      `"${fields.account_name}" company`, 'banking');

  return claims;
}
