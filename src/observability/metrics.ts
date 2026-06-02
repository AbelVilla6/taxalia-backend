type LabelKey = string;

interface Counter {
  value: number;
  labels: Map<LabelKey, number>;
}

const counters = new Map<string, Counter>();

function ensure(name: string): Counter {
  let c = counters.get(name);
  if (!c) {
    c = { value: 0, labels: new Map() };
    counters.set(name, c);
  }
  return c;
}

export function inc(
  name: string,
  labels: Record<string, string> = {},
  delta = 1,
): void {
  const counter = ensure(name);
  counter.value += delta;
  const key = Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(',');
  counter.labels.set(key, (counter.labels.get(key) ?? 0) + delta);
}

export interface MetricEntry {
  name: string;
  value: number;
  labels: Record<string, string>[];
}

export function snapshot(): MetricEntry[] {
  const out: MetricEntry[] = [];
  for (const [name, counter] of counters) {
    out.push({ name, value: counter.value, labels: [] });
    for (const [labelKey, value] of counter.labels) {
      const labels: Record<string, string> = {};
      if (labelKey) {
        for (const part of labelKey.split(',')) {
          const [k, v] = part.split('=');
          if (k && v !== undefined) labels[k] = v;
        }
      }
      out.push({ name, value, labels: [labels] });
    }
  }
  return out;
}

export function resetMetrics(): void {
  counters.clear();
}
