import { readFileSync } from 'node:fs';
import { extractViews } from '../lib/views.mjs';
const v = await extractViews(readFileSync('public/fixtures/invoice-attack.pdf'));
for (const r of v.concealed) {
  console.log(JSON.stringify(r.text.slice(0,25)), 'isArray:', Array.isArray(r.fill), 'ctor:', r.fill?.constructor?.name);
}
const wire = JSON.parse(JSON.stringify(v.concealed));
console.log('after JSON round-trip, fill of run0 =', JSON.stringify(wire[0].fill), 'join is', typeof wire[0].fill.join);
try { wire[0].fill.join(', '); console.log('join OK'); } catch (e) { console.log('JOIN THROWS:', e.message); }
// also check every run
let bad = 0; for (const r of JSON.parse(JSON.stringify(v.runs))) if (typeof r.fill.join !== 'function') bad++;
console.log('runs whose fill lost .join():', bad, 'of', v.runs.length);
