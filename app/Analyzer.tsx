'use client';

import { useCallback, useRef, useState } from 'react';

type Run = {
  text: string; reasons: string[]; page: number; x: number; y: number;
  size: number; alpha: number; renderMode: number; fill: number[];
};
type Claim = {
  id: string; label: string; value: string; kind: string; ok: boolean;
  results: { title: string; link: string; snippet: string }[];
};
type Domain = {
  domain: string; registered?: boolean | null; verdict?: 'unregistered' | 'lookalike' | 'clear';
  checked?: number; note?: string; skipped?: string; error?: string;
  neighbours?: { domain: string; shorterCore?: boolean }[];
};
type Confidence = {
  top: { text: string; confidence: number; concealed: boolean };
  bottom: { text: string; confidence: number; concealed: boolean };
  range: [number, number]; elements: number;
};
type Handoff = {
  sent: boolean; explanation: string; folderId?: number | null;
  status?: string | null; signingUrl?: string | null; error?: string;
};
type Report = {
  filename: string; pages: number; runCount: number; domain?: Domain | null;
  confidence?: Confidence | null;
  viewA: string; viewB: string;
  concealed: Run[];
  structure: { role: string; text: string; readingOrder: number; confidence: number }[];
  extractedMarkdown: string;
  leaked: Run[];
  findings: string[];
  evidence: Claim[];
  verdict: { decision: 'REFUSE' | 'HOLD' | 'SIGN' | 'INCONCLUSIVE'; reason: string };
  error?: string;
};

/** Marks the concealed runs inside the ingest layer so the payload is visible at a glance. */
function highlight(text: string, runs: Run[]) {
  if (!runs.length) return text;
  const needles = runs.map((r) => r.text).filter((t) => t.length > 8).sort((a, b) => b.length - a.length);
  const parts: (string | { hl: string })[] = [text];

  for (const n of needles) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (typeof p !== 'string') continue;
      const at = p.indexOf(n);
      if (at === -1) continue;
      parts.splice(i, 1, p.slice(0, at), { hl: n }, p.slice(at + n.length));
      i += 2;
    }
  }
  return parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <mark className="hl" key={i}>{p.hl}</mark>));
}

export default function Analyzer() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cert, setCert] = useState<{ url: string; ref: string } | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<{ blob: Blob; name: string } | null>(null);

  const send = useCallback(async (blob: Blob, name: string, label: string) => {
    setBusy(label); setError(null); setReport(null); setCert(null); setHandoff(null);
    lastFile.current = { blob, name };
    try {
      const fd = new FormData();
      fd.append('file', blob, name);
      const res = await fetch('/api/analyze', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setReport(json);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }, []);

  const runFixture = useCallback(async (which: 'attack' | 'clean') => {
    const label = which === 'attack' ? 'Reading the tampered invoice' : 'Reading the clean invoice';
    setBusy(label);
    try {
      const res = await fetch(`/fixtures/invoice-${which}.pdf`);
      await send(await res.blob(), `invoice-${which}.pdf`, label);
    } catch (e: any) {
      setError(String(e?.message ?? e)); setBusy(null);
    }
  }, [send]);

  return (
    <>
      <div className="section" id="run">
        <div className="section-head">
          <span className="section-n">03</span>
          <h2>Read a document</h2>
        </div>
        <p className="section-sub">
          Two invoices, identical on screen. One has four runs of text hidden inside it by four different
          techniques. <strong>Open both in any PDF reader first</strong> — they look the same, because to a
          human they are the same. Then read them here.
        </p>

        <div className="hero-cta" style={{ marginTop: 0 }}>
          <button className="danger" disabled={!!busy} onClick={() => runFixture('attack')}>
            {busy?.includes('tampered') ? <span className="spin" /> : null}
            Read the tampered invoice
          </button>
          <button disabled={!!busy} onClick={() => runFixture('clean')}>
            {busy?.includes('clean') ? <span className="spin" /> : null}
            Read the clean invoice
          </button>
          <button disabled={!!busy} onClick={() => fileRef.current?.click()}>Upload your own PDF</button>
          <input
            ref={fileRef} type="file" accept="application/pdf" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) send(f, f.name, `Reading ${f.name}`);
              e.target.value = '';
            }}
          />
          <a className="hint" href="/fixtures/invoice-attack.pdf" target="_blank" rel="noreferrer">
            open the tampered PDF ↗
          </a>
        </div>

        {busy && <p className="hint" style={{ marginTop: 16 }}><span className="spin" /> {busy}…</p>}
        {error && <div className="err">{error}</div>}
      </div>

      {report && (
        <>
          <div className="section" style={{ paddingTop: 30 }}>
            <div className="verdict">
              <div className="verdict-head">
                <span className={`stamp ${report.verdict.decision}`}>{report.verdict.decision}</span>
                <span className="verdict-why">{report.verdict.reason}</span>
              </div>
              <div className="verdict-meta">
                <span>{report.filename}</span>
                <span>{report.pages} page{report.pages === 1 ? '' : 's'}</span>
                <span>{report.runCount} glyph runs</span>
                <span>{report.concealed.length} concealed</span>
                <span>{report.leaked.length} leaked through extraction</span>
              </div>
              <div className="verdict-meta" style={{ alignItems: 'center' }}>
                <button
                  disabled={!!busy}
                  onClick={async () => {
                    if (!lastFile.current) return;
                    setBusy('Issuing certificate'); setError(null);
                    try {
                      const fd = new FormData();
                      fd.append('file', lastFile.current.blob, lastFile.current.name);
                      const res = await fetch('/api/certificate', { method: 'POST', body: fd });
                      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
                      const ref = res.headers.get('X-Parallax-Ref') ?? '';
                      setCert({ url: URL.createObjectURL(await res.blob()), ref });
                    } catch (e: any) { setError(String(e?.message ?? e)); }
                    finally { setBusy(null); }
                  }}
                >
                  {busy === 'Issuing certificate' ? <span className="spin" /> : null}
                  Issue the{' '}
                  {report.verdict.decision === 'SIGN'
                    ? 'clearance'
                    : report.verdict.decision === 'INCONCLUSIVE'
                      ? 'inconclusive'
                      : 'refusal'}{' '}
                  certificate
                </button>
                {cert && (
                  <a href={cert.url} target="_blank" rel="noreferrer">
                    open {cert.ref} ↗
                  </a>
                )}
                <span className="hint">
                  rendered and issued through Foxit PDF Services
                </span>
              </div>

              {/* The handoff Foxit's challenge is actually about. On REFUSE the
                  eSign API is never called: the interesting half of a signature
                  handoff is the half that does not happen. */}
              {(
                <div className="verdict-meta" style={{ alignItems: 'center' }}>
                  <button
                    className={report.verdict.decision === 'SIGN' ? 'primary' : ''}
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy('Handing off to eSign'); setError(null); setHandoff(null);
                      try {
                        if (!lastFile.current) return;
                        const fd = new FormData();
                        fd.append('file', lastFile.current.blob, lastFile.current.name);
                        const res = await fetch('/api/handoff', { method: 'POST', body: fd });
                        const json = await res.json();
                        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
                        setHandoff(json);
                      } catch (e: any) { setError(String(e?.message ?? e)); }
                      finally { setBusy(null); }
                    }}
                  >
                    {busy === 'Handing off to eSign' ? <span className="spin" /> : null}
                    Send this document for human signature
                  </button>
                  {handoff && (
                    <span className={handoff.sent ? 'good' : 'bad'} style={{ fontSize: 12.5 }}>
                      {handoff.sent
                        ? `envelope ${handoff.folderId} · ${handoff.status}`
                        : 'eSign was never called'}
                    </span>
                  )}
                  {handoff?.signingUrl && (
                    <a href={handoff.signingUrl} target="_blank" rel="noreferrer">open the signing session ↗</a>
                  )}
                  <span className="hint">Foxit eSign API</span>
                </div>
              )}

              {handoff && (
                <div className={handoff.sent ? 'handoff sent' : 'handoff blocked'}>
                  {handoff.explanation}
                </div>
              )}
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <h2>The same file, read four ways</h2>
            </div>
            <p className="section-sub">
              Every column below is the same PDF. They disagree, and the disagreement is the attack.
            </p>

            <div className="views">
              <div className="view a">
                <div className="view-head">
                  <div className="view-k">View A · ingest</div>
                  <div className="view-t">What the model swallows</div>
                  <div className="view-d">Every glyph in the content stream, in stream order.</div>
                </div>
                <div className="view-body">{highlight(report.viewA, report.concealed)}</div>
              </div>

              <div className="view b">
                <div className="view-head">
                  <div className="view-k">View B · visible</div>
                  <div className="view-t">What the human sees</div>
                  <div className="view-d">Runs surviving colour, alpha, size, render-mode and page-box checks.</div>
                </div>
                <div className="view-body">{report.viewB}</div>
              </div>

              <div className="view c">
                <div className="view-head">
                  <div className="view-k">View C · structural</div>
                  <div className="view-t">What a machine narrates</div>
                  <div className="view-d">Independent layout engine: reading order and semantic role.</div>
                </div>
                <div className="view-body">
                  {report.structure.length
                    ? report.structure.map((el, i) => (
                        <div key={i} style={{ marginBottom: 6 }}>
                          <span className="ro">{String(el.readingOrder).padStart(2, '0')} </span>
                          <span className="role">{el.role}</span>
                          <div>{el.text}</div>
                        </div>
                      ))
                    : 'structural read unavailable'}
                </div>
              </div>

              <div className="view d">
                <div className="view-head">
                  <div className="view-k">View D · extracted</div>
                  <div className="view-t">What the pipeline delivers</div>
                  <div className="view-d">Commercial extraction output — the text a downstream model receives.</div>
                </div>
                <div className="view-body">{highlight(report.extractedMarkdown, report.leaked)}</div>
              </div>
            </div>
          </div>

          {report.concealed.length > 0 && (
            <div className="section">
              <div className="section-head">
                  <h2>What was hidden, and how</h2>
              </div>
              <p className="section-sub">
                Each run below exists in the file and reached the extraction output, but could not be seen by
                anyone reading the page. The reason is measured from the content stream, not guessed.
              </p>
              <div className="runs">
                {report.concealed.map((r, i) => (
                  <div className="run" key={i}>
                    <div className="run-why">{r.reasons.join('  ·  ')}</div>
                    <div className="run-txt">{r.text}</div>
                    <div className="run-meta">
                      <span>page {r.page}</span>
                      <span>({r.x.toFixed(0)}, {r.y.toFixed(0)})</span>
                      <span>{r.size}pt</span>
                      <span>alpha {r.alpha}</span>
                      <span>Tr {r.renderMode}</span>
                      <span>fill [{r.fill.join(', ')}]</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.findings.length > 0 && (
            <div className="section">
              <div className="section-head">
                  <h2>Findings</h2>
              </div>
              <p className="section-sub">
                Derived by comparing the four views. No model is consulted here — every line is reproducible
                from the file alone.
              </p>
              <ul className="findings">
                {report.findings.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          {report.confidence && (
            <div className="section">
              <div className="section-head">
                <h2>What the document engine was most sure about</h2>
              </div>
              <p className="section-sub">
                Nutrient&apos;s understanding pass scores every element it recovers. On a tampered file the
                ranking inverts the thing you would want: certainty about text and visibility of text turn
                out to be unrelated properties.
              </p>
              <div className="conf">
                <div className={`conf-row ${report.confidence.top.concealed ? 'bad' : ''}`}>
                  <span className="conf-n">{report.confidence.top.confidence.toFixed(3)}</span>
                  <span className="conf-t">
                    <em>most confident</em>
                    {report.confidence.top.text}
                  </span>
                  <span className="conf-tag">
                    {report.confidence.top.concealed ? 'no human can see this' : 'on the visible page'}
                  </span>
                </div>
                <div className={`conf-row ${report.confidence.bottom.concealed ? 'bad' : ''}`}>
                  <span className="conf-n">{report.confidence.bottom.confidence.toFixed(3)}</span>
                  <span className="conf-t">
                    <em>least confident</em>
                    {report.confidence.bottom.text}
                  </span>
                  <span className="conf-tag">
                    {report.confidence.bottom.concealed ? 'no human can see this' : 'on the visible page'}
                  </span>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 12 }}>
                {report.confidence.elements} scored elements, confidence {report.confidence.range[0].toFixed(3)}–
                {report.confidence.range[1].toFixed(3)} · a pipeline that routes on confidence alone routes most
                confidently on the content it should not be reading
              </p>
            </div>
          )}

          {report.domain && (
            <div className="section">
              <div className="section-head">
                <h2>The fifth reading: who owns the name on the invoice</h2>
              </div>
              <p className="section-sub">
                A redirect has to touch the counterparty&apos;s identity somewhere, and the domain is the field
                it cannot fake cheaply. Checked against a registrar, so the answer is a fact rather than a ranking.
              </p>
              <div className={`claim domain-${report.domain.verdict ?? 'unknown'}`}>
                <div className="claim-h">
                  <span className="claim-l">{report.domain.domain}</span>
                  {report.domain.verdict && <span className="pill">{report.domain.verdict}</span>}
                  {report.domain.checked && (
                    <span className="claim-v">{report.domain.checked} domains checked</span>
                  )}
                </div>
                <div className="res" style={{ marginTop: 6 }}>
                  {report.domain.note ?? report.domain.skipped ?? report.domain.error}
                </div>
                {!!report.domain.neighbours?.length && (
                  <div className="run-meta" style={{ marginTop: 10 }}>
                    {report.domain.neighbours.slice(0, 8).map((n) => (
                      <span key={n.domain} className={n.shorterCore ? 'bad' : ''}>{n.domain}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {report.evidence?.length > 0 && (
            <div className="section">
              <div className="section-head">
                  <h2>Evidence</h2>
              </div>
              <p className="section-sub">
                Every entity the document asserts is turned into a query against the live web, so the report
                cites sources rather than producing a score.
              </p>
              <div className="claims">
                {report.evidence.map((c) => (
                  <div className="claim" key={c.id}>
                    <div className="claim-h">
                      <span className="claim-l">{c.label}</span>
                      <span className="claim-v">{c.value}</span>
                      <span className="pill">{c.kind}</span>
                    </div>
                    <div className="claim-r">
                      {c.results.length
                        ? c.results.slice(0, 3).map((r, i) => (
                            <div className="res" key={i}>
                              <a href={r.link} target="_blank" rel="noreferrer">{r.title}</a>
                              <p>{r.snippet}</p>
                            </div>
                          ))
                        : <div className="res"><p>No corroborating result returned for this claim.</p></div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
