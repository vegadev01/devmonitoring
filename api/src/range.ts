// Maps a ?range=1h|6h|24h|7d|30d query to a start date and a bucket size for downsampling.
const RANGES: Record<string, { ms: number; bucketMs: number }> = {
  "1h": { ms: 3600e3, bucketMs: 60e3 },
  "6h": { ms: 6 * 3600e3, bucketMs: 5 * 60e3 },
  "24h": { ms: 24 * 3600e3, bucketMs: 15 * 60e3 },
  "7d": { ms: 7 * 86400e3, bucketMs: 2 * 3600e3 },
  "30d": { ms: 30 * 86400e3, bucketMs: 8 * 3600e3 },
};

export function parseRange(q: unknown) {
  const r = RANGES[String(q)] ?? RANGES["24h"];
  return { since: new Date(Date.now() - r.ms), bucketMs: r.bucketMs };
}

export function downsample<T extends { createdAt: Date }>(rows: T[], bucketMs: number, fields: (keyof T)[]) {
  const buckets = new Map<number, { n: Record<string, number>; sum: Record<string, number>; t: number }>();
  for (const row of rows) {
    const key = Math.floor(row.createdAt.getTime() / bucketMs) * bucketMs;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { n: {}, sum: {}, t: key }));
    for (const f of fields) {
      const v = row[f];
      if (typeof v === "number") {
        b.sum[f as string] = (b.sum[f as string] ?? 0) + v;
        b.n[f as string] = (b.n[f as string] ?? 0) + 1;
      }
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.t - b.t)
    .map((b) => {
      const out: Record<string, number | null> = { t: b.t };
      for (const f of fields) out[f as string] = b.n[f as string] ? b.sum[f as string] / b.n[f as string] : null;
      return out;
    });
}
