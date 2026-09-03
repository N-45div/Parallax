/**
 * Views A and B: the ingest layer and the visible layer.
 *
 * getTextContent() gives us what a naive reader — and every LLM pipeline —
 * swallows. It does not tell us whether a human could actually see any of it,
 * because colour, alpha and text render mode live in the content stream, not in
 * the text items. So we replay the operator list through a minimal graphics
 * state machine and label every glyph run with the state it was drawn under.
 * The runs that turn out to be unreadable are view A minus view B: the payload.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pdfjsPromise;
function pdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

const NEAR_WHITE = 0.92;   // fill this light on a white page reads as absent
const TINY_PT = 1.2;       // below this nothing is legible at any zoom
const ALPHA_FLOOR = 0.06;

/** pdf.js hands colour components back as 0-255 ints in some paths, 0-1 floats in others. */
function norm(c) {
  const m = Math.max(...c);
  return m > 1.0001 ? c.map((v) => v / 255) : c;
}

function relLuminance([r, g, b]) {
  const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function mul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/**
 * Replays one page's operator list, returning every glyph run with the graphics
 * state that produced it. Concealment is decided here and nowhere else.
 */
async function runsForPage(page) {
  const { OPS } = await pdfjs();
  const opList = await page.getOperatorList();
  const view = page.view; // [x0, y0, x1, y1] mediabox

  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0];
  let lineMatrix = [1, 0, 0, 1, 0, 0];
  let fill = [0, 0, 0];
  let alpha = 1;
  let renderMode = 0;
  let fontSize = 0;
  let leading = 0;
  const runs = [];

  const push = (text) => {
    if (!text || !text.trim()) return;
    const full = mul(tm, ctm);
    const effSize = Math.abs(fontSize) * scaleOf(full);
    const x = full[4];
    const y = full[5];

    const lum = relLuminance(fill);
    const reasons = [];
    // Modes 3 and 7 paint nothing at all — the classic "invisible ink" of OCR
    // layers, and the single most common way to smuggle text past a human.
    if (renderMode === 3 || renderMode === 7) reasons.push('text render mode ' + renderMode + ' (paints no glyphs)');
    if (alpha <= ALPHA_FLOOR) reasons.push('fill alpha ' + alpha.toFixed(2));
    if (lum >= NEAR_WHITE) reasons.push('fill luminance ' + lum.toFixed(3) + ' against a white page');
    if (effSize > 0 && effSize < TINY_PT) reasons.push('effective font size ' + effSize.toFixed(2) + 'pt');
    const offPage = x < view[0] - 2 || x > view[2] + 2 || y < view[1] - 2 || y > view[3] + 2;
    if (offPage) reasons.push('drawn at (' + x.toFixed(0) + ', ' + y.toFixed(0) + '), outside the page box');

    runs.push({
      text,
      x, y,
      size: Number(effSize.toFixed(2)),
      fill: fill.map((v) => Number(v.toFixed(3))),
      alpha: Number(alpha.toFixed(3)),
      renderMode,
      concealed: reasons.length > 0,
      reasons,
    });
  };

  const glyphText = (glyphs) =>
    (glyphs || [])
      .map((g) => (typeof g === 'object' && g !== null ? (g.unicode ?? '') : typeof g === 'number' && g < -100 ? ' ' : ''))
      .join('');

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    switch (fn) {
      case OPS.save: stack.push({ ctm, fill, alpha, renderMode, fontSize }); break;
      case OPS.restore: {
        const s = stack.pop();
        if (s) ({ ctm, fill, alpha, renderMode, fontSize } = s);
        break;
      }
      case OPS.transform: ctm = mul(args, ctm); break;
      case OPS.beginText: tm = [1, 0, 0, 1, 0, 0]; lineMatrix = tm; break;
      case OPS.setTextMatrix: tm = args.slice(0, 6); lineMatrix = tm; break;
      case OPS.setLeading: leading = args[0]; break;
      case OPS.setFont: fontSize = args[1]; break;
      case OPS.setTextRenderingMode: renderMode = args[0]; break;
      case OPS.moveText: tm = mul([1, 0, 0, 1, args[0], args[1]], lineMatrix); lineMatrix = tm; break;
      case OPS.setLeadingMoveText: leading = -args[1]; tm = mul([1, 0, 0, 1, args[0], args[1]], lineMatrix); lineMatrix = tm; break;
      case OPS.nextLine: tm = mul([1, 0, 0, 1, 0, -leading], lineMatrix); lineMatrix = tm; break;
      case OPS.setFillRGBColor: fill = norm(args.slice(0, 3)); break;
      case OPS.setFillGray: fill = [args[0], args[0], args[0]]; break;
      case OPS.setFillCMYKColor: {
        const [c, m, y2, k] = args;
        fill = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y2) * (1 - k)];
        break;
      }
      case OPS.setGState:
        for (const [k, v] of args[0] || []) {
          if (k === 'ca') alpha = v;
          if (k === 'LW') void 0;
        }
        break;
      case OPS.showText: push(glyphText(args[0])); break;
      case OPS.showSpacedText: push(glyphText(args[0])); break;
      case OPS.nextLineShowText: tm = mul([1, 0, 0, 1, 0, -leading], lineMatrix); lineMatrix = tm; push(glyphText(args[0])); break;
      default: break;
    }
  }
  return runs;
}

/**
 * @param {Buffer|Uint8Array} bytes
 * @returns {Promise<{pages:number, runs:object[], viewA:string, viewB:string, concealed:object[]}>}
 */
export async function extractViews(bytes) {
  const { getDocument } = await pdfjs();

  // Nothing here is ever rasterised, so the standard font data is only wanted to
  // stop pdf.js warning on every document. Resolved through the package rather
  // than a relative path, so it survives whatever node_modules layout the host
  // gives us — and falls back to undefined rather than throwing if it moves.
  let standardFontDataUrl;
  try {
    standardFontDataUrl = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, 'standard_fonts/');
  } catch {
    standardFontDataUrl = undefined;
  }

  const doc = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl,
  }).promise;

  const runs = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    for (const r of await runsForPage(page)) runs.push({ ...r, page: p });
  }
  await doc.destroy();

  const join = (rs) => rs.map((r) => r.text).join('\n').replace(/[ \t]+\n/g, '\n').trim();
  const concealed = runs.filter((r) => r.concealed);

  return {
    pages: doc.numPages,
    runs,
    viewA: join(runs),                                   // what the model ingests
    viewB: join(runs.filter((r) => !r.concealed)),       // what a human can see
    concealed,
  };
}
