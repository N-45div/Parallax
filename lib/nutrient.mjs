/**
 * View C — the structural layer.
 *
 * Nutrient's layout engine is an entirely independent reader of the same bytes:
 * it recovers reading order and semantic role without any reference to how we
 * decided visibility. That independence is the point. When its ordering
 * disagrees with the visual layout, or when it surfaces text our own renderer
 * proved unseeable, the disagreement is evidence rather than a bug.
 */

const BASE = 'https://api.nutrient.io/extraction/parse';

async function parse(bytes, instructions, key) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'document.pdf');
  form.append('instructions', JSON.stringify(instructions));

  const res = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Nutrient ${instructions.mode} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/** Independent plain-text read. This is what a normal document pipeline would hand an LLM. */
export async function nutrientText(bytes, key) {
  const json = await parse(bytes, { mode: 'text', output: { format: 'markdown' } }, key);
  return {
    markdown: json?.output?.markdown ?? '',
    pages: json?.metrics?.pagesProcessed ?? 0,
    ms: json?.metrics?.processingTimeMs ?? 0,
  };
}

/**
 * The ML read, which is the one that carries real confidence.
 *
 * `structure` mode is deterministic layout analysis and reports 1.0 for
 * everything on a born-digital page, which is worth nothing as a signal.
 * `understand` mode actually spreads — and on the tampered fixture it ranks a
 * fragment of the invisible injection as its single most confident element,
 * above the letterhead, while the visible IBAN and SWIFT sit at the bottom.
 *
 * That is the argument for reading a document more than one way, made by the
 * document engine itself: certainty about text and visibility of text are
 * unrelated properties, so a pipeline that routes on confidence alone routes
 * most confidently on exactly the content it should not be reading.
 */
export async function nutrientUnderstand(bytes, key) {
  const json = await parse(bytes, { mode: 'understand' }, key);
  const elements = (json?.output?.elements ?? [])
    .filter((e) => (e.text ?? '').trim())
    .map((e) => ({
      role: e.role ?? null,
      text: (e.text ?? '').trim(),
      confidence: typeof e.confidence === 'number' ? e.confidence : null,
      readingOrder: e.readingOrder,
    }));
  return { elements, ms: json?.metrics?.processingTimeMs ?? 0 };
}

/** Reading order + semantic roles, straight from the layout engine. */
export async function nutrientStructure(bytes, key) {
  const json = await parse(bytes, { mode: 'structure' }, key);
  const elements = (json?.output?.elements ?? []).map((e) => ({
    id: e.id,
    role: e.role,
    text: (e.text ?? '').trim(),
    readingOrder: e.readingOrder,
    confidence: e.confidence,
    bounds: e.bounds,
    page: e.page?.pageNumber ?? 1,
  }));
  return { elements, ms: json?.metrics?.processingTimeMs ?? 0 };
}
