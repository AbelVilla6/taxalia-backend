const counters = new Map();
function ensure(name) {
    let c = counters.get(name);
    if (!c) {
        c = { value: 0, labels: new Map() };
        counters.set(name, c);
    }
    return c;
}
export function inc(name, labels = {}, delta = 1) {
    const counter = ensure(name);
    counter.value += delta;
    const key = Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(',');
    counter.labels.set(key, (counter.labels.get(key) ?? 0) + delta);
}
export function snapshot() {
    const out = [];
    for (const [name, counter] of counters) {
        out.push({ name, value: counter.value, labels: [] });
        for (const [labelKey, value] of counter.labels) {
            const labels = {};
            if (labelKey) {
                for (const part of labelKey.split(',')) {
                    const [k, v] = part.split('=');
                    if (k && v !== undefined)
                        labels[k] = v;
                }
            }
            out.push({ name, value, labels: [labels] });
        }
    }
    return out;
}
export function resetMetrics() {
    counters.clear();
}
