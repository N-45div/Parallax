import { readFileSync } from 'node:fs';
import { analyze, fieldsFromStructure } from '../lib/analyze.mjs';

for (const f of ['invoice-attack','invoice-clean']) {
  const bytes = readFileSync(`public/fixtures/${f}.pdf`);
  const r = await analyze(bytes, {}, { withEvidence: false });
  console.log('=========', f);
  console.log('CONCEALED:', JSON.stringify(r.views.concealed.map(c=>({t:c.text.slice(0,40), reasons:c.reasons, fill:c.fill, alpha:c.alpha, size:c.size, x:Math.round(c.x), y:Math.round(c.y)})), null, 1));
  console.log('FINDINGS:'); r.findings.forEach(x=>console.log('  * '+x));
  console.log('FOR MODEL:'); r.findingsForModel.forEach(x=>console.log('  * '+x));
  console.log('VERDICT:', JSON.stringify(r.verdict));
  console.log('FIELDS:', JSON.stringify(fieldsFromStructure(null, r.views.viewB)));
  console.log('runs total', r.views.runs.length);
}
