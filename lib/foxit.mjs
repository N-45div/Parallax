/**
 * The Refusal Certificate.
 *
 * The only document Parallax ever signs is the one explaining why it would not
 * sign yours. A verdict that lives in a web page cannot be filed, attached to a
 * payment run, or handed to an auditor eighteen months later, so the refusal is
 * rendered back into the same medium as the thing it refused — and it carries
 * the evidence, not a score.
 */

const BASE = 'https://na1.fusion.foxit.com/pdf-services/api';

function headers(env, json = false) {
  const h = { client_id: env.FOXIT_CLIENT_ID, client_secret: env.FOXIT_CLIENT_SECRET };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Certificates are read under stress, so the layout stays plain and the evidence stays first. */
function certificateHtml(report, meta) {
  const { verdict, findings, concealed, leaked, filename, evidence } = report;

  const runRows = concealed.map((r, i) => `
    <tr>
      <td class="n">${i + 1}</td>
      <td class="why">${esc(r.reasons.join('; '))}</td>
      <td class="pos">p${r.page} · (${r.x.toFixed(0)}, ${r.y.toFixed(0)}) · ${r.size}pt · &alpha;${r.alpha} · Tr${r.renderMode}</td>
    </tr>
    <tr><td></td><td colspan="2" class="txt">${esc(r.text)}</td></tr>`).join('');

  const evidenceRows = (evidence ?? []).slice(0, 5).map((c) => `
    <tr>
      <td class="ev-l">${esc(c.label)}</td>
      <td class="ev-v">${esc(c.value)}</td>
      <td class="ev-s">${c.results?.length
        ? c.results.slice(0, 2).map((r) => `<div>${esc(r.title)}<br><span>${esc(r.link)}</span></div>`).join('')
        : '<span>no corroborating result returned</span>'}</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #14161a; font-size: 10pt; line-height: 1.5; }
  .rule { border-bottom: 2px solid #14161a; margin-bottom: 14px; padding-bottom: 10px; }
  .brand { font-size: 17pt; font-weight: 700; letter-spacing: -0.02em; }
  .sub { font-size: 8.5pt; color: #666d78; margin-top: 3px; letter-spacing: 0.06em; text-transform: uppercase; }
  .stampbox { border: 2.5px solid ${verdict.decision === 'SIGN' ? '#1f7a4d' : '#b23a29'}; border-radius: 5px; padding: 12px 16px; margin: 18px 0; }
  .stamp { font-size: 20pt; font-weight: 700; letter-spacing: 0.09em; color: ${verdict.decision === 'SIGN' ? '#1f7a4d' : '#b23a29'}; }
  .stamp-why { font-size: 10.5pt; margin-top: 5px; color: #2b2f36; }
  h2 { font-size: 9pt; letter-spacing: 0.11em; text-transform: uppercase; color: #666d78; margin: 20px 0 7px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 5px 7px; border-bottom: 0.5pt solid #dfe2e7; font-size: 8.5pt; }
  td.n { width: 16px; color: #8b929c; }
  td.why { color: #b23a29; font-family: "Courier New", monospace; font-size: 8pt; }
  td.pos { font-family: "Courier New", monospace; font-size: 7.5pt; color: #8b929c; text-align: right; white-space: nowrap; }
  td.txt { font-family: "Courier New", monospace; font-size: 8pt; background: #f6f7f9; color: #2b2f36; }
  ol { margin: 0; padding-left: 17px; } ol li { margin-bottom: 5px; }
  .ev-l { font-weight: 600; width: 24%; } .ev-v { font-family: "Courier New", monospace; font-size: 8pt; width: 26%; }
  .ev-s { font-size: 7.5pt; color: #454b54; } .ev-s span { color: #8b929c; }
  .meta { font-family: "Courier New", monospace; font-size: 7.5pt; color: #666d78; }
  .sig { margin-top: 26px; border-top: 1px solid #14161a; padding-top: 10px; display: flex; justify-content: space-between; }
  .sig-b { font-size: 8pt; color: #454b54; max-width: 62%; }
  .sig-l { text-align: right; font-size: 8pt; color: #666d78; }
  .foot { margin-top: 20px; font-size: 7.5pt; color: #8b929c; line-height: 1.5; border-top: 0.5pt solid #dfe2e7; padding-top: 8px; }
  </style></head><body>

  <div class="rule">
    <div class="brand">Parallax — Refusal Certificate</div>
    <div class="sub">Document integrity determination · ${esc(meta.issued)}</div>
  </div>

  <table class="meta"><tr>
    <td>FILE<br><b>${esc(filename)}</b></td>
    <td>GLYPH RUNS<br><b>${report.runCount}</b></td>
    <td>CONCEALED<br><b>${concealed.length}</b></td>
    <td>LEAKED THROUGH EXTRACTION<br><b>${leaked.length}</b></td>
    <td>REFERENCE<br><b>${esc(meta.ref)}</b></td>
  </tr></table>

  <div class="stampbox">
    <div class="stamp">${esc(verdict.decision)}</div>
    <div class="stamp-why">${esc(verdict.reason)}</div>
  </div>

  ${findings.length ? `<h2>Findings</h2><ol>${findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>` : ''}

  ${concealed.length ? `<h2>Concealed text recovered from the content stream</h2>
  <table>${runRows}</table>` : ''}

  ${evidenceRows ? `<h2>Evidence gathered against asserted entities</h2><table>${evidenceRows}</table>` : ''}

  <div class="sig">
    <div class="sig-b">
      This certificate records that the file above carries text which no human reviewer could see, and that
      the concealed text materially alters the terms it presents. It is issued in place of a signature.
      A signature was not applied and no approval is implied.
    </div>
    <div class="sig-l">
      <b>Parallax</b><br>automated determination<br>${esc(meta.issued)}
    </div>
  </div>

  <div class="foot">
    Visibility determined by replaying the PDF content stream through a graphics-state machine — fill colour,
    fill alpha, text render mode, effective point size and page-box position. Structural reading order and
    text extraction by Nutrient DWS. Entity evidence by SerpApi. Rendered and issued through Foxit PDF
    Services. Every determination on this certificate is reproducible from the source file alone.
  </div>
  </body></html>`;
}

async function poll(taskId, env, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${BASE}/tasks/${taskId}`, { headers: headers(env) });
    const json = await res.json();
    if (json.status === 'COMPLETED') return json.resultDocumentId ?? json.documentId;
    if (json.status === 'FAILED') throw new Error(`Foxit task failed: ${JSON.stringify(json).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error('Foxit task did not complete in time');
}

/**
 * @returns {Promise<{pdf:Buffer, ref:string}>}
 */
export async function issueCertificate(report, env) {
  const ref = `PLX-${Date.now().toString(36).toUpperCase()}`;
  const html = certificateHtml(report, { issued: new Date().toUTCString(), ref });

  const form = new FormData();
  form.append('file', new Blob([html], { type: 'text/html' }), 'certificate.html');

  const up = await fetch(`${BASE}/documents/upload`, { method: 'POST', headers: headers(env), body: form });
  if (!up.ok) throw new Error(`Foxit upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
  const { documentId } = await up.json();

  const conv = await fetch(`${BASE}/documents/create/pdf-from-html`, {
    method: 'POST', headers: headers(env, true), body: JSON.stringify({ documentId }),
  });
  if (!conv.ok) throw new Error(`Foxit conversion failed (${conv.status}): ${(await conv.text()).slice(0, 200)}`);
  const { taskId } = await conv.json();

  const resultId = await poll(taskId, env);
  const dl = await fetch(`${BASE}/documents/${resultId}/download`, { headers: headers(env) });
  if (!dl.ok) throw new Error(`Foxit download failed (${dl.status})`);

  return { pdf: Buffer.from(await dl.arrayBuffer()), ref };
}
