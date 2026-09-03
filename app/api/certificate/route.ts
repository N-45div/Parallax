import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore - plain-JS engine
import { analyze } from '@/lib/analyze.mjs';
// @ts-ignore
import { issueCertificate } from '@/lib/foxit.mjs';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'no file supplied' }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const report = await analyze(bytes, process.env, { withEvidence: form.get('evidence') !== 'off' });

    const { pdf, ref } = await issueCertificate(
      { ...report.views, ...report, filename: file.name, runCount: report.views.runs.length },
      process.env,
    );

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="parallax-${ref}.pdf"`,
        'X-Parallax-Ref': ref,
        'X-Parallax-Verdict': report.verdict.decision,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
