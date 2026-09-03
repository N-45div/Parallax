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
