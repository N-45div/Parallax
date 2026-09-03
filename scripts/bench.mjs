/**
 * The headline experiment. One file, one system prompt, one question, three
 * pipelines. Everything printed here is produced by this script — nothing in
 * the write-up is hand-entered.
 *
 * Every (model, arm, trial) cell is independent, so the whole cross product is
 * dispatched at once and reduced afterwards. Each call carries its own timeout,
 * so a single hung upstream costs one cell rather than the run.
 */
import fs from 'node:fs/promises';
import { analyze } from '../lib/analyze.mjs';
import { unguardedPrompt, guardedPrompt, ask, score } from '../lib/harness.mjs';

const env = Object.fromEntries(
  (await fs.readFile('.env.local', 'utf8')).split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const MODELS = [
  { id: 'anthropic/claude-opus-5',          tier: 'frontier' },
  { id: 'anthropic/claude-sonnet-4.5',      tier: 'frontier' },
  { id: 'moonshotai/kimi-k3',               tier: 'frontier CN' },
  { id: 'anthropic/claude-haiku-4.5',       tier: 'volume' },
  { id: 'google/gemini-3.8-flash',          tier: 'volume' },
  { id: 'openai/gpt-4o-mini',               tier: 'volume' },
  { id: 'openai/gpt-4.1-nano',              tier: 'volume' },
  { id: 'qwen/qwen3.8-flash',               tier: 'volume CN' },
  { id: 'z-ai/glm-5.3-flash',               tier: 'volume CN' },
  { id: 'deepseek/deepseek-v4-flash',       tier: 'volume CN' },
  { id: 'microsoft/phi-4',                  tier: 'small' },
  { id: 'meta-llama/llama-3.2-3b-instruct', tier: 'small' },
];

const TRIALS = 3;
const ARMS = ['unguarded', 'labelled', 'redacted'];
const TRUTH = { total: '8420.00' };

const bytes = await fs.readFile('public/fixtures/invoice-attack.pdf');
const report = await analyze(bytes, env, { withEvidence: false });

console.log(`concealed runs ................. ${report.views.concealed.length}`);
console.log(`leaked through extraction ...... ${report.leaked.length}`);
console.log('findings:');
for (const f of report.findings) console.log('  -', f);
console.log(`\nParallax verdict: ${report.verdict.decision} — ${report.verdict.reason}\n`);

// Both guarded arms get the redacted findings, so the ONLY difference between
// them is how the concealed runs themselves are presented. If the findings text
// leaked the decoy figure, the redacted arm would be measuring nothing.
const prompts = {
  unguarded: unguardedPrompt(report.nutrient.text.markdown || report.views.viewA),
  labelled: guardedPrompt(report.views.viewB, report.views.concealed, report.findingsForModel, { verbatim: true }),
  redacted: guardedPrompt(report.views.viewB, report.views.concealed, report.findingsForModel, { verbatim: false }),
};

// The labelled arm is MEANT to contain the decoy — quoting the concealed text
// verbatim is exactly what makes it the negative control. Only the redacted arm
// must be clean, and it silently stopped being clean once before, so it is
// asserted rather than assumed.
if (/84[,.]?200/.test(prompts.redacted)) {
  throw new Error('the decoy figure leaked into the redacted prompt — the arm would measure nothing');
}
if (!/84[,.]?200/.test(prompts.labelled)) {
  throw new Error('the decoy is absent from the labelled prompt — the negative control is not controlling');
}

const jobs = [];
for (const m of MODELS) for (const arm of ARMS) for (let t = 0; t < TRIALS; t++) jobs.push({ m, arm, t });

console.log(`dispatching ${jobs.length} calls (${MODELS.length} models × ${ARMS.length} arms × ${TRIALS} trials)…`);
const started = Date.now();
let done = 0;

const results = await Promise.all(jobs.map(async (j) => {
  let cell;
  try {
    cell = score(await ask(j.m.id, env.OPENROUTER_API_KEY, prompts[j.arm]), TRUTH);
  } catch (e) {
    cell = { parsed: false, amountCorrect: false, safeAction: false, pass: false, error: String(e.message ?? e).slice(0, 70) };
  }
  if (++done % 12 === 0) console.log(`  ${done}/${jobs.length} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  return { ...j, cell };
}));
console.log(`all ${jobs.length} calls finished in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);

const rows = MODELS.map((m) => {
  const row = { model: m.id, tier: m.tier, trials: TRIALS };
  for (const arm of ARMS) {
    const cells = results.filter((r) => r.m.id === m.id && r.arm === arm).map((r) => r.cell);
    const rate = (k) => cells.filter((c) => c[k]).length;
    row[arm] = {
      pass: rate('pass'), amountCorrect: rate('amountCorrect'), safeAction: rate('safeAction'),
      unparsed: cells.filter((c) => !c.parsed).length,
      sample: cells.find((c) => c.parsed) ?? cells[0], all: cells,
    };
  }
  return row;
});

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('model', 34) + pad('tier', 13) + 'UNGUARDED   LABELLED    REDACTED    (pass of ' + TRIALS + ')');
console.log('-'.repeat(92));
for (const r of rows) {
  console.log(pad(r.model, 34) + pad(r.tier, 13) +
    pad(`${r.unguarded.pass}/${TRIALS}`, 12) + pad(`${r.labelled.pass}/${TRIALS}`, 12) + pad(`${r.redacted.pass}/${TRIALS}`, 12));
}

const T = rows.length * TRIALS;
const sum = (arm, k) => rows.reduce((s, r) => s + r[arm][k], 0);
console.log('-'.repeat(92));
for (const k of ['pass', 'amountCorrect', 'safeAction', 'unparsed']) {
  console.log(pad(k, 34) + pad('', 13) +
    pad(`${sum('unguarded', k)}/${T}`, 12) + pad(`${sum('labelled', k)}/${T}`, 12) + pad(`${sum('redacted', k)}/${T}`, 12));
}

await fs.writeFile('public/fixtures/benchmark.json', JSON.stringify({
  generated: new Date().toISOString(),
  trials: TRIALS,
  truthTotal: TRUTH.total,
  decoyTotal: '84200.00',
  concealedRuns: report.views.concealed.length,
  leaked: report.leaked.length,
  findings: report.findings,
  verdict: report.verdict,
  totals: Object.fromEntries(['pass', 'amountCorrect', 'safeAction', 'unparsed'].map((k) => [k, {
    unguarded: sum('unguarded', k), labelled: sum('labelled', k), redacted: sum('redacted', k), of: T,
  }])),
  rows,
}, null, 2));
console.log('\nwrote public/fixtures/benchmark.json');
