import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore - plain-JS engine
import { analyze } from '@/lib/analyze.mjs';
// @ts-ignore
import { sendForSignature, esignConfigured } from '@/lib/esign.mjs';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * The signature handoff, and the gate in front of it.
 *
 * Foxit keeps signing out of the agent's tool catalogue so that a person has to
 * approve anything that gets signed. That boundary is right, and it is drawn too
 * late: a person approving a signature is shown the rendered page, never the
 * content stream, so on a tampered document they confirm precisely the thing
 * they cannot see.
 *
 * So the document is read four ways first. Only a file whose readings agree ever
 * becomes an eSign envelope. On REFUSE this route returns the reasons and calls
 * nothing — the interesting half of a handoff is the half that does not happen.
 */
export async function POST(req: NextRequest) {
  try {
    if (!esignConfigured(process.env)) {
      return NextResponse.json({ error: 'Foxit eSign is not configured' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const fixture = body?.fixture === 'attack' ? 'attack' : body?.fixture === 'clean' ? 'clean' : null;
    if (!fixture) {
      return NextResponse.json({ error: 'fixture must be "clean" or "attack"' }, { status: 400 });
    }

    // eSign fetches the file itself, so it has to be reachable by URL. The
    // origin is taken from the request rather than configured, so this works
    // identically on a preview deployment and in production.
    const origin = req.nextUrl.origin;
    const fileName = `invoice-${fixture}.pdf`;
    const fileUrl = `${origin}/fixtures/${fileName}`;

    const bytes = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());
    const report = await analyze(bytes, process.env, { withEvidence: false });

    if (report.verdict.decision !== 'SIGN') {
      return NextResponse.json({
        sent: false,
        verdict: report.verdict,
        findings: report.findings,
        concealed: report.views.concealed.length,
        explanation:
          'Parallax did not call the eSign API. The document carries text no human reviewer can see, so a ' +
          'person approving this signature would be confirming terms that are not on the page in front of them. ' +
          'The handoff is refused before an envelope exists.',
      });
    }

    const signer = {
      email: body?.signerEmail || process.env.PARALLAX_SIGNER_EMAIL || 'ndivij2004@gmail.com',
      first: body?.signerFirst || 'Divij',
      last: body?.signerLast || 'N',
    };

    const sent = await sendForSignature({
      fileUrl,
      fileName,
      signerEmail: signer.email,
      signerFirst: signer.first,
      signerLast: signer.last,
      subject: `Parallax cleared — ${fileName}`,
    }, process.env);

    return NextResponse.json({
      sent: true,
      verdict: report.verdict,
      findings: report.findings,
      folderId: sent.folderId,
      status: sent.status,
      signingUrl: sent.signingUrl,
      explanation:
        'All four readings of this file agree, so it was handed to the Foxit eSign API and is now waiting on a ' +
        'human signature. Parallax does not sign it — it only decides whether a person should be asked to.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
