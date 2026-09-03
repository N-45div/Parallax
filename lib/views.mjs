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
import { existsSync } from 'node:fs';
const require = createRequire(import.meta.url);

let pdfjsPromise;
function pdfjs() {
  // Left to itself, pdf.js starts a "fake worker" by importing the worker module
  // from a path it computes at runtime. Nothing imports it statically, so the
  // bundler cannot see it, and the guessed path does not exist inside a
  // serverless bundle — a failure that appears only in production. Resolving the
  // path by hand does not help either: require.resolve is unreliable there too.
  //
  // Importing the worker module for its side effect avoids the whole problem.
  // The specifier is a literal, so the bundler traces it; loading it registers
  // the worker in this context, and pdf.js then uses it without ever needing a
  // URL to fetch it from.
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs').catch(() => null),
  ]).then(([mod]) => mod);
  return pdfjsPromise;
}

// Text is unreadable when it does not contrast with whatever is behind it. The
// WCAG ratio bottoms out at 1.0 for an exact match; anything under this is
// indistinguishable from its background at any size or zoom.
const CONTRAST_FLOOR = 1.15;
const TINY_PT = 1.2;       // below this nothing is legible at any zoom
const ALPHA_FLOOR = 0.06;

/** pdf.js hands colour components back as 0-255 ints in some paths, 0-1 floats in others. */
function norm(c) {
  const a = Array.from(c, Number);
  return ArrayBuffer.isView(c) || Math.max(...a) > 1.0001 ? a.map((v) => v / 255) : a;
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

/** WCAG relative-contrast ratio. 1.0 is an exact match; black on white is 21. */
function contrast(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Transforms a user-space bbox into device space, keeping it axis-aligned. */
function bboxToDevice([x0, y0, x1, y1], ctm) {
  const pts = [apply(ctm, x0, y0), apply(ctm, x1, y0), apply(ctm, x1, y1), apply(ctm, x0, y1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

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

  // Every filled rectangle, in paint order, with the luminance it was filled
  // with. White text is only concealed if what sits behind it is also white —
  // reversed-out text on a dark header bar is the single most common thing in
  // real documents, and treating it as an attack makes the detector useless.
  const painted = [];
  let pendingPath = null;

  const hit = (x, y) => {
    for (let i = painted.length - 1; i >= 0; i--) {
      const p = painted[i];
      if (x >= p.box[0] && x <= p.box[2] && y >= p.box[1] && y <= p.box[3]) return p.lum;
    }
    return null;
  };

  /**
   * The background a run is actually painted over.
   *
   * Sampling the origin alone is wrong: the origin is the baseline, and glyphs
   * sit above it, so a banner whose lower edge is the baseline is missed and its
   * white text is reported as concealed. Real documents put reversed-out text in
   * exactly that position, so the probe walks up through the glyph body and
   * along the run before concluding there is nothing behind it.
   */
  const backgroundAt = (x, y, size) => {
    const h = Math.max(size, 6);
    for (const dy of [h * 0.35, h * 0.7, 0, -h * 0.15]) {
      for (const dx of [0, h, h * 4]) {
        const lum = hit(x + dx, y + dy);
        if (lum !== null) return lum;
      }
    }
    return 1; // an unpainted page is white
  };

  const push = (text) => {
    if (!text || !text.trim()) return;
    const full = mul(tm, ctm);
    const effSize = Math.abs(fontSize) * scaleOf(full);
    const x = full[4];
    const y = full[5];

    const lum = relLuminance(fill);
    const bg = backgroundAt(x, y, effSize);
    const ratio = contrast(lum, bg);
    const reasons = [];
    // Modes 3 and 7 paint nothing at all — the classic "invisible ink" of OCR
    // layers, and the single most common way to smuggle text past a human.
    if (renderMode === 3 || renderMode === 7) reasons.push('text render mode ' + renderMode + ' (paints no glyphs)');
    if (alpha <= ALPHA_FLOOR) reasons.push('fill alpha ' + alpha.toFixed(2));
    if (ratio < CONTRAST_FLOOR) {
      reasons.push('contrast ratio ' + ratio.toFixed(2) + ':1 against the ' +
        (bg >= 0.9 ? 'white page' : 'fill painted behind it') + ' (needs 1.15 to be legible)');
    }
    if (effSize > 0 && effSize < TINY_PT) reasons.push('effective font size ' + effSize.toFixed(2) + 'pt');
    const offPage = x < view[0] - 2 || x > view[2] + 2 || y < view[1] - 2 || y > view[3] + 2;
    if (offPage) reasons.push('drawn at (' + x.toFixed(0) + ', ' + y.toFixed(0) + '), outside the page box');

    runs.push({
      text,
      x, y,
      size: Number(effSize.toFixed(2)),
      fill: Array.from(fill, (v) => Number(v.toFixed(3))),
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
      // constructPath carries [pathOps, coords, bbox]; the fill op that follows is
      // what actually puts ink on the page, so the rectangle is only recorded then.
      case OPS.constructPath:
        pendingPath = Array.isArray(args?.[2]) && args[2].length === 4 ? args[2] : null;
        break;
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        if (pendingPath) {
          painted.push({ box: bboxToDevice(pendingPath, ctm), lum: relLuminance(fill) });
          pendingPath = null;
        }
        break;
      case OPS.endPath: pendingPath = null; break;

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
  // stop pdf.js warning on every document. Under a bundler, require.resolve
  // answers with a virtual path that exists only inside the bundle graph, and
  // handing that to pdf.js swaps one harmless warning for a noisier one — so the
  // directory is used only when it is a real one on disk.
  let standardFontDataUrl;
  try {
    const dir = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, 'standard_fonts/');
    standardFontDataUrl = existsSync(dir) ? dir : undefined;
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
