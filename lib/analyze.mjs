/**
 * The orchestrator: four readings of one file, and the disagreements between
 * them. Every check below is deterministic and explainable on its own — the
 * model layer is asked to decide, never to detect.
 */

import { extractViews } from './views.mjs';
import { nutrientText, nutrientStructure } from './nutrient.mjs';
import { gatherEvidence, claimsFrom } from './evidence.mjs';
import { inspectDomain, domainFrom } from './domains.mjs';

const MONEY = /(?:USD|EUR|GBP|\$|€|£)?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]+\.[0-9]{2})/g;
const IBAN = /\b([A-Z]{2})\s?[0-9]{2}(?:\s?[A-Z0-9]{4}){2,7}\b/g;

const amounts = (s) => [...String(s).matchAll(MONEY)].map((m) => m[1].replace(/,/g, ''));
const ibans = (s) => [...String(s).matchAll(IBAN)].map((m) => ({ full: m[0].replace(/\s/g, ''), country: m[1] }));

/**
 * Findings are written for a human, who needs the concealed figure in order to
 * grasp the size of the problem. A model must not be handed it. The whole point
 * of withholding the payload is that it never enters the context, and a figure
 * leaked through prose is leaked exactly as effectively as one leaked through a
 * quarantine block — we found this the hard way, watching a model report a total
 * it could only have read out of our own findings text. So every monetary figure
 * a human cannot see on the page is withheld from the model's copy.
 */
export function redactForModel(findings, visibleText) {
  const visible = new Set(amounts(visibleText));
  return findings.map((f) =>
    f.replace(MONEY, (whole, num) =>
      (visible.has(num.replace(/,/g, '')) ? whole : whole.replace(num, '[withheld]'))),
  );
}

/**
 * Structural findings drawn purely from comparing the views. No model involved,
 * so each one is reproducible byte-for-byte and can be shown to an auditor.
 */
function structuralFindings({ viewA, viewB, concealed, structure }) {
  const findings = [];

  if (concealed.length) {
    findings.push(
      `${concealed.length} text run${concealed.length === 1 ? '' : 's'} present in the content stream but not visible on the page ` +
      `(${concealed.length} distinct concealment technique${new Set(concealed.map((c) => c.reasons[0])).size === 1 ? '' : 's'}: ` +
      `${[...new Set(concealed.map((c) => c.reasons[0]?.split(' ')[0]))].join(', ')}).`);
  }

  // An amount that exists only in the invisible layer is the payload of an
  // over-invoicing attack: the human approves one figure, the machine reads another.
  const hiddenText = concealed.map((c) => c.text).join(' ');
  const visibleAmounts = new Set(amounts(viewB));
  const hiddenOnly = [...new Set(amounts(hiddenText))].filter((a) => !visibleAmounts.has(a));
  for (const a of hiddenOnly) {
    const biggest = [...visibleAmounts].map(Number).sort((x, y) => y - x)[0];
    const ratio = biggest ? (Number(a) / biggest).toFixed(1) : null;
    findings.push(
      `Monetary figure ${a} appears only in concealed text; the largest figure a human can see is ${biggest ?? 'none'}` +
      (ratio ? ` — a ${ratio}x difference.` : '.'));
  }

  // A destination account in a different jurisdiction from the vendor is the
  // signature of a redirect, and it is checkable without any model at all.
  const visibleIbans = ibans(viewB);
  const jurisdictionHint = /registered in England|United Kingdom|London|Company No\./i.test(viewB) ? 'GB' : null;
  for (const ib of visibleIbans) {
    if (jurisdictionHint && ib.country !== jurisdictionHint) {
      findings.push(
        `Destination IBAN is registered in ${ib.country} while the vendor presents as ${jurisdictionHint}-domiciled ` +
        `(company number and registered office on the letterhead).`);
    }
  }

  if (structure?.elements?.length) {
    const concealedInStructure = structure.elements.filter((el) =>
      concealed.some((c) => c.text.length > 24 && el.text.includes(c.text.slice(0, 24))));
    if (concealedInStructure.length) {
      findings.push(
        `The independent layout engine placed ${concealedInStructure.length} concealed run${concealedInStructure.length === 1 ? '' : 's'} ` +
        `into the document's reading order (roles: ${[...new Set(concealedInStructure.map((e) => e.role))].join(', ')}) — ` +
        `a downstream consumer would receive it as ordinary body text.`);
    }
  }

  return findings;
}

function verdict({ concealed, findings, domain }) {
  const critical = concealed.length > 0;
  const mismatches = findings.filter((f) => /only in concealed|different jurisdiction|IBAN is registered/i.test(f)).length;
  if (critical && mismatches) return { decision: 'REFUSE', reason: 'Concealed text materially alters the terms a human would be agreeing to.' };
  if (critical) return { decision: 'REFUSE', reason: 'The file carries text no human reviewer can see.' };
  // The identity reading stands on its own: a supplier billing from a domain
  // nobody owns is not a supplier, whatever the rest of the page says.
  if (domain?.verdict === 'unregistered') return { decision: 'REFUSE', reason: 'The vendor bills from a domain that is not registered to anyone.' };
  if (domain?.verdict === 'lookalike') return { decision: 'HOLD', reason: 'The billing domain is a lookalike of a shorter registered name.' };
  if (mismatches) return { decision: 'HOLD', reason: 'Visible terms raise checks that need a human.' };
  return { decision: 'SIGN', reason: 'The readings agree and no concealed content was found.' };
}

/**
 * @param {Buffer|Uint8Array} bytes
 * @param {object} env
 */
export async function analyze(bytes, env, { withEvidence = true } = {}) {
  const views = await extractViews(bytes);

  // Both Nutrient reads are independent of ours and of each other; a failure in
  // either degrades the report rather than sinking it.
  const [textRes, structRes] = await Promise.allSettled([
    nutrientText(bytes, env.NUTRIENT_EXTRACTION_KEY),
    nutrientStructure(bytes, env.NUTRIENT_EXTRACTION_KEY),
  ]);
  const ntext = textRes.status === 'fulfilled' ? textRes.value : { markdown: '', error: String(textRes.reason?.message ?? textRes.reason) };
  const structure = structRes.status === 'fulfilled' ? structRes.value : { elements: [], error: String(structRes.reason?.message ?? structRes.reason) };

  const findings = structuralFindings({ viewA: views.viewA, viewB: views.viewB, concealed: views.concealed, structure });

  // Did the commercial extractor pass the concealed text through untouched?
  const leaked = views.concealed.filter((c) => c.text.length > 30 && ntext.markdown.includes(c.text.slice(0, 30)));
  if (leaked.length) {
    findings.push(
      `${leaked.length} concealed run${leaked.length === 1 ? '' : 's'} survived commercial text extraction intact and would have been ` +
      `handed to a downstream model as ordinary invoice text.`);
  }

  let evidence = [];
  if (withEvidence && env.SERPAPI_KEY) {
    const fields = fieldsFromStructure(structure, views.viewB);
    try { evidence = await gatherEvidence(claimsFrom(fields), env.SERPAPI_KEY); } catch { evidence = []; }
  }

  // The fifth reading. Only the domain a human can actually see is checked —
  // reading it out of the concealed layer would be checking the attacker's
  // preferred answer.
  let domain = null;
  const claimedDomain = domainFrom(views.viewB);
  if (claimedDomain && env.NAMECOM_TOKEN && env.NAMECOM_USERNAME) {
    try {
      domain = await inspectDomain(claimedDomain, env);
      // Only the two diagnostic patterns become findings. A brand that has
      // registered its own neighbours is behaving normally, and reporting that
      // as a risk would put a false positive on every legitimate invoice.
      if (domain.verdict === 'unregistered') {
        findings.push(
          `The vendor's own domain (${domain.domain}) is unregistered and available to purchase right now — ` +
          `a supplier invoicing from a domain nobody owns. ${domain.neighbours.length} near-identical ` +
          `domain${domain.neighbours.length === 1 ? ' is' : 's are'} registered, including ` +
          `${domain.neighbours.slice(0, 2).map((n) => n.domain).join(' and ')}.`);
      } else if (domain.verdict === 'lookalike') {
        findings.push(
          `The invoice bills from ${domain.domain}, a longer variant of ` +
          `${domain.cores.slice(0, 2).map((c) => c.domain).join(' and ')}, which ${domain.cores.length === 1 ? 'is' : 'are'} ` +
          `already registered. The shorter name is the one a reader recognises.`);
      }
    } catch (err) {
      domain = { domain: claimedDomain, error: String(err.message ?? err) };
    }
  } else if (claimedDomain) {
    domain = { domain: claimedDomain, skipped: 'name.com credentials not configured' };
  }

  return {
    views, nutrient: { text: ntext, structure }, findings, leaked, domain,
    // The copy safe to place in a model's context. Never send `findings` there.
    findingsForModel: redactForModel(findings, views.viewB),
    evidence,
    verdict: verdict({ concealed: views.concealed, findings, domain }),
  };
}

/** Cheap, regex-level field pull off the visible layer — enough to seed evidence queries. */
export function fieldsFromStructure(structure, viewB) {
  const grab = (re) => (viewB.match(re) ?? [])[1]?.trim() ?? null;
  return {
    vendor_name: (structure?.elements ?? []).find((e) => e.role === 'Title' || e.role === 'SectionHeader')?.text ?? grab(/^([A-Z][A-Z\s&.,]+(?:LTD|LLC|INC|PLC|GMBH))/m),
    vendor_address: grab(/(Unit [^\n]+)/),
    company_number: grab(/Company No\.?\s*([0-9]+)/i),
    bank_name: grab(/Bank\s+(.+)/),
    account_name: grab(/Account name\s+(.+)/),
    iban: grab(/IBAN\s+([A-Z0-9 ]+)/),
    swift: grab(/SWIFT[^\n]*?\s([A-Z0-9]{8,11})\s*$/m),
  };
}
