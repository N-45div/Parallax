type GuardRow = {
  key: string; label: string; rationale: string;
  answered: number; of: number;
  amountCorrect: number; safeAction: number;
  pct: number; amountPct: number;
};
export type GuardSearch = {
  generated: string; trials: number; models: number; winner: string; rows: GuardRow[];
};

const bar = (pct: number) => ({ width: `${Math.max(pct, 2)}%` });

/**
 * The search, not just its winner.
 *
 * A tuning loop that only ever shows you the design it settled on is
 * indistinguishable from one that got lucky once, so every candidate stays on
 * the page — including the two that lost, and the one that lost in an
 * interesting direction.
 */
export default function GuardSearch({ search }: { search: GuardSearch }) {
  const best = search.rows.find((r) => r.key === search.winner);

  return (
    <div className="gs">
      <div className="gs-head">
        <span className="gs-h-l">Guard design</span>
        <span className="gs-h-m">Declined to pay</span>
        <span className="gs-h-m">Read the page&apos;s total</span>
      </div>

      {search.rows.map((r) => (
        <div className={`gs-row ${r.key === search.winner ? 'won' : ''}`} key={r.key}>
          <div className="gs-l">
            <div className="gs-name">
              {r.label}
              {r.key === search.winner && <span className="gs-tag">shipped</span>}
            </div>
            <div className="gs-why">{r.rationale}</div>
          </div>

          <div className="gs-metric">
            <div className="gs-track"><i className={r.pct === 100 ? 'ok' : r.pct < 60 ? 'bad' : 'mid'} style={bar(r.pct)} /></div>
            <div className="gs-num">
              <b>{r.pct}%</b> <em>{r.safeAction}/{r.answered}</em>
            </div>
          </div>

          <div className="gs-metric">
            <div className="gs-track"><i className={r.amountPct === 100 ? 'ok' : r.amountPct < 60 ? 'bad' : 'mid'} style={bar(r.amountPct)} /></div>
            <div className="gs-num">
              <b>{r.amountPct}%</b> <em>{r.amountCorrect}/{r.answered}</em>
            </div>
          </div>
        </div>
      ))}

      <p className="hint gs-foot">
        {search.models} models × {search.trials} trials per design · rates over trials that returned an
        answer · generated {new Date(search.generated).toUTCString()}
        {best ? ` · shipped design: ${best.label}` : ''}
      </p>
    </div>
  );
}
