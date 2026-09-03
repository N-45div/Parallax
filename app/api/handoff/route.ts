import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore - plain-JS engine
import { analyze } from '@/lib/analyze.mjs';
// @ts-ignore
import { sendForSignature, esignConfigured } from '@/lib/esign.mjs';

export const runtime = 'nodejs';
export const maxDuration = 180;

/**
 * The signature handoff, and the gate in front of it.
 *
 * Foxit keeps signing out of the agent's tool catalogue so that a person has to
 * approve anything that gets signed. That boundary is right, and it is drawn too
 * late: a person approving a signature is shown the rendered page, never the
 * content stream, so on a tampered document they confirm precisely the thing
 * they cannot see.
 *
 * So the document is read first. Only a file whose readings agree ever becomes an
 * eSign envelope. On anything else this route returns the reasons and calls
 * nothing — the interesting half of a handoff is the half that does not happen.
 */
export async function POST(req: NextRequest) {
  try {
    if (!esignConfigured(process.env)) {
      return NextResponse.json({ error: 'Foxit eSign is not configured' }, { status: 503 });
    }

    // Any uploaded file, not just the two fixtures. Gating this on documents we
    // happened to host meant nobody testing their own PDF ever saw the handoff.
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'no file supplied' }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const report = await analyze(bytes, process.env, { withEvidence: false });

    if (report.verdict.decision !== 'SIGN') {
      return NextResponse.json({
        sent: false,
        verdict: report.verdict,
        findings: report.findings,
        concealed: report.views.concealed.length,
        explanation:
          report.verdict.decision === 'INCONCLUSIVE'
            ? 'Parallax did not call the eSign API. It could not read this document well enough to have an ' +
              'opinion, and an envelope nobody can vouch for is worse than no envelope.'
            : 'Parallax did not call the eSign API. This document carries text no human reviewer can see, so a ' +
              'person approving the signature would be confirming terms that are not on the page in front of ' +
              'them. The handoff is refused before an envelope exists.',
      });
    }

    const signer = {
      email: (form.get('signerEmail') as string) || process.env.PARALLAX_SIGNER_EMAIL || 'ndivij2004@gmail.com',
      first: (form.get('signerFirst') as string) || 'Divij',
      last: (form.get('signerLast') as string) || 'N',
    };

    const sent = await sendForSignature({
      bytes,
      fileName: file.name || 'document.pdf',
      signerEmail: signer.email,
      signerFirst: signer.first,
      signerLast: signer.last,
      subject: `Parallax cleared — ${file.name || 'document.pdf'}`,
    }, process.env);

    return NextResponse.json({
      sent: true,
      verdict: report.verdict,
      findings: report.findings,
      folderId: sent.folderId,
      status: sent.status,
      signingUrl: sent.signingUrl,
      explanation:
        'The readings of this file agree, so it was handed to the Foxit eSign API and is now waiting on a ' +
        'human signature. Parallax does not sign it — it only decides whether a person should be asked to.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
