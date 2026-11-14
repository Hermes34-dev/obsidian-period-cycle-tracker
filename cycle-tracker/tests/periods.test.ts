import { describe, expect, it } from 'vitest';
import { deriveCycles, findPeriods, normalizeEntries } from '../src/core/periods';
import type { Entry } from '../src/core/types';
import { SETTINGS, period } from './helpers';

const TODAY = '2026-11-15';

describe('findPeriods', () => {
	it('groups consecutive flow days into one period', () => {
		expect(findPeriods(period('2026-11-02', 5), 1, TODAY)).toEqual([
			{ start: '2026-11-02', end: '2026-11-06', length: 5, ongoing: false },
		]);
	});

	it('allows a 1-day gap with maxGapDays = 1', () => {
		const entries: Entry[] = [
			{ date: '2026-11-02', flow: 'heavy' },
			{ date: '2026-11-04', flow: 'light' },
		];
		expect(findPeriods(entries, 1, TODAY)).toEqual([{ start: '2026-11-02', end: '2026-11-04', length: 3, ongoing: false }]);
	});

	it('splits on a 2-day gap with maxGapDays = 1', () => {
		const entries: Entry[] = [
			{ date: '2026-11-02', flow: 'heavy' },
			{ date: '2026-11-05', flow: 'light' },
		];
		expect(findPeriods(entries, 1, TODAY).map((p) => p.start)).toEqual(['2026-11-02', '2026-11-05']);
	});

	it('splits on any gap with maxGapDays = 0, and joins a 2-day gap with maxGapDays = 2', () => {
		const entries: Entry[] = [
			{ date: '2026-11-02', flow: 'heavy' },
			{ date: '2026-11-04', flow: 'light' },
			{ date: '2026-11-07', flow: 'light' },
		];
		expect(findPeriods(entries, 0, TODAY)).toHaveLength(3);
		expect(findPeriods(entries, 2, TODAY)).toEqual([{ start: '2026-11-02', end: '2026-11-07', length: 6, ongoing: false }]);
	});

	it('ignores spotting-only days', () => {
		const entries: Entry[] = [
			{ date: '2026-11-02', flow: 'spotting' },
			{ date: '2026-11-03', flow: 'spotting', symptoms: ['cramps'] },
			{ date: '2026-11-04', symptoms: ['cramps'] },
		];
		expect(findPeriods(entries, 1, TODAY)).toEqual([]);
	});

	it('does not let spotting bridge a gap or extend a period', () => {
		const entries: Entry[] = [
			{ date: '2026-11-01', flow: 'heavy' },
			{ date: '2026-11-02', flow: 'spotting' },
			{ date: '2026-11-03', flow: 'spotting' },
			{ date: '2026-11-04', flow: 'light' },
			{ date: '2026-11-05', flow: 'spotting' },
		];
		expect(findPeriods(entries, 1, TODAY)).toEqual([
			{ start: '2026-11-01', end: '2026-11-01', length: 1, ongoing: false },
			{ start: '2026-11-04', end: '2026-11-04', length: 1, ongoing: false },
		]);
	});

	it('normalises unsorted and duplicate-date input (last entry wins)', () => {
		const entries: Entry[] = [
			{ date: '2026-11-04', flow: 'light' },
			{ date: '2026-11-02', flow: 'heavy' },
			{ date: '2026-11-03', flow: 'medium' },
			{ date: '2026-11-04', flow: 'spotting' }, // overrides the light day above
		];
		expect(normalizeEntries(entries).map((e) => e.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
		expect(findPeriods(entries, 1, TODAY)).toEqual([{ start: '2026-11-02', end: '2026-11-03', length: 2, ongoing: false }]);
	});

	it('marks a period ending today or yesterday as ongoing', () => {
		expect(findPeriods(period('2026-11-12', 4), 1, TODAY)[0]!.ongoing).toBe(true); // ends today
		expect(findPeriods(period('2026-11-12', 3), 1, TODAY)[0]!.ongoing).toBe(true); // ends yesterday
		expect(findPeriods(period('2026-11-11', 3), 1, TODAY)[0]!.ongoing).toBe(false); // ended 2 days ago
	});

	it('handles periods across month and year boundaries', () => {
		expect(findPeriods(period('2026-12-30', 4), 1, '2027-02-01')).toEqual([
			{ start: '2026-12-30', end: '2027-01-02', length: 4, ongoing: false },
		]);
	});
});

describe('deriveCycles', () => {
	const p = (start: string) => ({ start, end: start, length: 1, ongoing: false });

	it('measures start to next start and flags outliers', () => {
		const cycles = deriveCycles([p('2026-07-01'), p('2026-07-29'), p('2026-08-07'), p('2026-11-20'), p('2026-12-20')], SETTINGS);
		expect(cycles).toEqual([
			{ start: '2026-07-01', length: 28, outlier: false },
			{ start: '2026-07-29', length: 9, outlier: true }, // < 15
			{ start: '2026-08-07', length: 105, outlier: true }, // > 90
			{ start: '2026-11-20', length: 30, outlier: false },
		]);
	});

	it('needs at least two periods', () => {
		expect(deriveCycles([], SETTINGS)).toEqual([]);
		expect(deriveCycles([p('2026-11-02')], SETTINGS)).toEqual([]);
	});

	it('respects custom bounds', () => {
		const cycles = deriveCycles([p('2026-01-01'), p('2026-03-02')], { outlierMinCycle: 15, outlierMaxCycle: 45 });
		expect(cycles[0]).toEqual({ start: '2026-01-01', length: 60, outlier: true });
	});
});
