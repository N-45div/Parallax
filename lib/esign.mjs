/**
 * The signature handoff.
 *
 * Foxit's challenge leaves signing out of the agent's tool catalogue on purpose,
 * and invites an argument about where the boundary belongs. Ours is that the
 * boundary they drew is correct but drawn too late.
 *
 * Withholding the signing tool protects against an agent that decides wrongly.
 * It does nothing about an agent that was told something the human was not,
 * because by the time the document reaches a signature the manipulation has
 * already happened — the agent read a total of 84,200 off a page that says
 * 8,420, and every step after that is a well-behaved agent faithfully executing
 * a corrupted premise. A human approving that signature is shown the page, not
 * the content stream, so the human confirms exactly the thing they cannot see.
 *
 * So Parallax puts a second boundary in front of the first. Nothing reaches
 * eSign until the four readings of it agree. On REFUSE the document never
 * becomes an envelope at all, and the only thing that gets signed is the
 * certificate explaining why.
 */

// eSign is reached through the same fusion host as PDF Services, not the
// standalone foxitesign.foxit.com host the guides point at — that one wants an
// OAuth access token and rejects the developer credential pair outright.
const BASE = 'https://na1.fusion.foxit.com';

function creds(env) {
  // eSign is provisioned separately from PDF Services and, once activated, may
  // either issue its own pair or bless the existing one. Accept both rather than
  // making the caller care which.
  const id = env.FOXIT_ESIGN_CLIENT_ID || env.FOXIT_CLIENT_ID;
  const secret = env.FOXIT_ESIGN_CLIENT_SECRET || env.FOXIT_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

export function esignConfigured(env) {
  return creds(env) !== null;
}

/**
 * Sends a cleared document for human signature.
 *
 * @param {object} opts
 * @param {string} opts.fileUrl   publicly reachable URL of the cleared document
 * @param {string} opts.fileName
 * @param {string} opts.signerEmail
 * @param {string} opts.signerFirst
 * @param {string} opts.signerLast
 * @param {string} opts.subject
 */
export async function sendForSignature(opts, env) {
  const c = creds(env);
  if (!c) throw new Error('Foxit eSign is not configured');

  const res = await fetch(`${BASE}/esign/api/v1/folders/createfolder`, {
    method: 'POST',
    headers: { client_id: c.id, client_secret: c.secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderName: opts.subject,
      inputType: 'url',
      fileUrls: [opts.fileUrl],
      fileNames: [opts.fileName],
      parties: [{
        firstName: opts.signerFirst,
        lastName: opts.signerLast,
        emailId: opts.signerEmail,
        permission: 'FILL_FIELDS_AND_SIGN',
        sequence: 1,
      }],
      // The session is created but not emailed. A demo that quietly mails real
      // people is a demo that should not be run twice.
      createEmbeddedSigningSession: true,
      embeddedSignersEmailIds: [opts.signerEmail],
      sendNow: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Foxit eSign ${res.status}: ${text.slice(0, 200)}`);

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Foxit eSign returned non-JSON: ${text.slice(0, 160)}`); }

  const folderId = json?.folder?.folderId ?? json?.folderId ?? null;
  // eSign fetches the document itself, so a URL its servers cannot reach — a
  // localhost origin, most obviously — yields a 200 with nothing attached.
  // Reporting that as a successful handoff would be a lie in the demo's favour.
  if (!folderId) {
    throw new Error(
      `Foxit eSign accepted the request but returned no folder. The document URL must be publicly reachable; ` +
      `it was ${opts.fileUrl}`);
  }

  return {
    folderId,
    status: json?.folderStatus ?? json?.folder?.folderStatus ?? null,
    signingUrl: json?.embeddedSigningSessions?.[0]?.embeddedSessionURL ?? null,
  };
}
