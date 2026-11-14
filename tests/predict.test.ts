import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../src/core/dates';
import { analyze, computeStats, median, sampleSD } from '../src/core/predict';
import type { Cycle, Period } from '../src/core/types';
import { SETTINGS, period, periods } from './helpers';

const cyc = (length: number, outlier = false): Cycle => ({ start: '2026-01-01', length, outlier });
const per = (length: number, ongoing = false): Period => ({ start: '2026-01-01', end: '2026-01-01', length, ongoing });

describe('median / sampleSD', () => {
	it('computes the median of odd and even lists', () => {
		expect(median([30, 28, 29])).toBe(29);
		expect(median([28, 29, 30, 60])).toBe(29.5);
		expect(() => median([])).toThrow();
	});

	it('returns a sample SD only for n >= 3', () => {
		expect(sampleSD([28])).toBeNull();
		expect(sampleSD([28, 30])).toBeNull();
		expect(sampleSD([28, 30, 32])).toBeCloseTo(2, 10);
		expect(sampleSD([29, 29, 29])).toBe(0);
	});
});

describe('computeStats', () => {
	it('uses the median, so one long cycle barely moves it', () => {
		// 28, 29, 30, 60 → median 29.5 when 60 is within bounds (max 90)
		const s = computeStats([per(5)], [cyc(28), cyc(29), cyc(30), cyc(60)], SETTINGS);
		expect(s.avgCycleLength).toBe(29.5);
		expect(s.cycleRange).toEqual([28, 60]);
		expect(s.cyclesUsed).toBe(4);
	});

	it('excludes flagged outliers from averages', () => {
		const s = computeStats([per(5)], [cyc(28), cyc(29), cyc(30), cyc(60, true)], SETTINGS);
		expect(s.avgCycleLength).toBe(29);
		expect(s.cycleRange).toEqual([28, 30]);
		expect(s.cycleSD).toBeCloseTo(1, 10);
	});

	it('keeps SD null for fewer than 3 cycles', () => {
		expect(computeStats([per(5)], [cyc(28), cyc(30)], SETTINGS).cycleSD).toBeNull();
	});

	it('uses only the last N valid cycles and completed periods', () => {
		const s = computeStats([per(3), per(9), per(4), per(6)], [cyc(20), cyc(40), cyc(28, true), cyc(30), cyc(32)], {
			...SETTINGS,
			cyclesForAverages: 2,
		});
		expect(s.avgCycleLength).toBe(31); // last 2 valid: 30, 32
		expect(s.avgPeriodLength).toBe(5); // last 2 completed: 4, 6
	});

	it('excludes an ongoing period from the average period length', () => {
		const s = computeStats([per(4), per(2, true)], [], SETTINGS);
		expect(s.avgPeriodLength).toBe(4);
		expect(s.periodsUsed).toBe(1);
	});

	it('falls back to the defaults without data', () => {
		const s = computeStats([], [], { ...SETTINGS, defaultCycleLength: 30, defaultPeriodLength: 4 });
		expect(s).toEqual({ avgCycleLength: 30, cycleSD: null, cycleRange: null, avgPeriodLength: 4, cyclesUsed: 0, periodsUsed: 0 });
	});
});

describe('analyze: confidence states and fallbacks', () => {
	it('0 periods → none, no predictions', () => {
		const a = analyze([{ date: '2026-11-10', symptoms: ['cramps'] }, { date: '2026-11-11', flow: 'spotting' }], SETTINGS, '2026-11-15');
		expect(a.periods).toEqual([]);
		expect(a.prediction.confidence).toBe('none');
		expect(a.prediction.nextPeriodStart).toBeNull();
		expect(a.prediction.fertileWindow).toBeNull();
		expect(a.prediction.cycleDay).toBeNull();
		expect(a.projections).toEqual([]);
		expect(a.stats.avgCycleLength).toBe(28);
	});

	it('1 period → low confidence, default cycle length', () => {
		const a = analyze(period('2026-11-02', 5), SETTINGS, '2026-11-15');
		const p = a.prediction;
		expect(p.confidence).toBe('low');
		expect(a.stats.avgCycleLength).toBe(28);
		expect(a.stats.avgPeriodLength).toBe(5);
		expect(p.lastPeriodStart).toBe('2026-11-02');
		expect(p.nextPeriodStart).toBe('2026-11-30');
		expect(p.predictedPeriod).toEqual({ start: '2026-11-30', end: '2026-12-04' });
		expect(p.uncertainty).toBe(2);
		expect(p.ovulationDay).toBe('2026-11-18');
		expect(p.fertileWindow).toEqual({ start: '2026-11-13', end: '2026-11-18' });
		expect(p.cycleDay).toBe(14);
		expect(p.periodDay).toBeNull();
		expect(p.daysLate).toBeNull();
	});

	it('2 periods (1 cycle) → low confidence, measured cycle length', () => {
		const a = analyze(periods(['2026-10-03', '2026-11-02']), SETTINGS, '2026-11-15');
		expect(a.cycles).toEqual([{ start: '2026-10-03', length: 30, outlier: false }]);
		expect(a.prediction.confidence).toBe('low');
		expect(a.stats.cycleSD).toBeNull();
		expect(a.prediction.uncertainty).toBe(2);
		expect(a.prediction.nextPeriodStart).toBe('2026-12-02');
	});

	it('2 cycles → still low confidence', () => {
		const a = analyze(periods(['2026-09-04', '2026-10-04', '2026-11-02']), SETTINGS, '2026-11-15');
		expect(a.cycles).toHaveLength(2);
		expect(a.prediction.confidence).toBe('low');
	});

	it('≥ 3 cycles → normal confidence, SD-based uncertainty', () => {
		// cycles: 29, 29, 30, 29
		const a = analyze(periods(['2026-07-08', '2026-08-06', '2026-09-04', '2026-10-04', '2026-11-02']), SETTINGS, '2026-11-15');
		expect(a.cycles.map((c) => c.length)).toEqual([29, 29, 30, 29]);
		expect(a.prediction.confidence).toBe('normal');
		expect(a.stats.avgCycleLength).toBe(29);
		expect(a.stats.cycleRange).toEqual([29, 30]);
		expect(a.stats.cycleSD).toBeCloseTo(0.5, 10);
		expect(a.prediction.uncertainty).toBe(1); // max(1, round(0.5))
		expect(a.prediction.nextPeriodStart).toBe('2026-12-01');
	});

	it('outlier cycles do not count towards confidence', () => {
		const a = analyze(periods(['2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-11-02']), SETTINGS, '2026-11-15');
		expect(a.cycles.every((c) => c.outlier)).toBe(true);
		expect(a.prediction.confidence).toBe('low');
		expect(a.stats.avgCycleLength).toBe(28); // falls back to the default
	});
});

describe('analyze: ovulation and fertile window', () => {
	it('ovulation = nextPeriodStart − luteal length', () => {
		for (const luteal of [10, 12, 14]) {
			const a = analyze(period('2026-11-02', 5), { ...SETTINGS, lutealPhaseLength: luteal }, '2026-11-03');
			expect(diffDays(a.prediction.ovulationDay!, a.prediction.nextPeriodStart!)).toBe(luteal);
			expect(a.prediction.fertileWindow).toEqual({ start: addDays(a.prediction.ovulationDay!, -5), end: a.prediction.ovulationDay });
		}
	});

	it('is reported for today on ovulation day', () => {
		const a = analyze(period('2026-11-02', 5), SETTINGS, '2026-11-18');
		expect(a.prediction.ovulationDay).toBe('2026-11-18');
		expect(a.prediction.fertileWindow).toEqual({ start: '2026-11-13', end: '2026-11-18' });
	});

	it('rolls forward one cycle once the window is past', () => {
		const a = analyze(period('2026-11-02', 5), SETTINGS, '2026-11-19'); // window ended 11-18
		expect(a.prediction.ovulationDay).toBe('2026-12-16');
		expect(a.prediction.fertileWindow).toEqual({ start: '2026-12-11', end: '2026-12-16' });
		expect(a.prediction.nextPeriodStart).toBe('2026-11-30'); // period prediction not rolled
	});

	it('keeps rolling when overdue by more than a cycle', () => {
		const a = analyze(period('2026-09-01', 5), SETTINGS, '2026-11-15');
		expect(diffDays('2026-11-15', a.prediction.fertileWindow!.end)).toBeGreaterThanOrEqual(0);
		expect(diffDays('2026-11-15', a.prediction.fertileWindow!.end)).toBeLessThan(28);
	});
});

describe('analyze: overdue, current period, projections', () => {
	it('reports days late without rolling the period prediction', () => {
		const a = analyze(period('2026-10-10', 5), SETTINGS, '2026-11-15');
		expect(a.prediction.nextPeriodStart).toBe('2026-11-07');
		expect(a.prediction.daysLate).toBe(8);
		expect(a.prediction.predictedPeriod).toEqual({ start: '2026-11-07', end: '2026-11-11' });
		expect(a.prediction.cycleDay).toBe(37);
	});

	it('is not late on the predicted day itself', () => {
		expect(analyze(period('2026-10-18', 5), SETTINGS, '2026-11-15').prediction.daysLate).toBeNull();
	});

	it('reports the day of an ongoing period', () => {
		const entries = [...period('2026-10-17', 4), ...period('2026-11-13', 3)];
		const a = analyze(entries, SETTINGS, '2026-11-15');
		expect(a.periods[1]!.ongoing).toBe(true);
		expect(a.prediction.periodDay).toBe(3);
		expect(a.prediction.cycleDay).toBe(3);
		expect(a.stats.avgPeriodLength).toBe(4); // the ongoing period is not averaged yet
	});

	it('projects the next N cycles', () => {
		const a = analyze(period('2026-11-02', 5), SETTINGS, '2026-11-15');
		expect(a.projections).toEqual([
			{ period: { start: '2026-11-30', end: '2026-12-04' }, ovulationDay: '2026-11-18', fertileWindow: { start: '2026-11-13', end: '2026-11-18' } },
			{ period: { start: '2026-12-28', end: '2027-01-01' }, ovulationDay: '2026-12-16', fertileWindow: { start: '2026-12-11', end: '2026-12-16' } },
			{ period: { start: '2027-01-25', end: '2027-01-29' }, ovulationDay: '2027-01-13', fertileWindow: { start: '2027-01-08', end: '2027-01-13' } },
		]);
		expect(analyze(period('2026-11-02', 5), { ...SETTINGS, predictCycles: 0 }, '2026-11-15').projections).toEqual([]);
	});

	it('rounds a fractional median for date maths', () => {
		// cycles 28, 29 → median 28.5 → 29 days
		const a = analyze(periods(['2026-09-07', '2026-10-05', '2026-11-03']), SETTINGS, '2026-11-15');
		expect(a.stats.avgCycleLength).toBe(28.5);
		expect(a.prediction.nextPeriodStart).toBe('2026-12-02');
	});
});
