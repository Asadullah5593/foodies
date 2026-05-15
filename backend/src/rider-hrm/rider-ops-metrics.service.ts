import { Injectable } from '@nestjs/common';

@Injectable()
export class RiderOpsMetricsService {
    private readonly counters = new Map<string, number>();
    private readonly gauges = new Map<string, number>();
    private readonly samples = new Map<string, number[]>();

    inc(counter: string, by = 1) {
        this.counters.set(counter, (this.counters.get(counter) ?? 0) + by);
    }

    setGauge(name: string, value: number) {
        this.gauges.set(name, value);
    }

    observe(name: string, value: number) {
        const arr = this.samples.get(name) ?? [];
        arr.push(value);
        if (arr.length > 500) arr.shift();
        this.samples.set(name, arr);
    }

    private p95(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.ceil(sorted.length * 0.95) - 1;
        return sorted[Math.max(0, idx)];
    }

    snapshot() {
        const sampleStats: Record<string, { count: number; p95: number }> = {};
        for (const [k, arr] of this.samples.entries()) {
            sampleStats[k] = { count: arr.length, p95: this.p95(arr) };
        }
        return {
            counters: Object.fromEntries(this.counters.entries()),
            gauges: Object.fromEntries(this.gauges.entries()),
            samples: sampleStats,
            generated_at: new Date().toISOString(),
        };
    }
}
