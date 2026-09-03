import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore - plain-JS engine, deliberately runnable outside the bundler too
import { analyze } from '@/lib/analyze.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'no file supplied' }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const report = await analyze(bytes, process.env, { withEvidence: form.get('evidence') !== 'off' });

    // The raw glyph runs are large and only the concealed ones are interesting
    // to the client; everything else is summarised before it crosses the wire.
    return NextResponse.json({
      filename: file.name,
      pages: report.views.pages,
      runCount: report.views.runs.length,
      viewA: report.views.viewA,
      viewB: report.views.viewB,
      concealed: report.views.concealed,
      structure: (report.nutrient.structure.elements ?? []).map((e: any) => ({
        role: e.role, text: e.text.slice(0, 160), readingOrder: e.readingOrder, confidence: e.confidence,
      })),
      extractedMarkdown: report.nutrient.text.markdown ?? '',
      leaked: report.leaked,
      domain: report.domain ?? null,
      findings: report.findings,
      evidence: report.evidence,
      verdict: report.verdict,
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
