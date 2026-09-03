/**
 * Rewrites the generated tables in README.md from the run artefacts.
 *
 * These numbers were hand-typed and drifted twice: once when the fixtures
 * changed, and once when the benchmark started measuring a guard we no longer
 * shipped. A README that disagrees with the live page is worse than one with no
 * numbers in it, so the tables are now owned by this script.
 */
import fs from 'node:fs/promises';

const bench = JSON.parse(await fs.readFile('public/fixtures/benchmark.json', 'utf8'));
const guards = JSON.parse(await fs.readFile('public/fixtures/guard-search.json', 'utf8'));

const ARMS = ['unguarded', 'labelled', 'redacted'];
const rate = (arm, metric) => {
  let ok = 0, of = 0;
  for (const r of bench.rows) { of += r.trials - r[arm].unparsed; ok += r[arm][metric]; }
  return { pct: of ? Math.round((ok / of) * 100) : 0, ok, of };
};
const cell = (arm, metric, bold) => {
  const { pct, ok, of } = rate(arm, metric);
  const t = `${pct}% (${ok}/${of})`;
  return bold ? `**${t}**` : t;
};

const benchTable = [
  '| | Unguarded | Quarantine by label | **Parallax** |',
  '|---|---|---|---|',
  `| Read the page's total | ${cell('unguarded', 'amountCorrect')} | ${cell('labelled', 'amountCorrect')} | ${cell('redacted', 'amountCorrect', true)} |`,
  `| Declined to pay | ${cell('unguarded', 'safeAction')} | ${cell('labelled', 'safeAction')} | ${cell('redacted', 'safeAction', true)} |`,
  '',
  `<sub>${bench.rows.length} models × ${bench.trials} trials × 3 arms = ${bench.rows.length * bench.trials * 3} live calls · rates over trials that returned a parseable answer · the Parallax column is the guard the product actually ships, selected by the search below · generated ${bench.generated}</sub>`,
].join('\n');

const guardTable = [
  '| Guard design | Declined to pay | Read the page\'s total |',
  '|---|---|---|',
  ...guards.rows.map((r) => {
    const win = r.key === guards.winner;
    const name = win ? `**${r.label}**` : r.label;
    const d = win ? `**${r.pct}%**` : `${r.pct}%`;
    const a = r.amountPct === 100 ? `**${r.amountPct}%**` : `${r.amountPct}%`;
    return `| ${name} | ${d} | ${a} |`;
  }),
  '',
  `<sub>${guards.models} models × ${guards.trials} trials per design · generated ${guards.generated}</sub>`,
].join('\n');

let md = await fs.readFile('README.md', 'utf8');
// Spliced by index rather than by pattern. Inside a template literal `\s`
// collapses to a bare `s`, so the obvious `[\s\S]*?` became `[sS]*?` and
// matched nothing but the letter s — the markers were there the whole time.
const put = (tag, body) => {
  const open = `<!-- ${tag}:start -->`;
  const close = `<!-- ${tag}:end -->`;
  const a = md.indexOf(open);
  const b = md.indexOf(close, a);
  if (a === -1 || b === -1) throw new Error(`missing ${tag} markers in README.md`);
  md = `${md.slice(0, a)}${open}\n${body}\n${md.slice(b)}`;
};
put('BENCH', benchTable);
put('GUARDS', guardTable);
await fs.writeFile('README.md', md);

console.log('README tables synced from the run artefacts');
console.log(`  read the total : ${ARMS.map((a) => rate(a, 'amountCorrect').pct + '%').join(' → ')}`);
console.log(`  declined to pay: ${ARMS.map((a) => rate(a, 'safeAction').pct + '%').join(' → ')}`);
console.log(`  guard winner   : ${guards.winner}`);
