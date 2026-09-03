/**
 * A concurrency pool.
 *
 * Dispatching the whole cross product at once looked like the simple choice and
 * quietly wrecked the measurement: 180 simultaneous calls push the provider into
 * rate limiting, and a rate-limited trial returns nothing. Nearly half the cells
 * came back unparsed, so every published rate rested on well under half the data
 * — a throughput decision masquerading as a result about models.
 *
 * Trials are repeated measurements, not a benchmark of how fast we can talk to
 * an API, so they run steadily instead.
 */
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}
