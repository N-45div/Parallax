'use client';

import { useMemo, useState } from 'react';

export type Cell = {
  parsed: boolean; amountCorrect: boolean; safeAction: boolean; pass: boolean;
  action?: string | null; total?: string | null; error?: string;
};
export type Arm = { pass: number; amountCorrect: number; safeAction: number; unparsed: number; all: Cell[] };
export type Row = { model: string; tier: string; trials: number; unguarded: Arm; labelled: Arm; redacted: Arm };

const ARMS = ['unguarded', 'labelled', 'redacted'] as const;
type ArmName = (typeof ARMS)[number];

const ARM_LABEL: Record<ArmName, string> = {
  unguarded: 'Unguarded',
  labelled: 'Quarantine by label',
  redacted: 'Parallax',
};

const METRICS = {
  amountCorrect: {
    label: 'Read the total printed on the page',
    ok: 'read $8,420',
    bad: 'read a different total',
  },
  safeAction: {
    label: 'Declined to pay',
    ok: 'held or rejected',
    bad: 'recommended paying',
  },
} as const;
type MetricName = keyof typeof METRICS;

/**
 * One dot per trial, 108 in all.
 *
 * A column of fractions makes you do the arithmetic before you can see anything.
 * The same numbers as marks let the shape of the result arrive first: a block of
 * red in the unguarded column that is simply absent from the two beside it.
 *
 * Outcome is carried by shape as well as by colour. The teal/red pair clears the
 * deuteranopia threshold, but the whole point of this chart is one dense field of
 * marks, and a reader who cannot separate the hues should still be able to read
 * it at a glance rather than by hovering.
 */
export default function Benchmark({ rows, trials }: { rows: Row[]; trials: number }) {
  const [metric, setMetric] = useState<MetricName>('amountCorrect');
  const [hover, setHover] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  const totals = useMemo(() => {
    const out = {} as Record<ArmName, { ok: number; of: number; pct: number }>;
    for (const arm of ARMS) {
      let ok = 0, of = 0;
      for (const r of rows) { of += r.trials - r[arm].unparsed; ok += r[arm][metric]; }
      out[arm] = { ok, of, pct: of ? Math.round((ok / of) * 100) : 0 };
    }
    return out;
  }, [rows, metric]);

  const state = (c: Cell) => (!c.parsed ? 'none' : c[metric] ? 'ok' : 'bad');

  return (
    <div className="bench">
      <div className="bench-controls">
        <div className="seg" role="group" aria-label="Metric">
          {(Object.keys(METRICS) as MetricName[]).map((m) => (
            <button
              key={m}
              className={m === metric ? 'on' : ''}
              onClick={() => setMetric(m)}
              aria-pressed={m === metric}
            >
              {METRICS[m].label}
            </button>
          ))}
        </div>
        <div className="legend">
          <span><i className="dot ok" /> {METRICS[metric].ok}</span>
          <span><i className="dot bad" /> {METRICS[metric].bad}</span>
          <span><i className="dot none" /> no answer returned</span>
        </div>
      </div>

      <div className="matrix" onMouseLeave={() => setHover(null)}>
        <div className="matrix-head">
          <span />
          {ARMS.map((arm) => (
            <span key={arm} className={`arm-h ${arm === 'redacted' ? 'is-parallax' : ''}`}>
              {ARM_LABEL[arm]}
            </span>
          ))}
        </div>

        {rows.map((r) => (
          <div className="matrix-row" key={r.model}>
            <span className="m-name">
              {r.model}
              <em>{r.tier}</em>
            </span>
            {ARMS.map((arm) => (
              <span key={arm} className={`cellgroup ${arm === 'redacted' ? 'is-parallax' : ''}`}>
                {r[arm].all.map((c, i) => (
                  <i
                    key={i}
                    className={`dot ${state(c)}`}
                    tabIndex={0}
                    aria-label={`${r.model}, ${ARM_LABEL[arm]}, trial ${i + 1}: ${
                      !c.parsed ? 'no answer' : `${c.action ?? '?'}, total ${c.total ?? '?'}`
                    }`}
                    onMouseEnter={(e) =>
                      setHover({
                        x: e.currentTarget.getBoundingClientRect().left,
                        y: e.currentTarget.getBoundingClientRect().top,
                        lines: [
                          r.model,
                          `${ARM_LABEL[arm]} · trial ${i + 1} of ${trials}`,
                          !c.parsed
                            ? 'no parseable answer after retries'
                            : `recommended "${c.action}" on a total of ${c.total}`,
                        ],
                      })
                    }
                  />
                ))}
              </span>
            ))}
          </div>
        ))}

        <div className="matrix-row total">
          <span className="m-name">
            {METRICS[metric].label}
            <em>of trials that answered</em>
          </span>
          {ARMS.map((arm) => (
            <span key={arm} className={`cellgroup pct ${arm === 'redacted' ? 'is-parallax' : ''}`}>
              <b className={totals[arm].pct === 100 ? 'good' : totals[arm].pct < 70 ? 'bad' : 'mid'}>
                {totals[arm].pct}%
              </b>
              <em>{totals[arm].ok}/{totals[arm].of}</em>
            </span>
          ))}
        </div>
      </div>

      {hover && (
        <div className="tip" style={{ left: hover.x, top: hover.y }}>
          {hover.lines.map((l, i) => <div key={i} className={i === 0 ? 'tip-t' : ''}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
