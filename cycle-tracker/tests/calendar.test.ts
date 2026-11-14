import { describe, expect, it } from 'vitest';
import { GRID_DAYS, isInMonth, monthGrid, predictionMarks, shiftMonth, weekdayOrder, yearMonthOf } from '../src/core/calendar';
import { analyze } from '../src/core/predict';
import { SETTINGS, period, periods } from './helpers';
import { dayOfWeek, diffDays } from '../src/core/dates';

describe('monthGrid', () => {
	it('starts on the Monday on or before the 1st (Monday start)', () => {
		// 2026-11-01 is a Sunday
		const grid = monthGrid(2026, 11, 1);
		expect(grid).toHaveLength(GRID_DAYS);
		expect(grid[0]).toBe('2026-10-26');
		expect(grid[6]).toBe('2026-11-01');
		expect(grid[41]).toBe('2026-12-06');
	});

	it('starts on the 1st itself when it is the week-start day', () => {
		expect(monthGrid(2026, 11, 0)[0]).toBe('2026-11-01'); // Sunday start, Nov 1 is Sunday
		expect(monthGrid(2027, 2, 1)[0]).toBe('2027-02-01'); // Feb 1 2027 is a Monday
	});

	it('covers every day of the month in consecutive order', () => {
		for (const [y, m] of [[2028, 2], [2026, 12], [2027, 1], [2026, 8]] as const) {
			for (const ws of [0, 1] as const) {
				const grid = monthGrid(y, m, ws);
				expect(dayOfWeek(grid[0]!)).toBe(ws);
				for (let i = 1; i < grid.length; i++) expect(diffDays(grid[i - 1]!, grid[i]!)).toBe(1);
				const inMonth = grid.filter((d) => isInMonth(d, { year: y, month: m }));
				expect(inMonth[0]).toBe(`${y}-${String(m).padStart(2, '0')}-01`);
			}
		}
		expect(monthGrid(2028, 2, 1).filter((d) => d.startsWith('2028-02'))).toHaveLength(29);
	});
});

describe('weekdayOrder / shiftMonth / yearMonthOf', () => {
	it('orders weekdays from the start day', () => {
		expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
		expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	it('moves across year boundaries', () => {
		expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
		expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
		expect(shiftMonth({ year: 2026, month: 11 }, -23)).toEqual({ year: 2024, month: 12 });
		expect(shiftMonth({ year: 2026, month: 11 }, 0)).toEqual({ year: 2026, month: 11 });
	});

	it('reads the month of a date', () => {
		expect(yearMonthOf('2026-11-14')).toEqual({ year: 2026, month: 11 });
	});
});

describe('predictionMarks', () => {
	const today = '2026-11-15';

	it('marks projected periods, fertile windows and ovulation days from today on', () => {
		const a = analyze(period('2026-11-02', 5), SETTINGS, today);
		const m = predictionMarks(a, today, true);
		// fertile window 11-13..11-18: only 11-15 onwards is drawn
		expect([...m.fertile].slice(0, 4)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
		expect(m.fertile.has('2026-11-14')).toBe(false);
		expect(m.ovulation.has('2026-11-18')).toBe(true);
		expect(m.predictedPeriod.has('2026-11-30')).toBe(true);
		expect(m.predictedPeriod.has('2026-12-04')).toBe(true);
		expect(m.predictedPeriod.has('2026-12-05')).toBe(false);
		expect(m.predictedPeriod.size).toBe(15); // 3 cycles × 5 days
		expect(m.ovulation.size).toBe(3);
	});

	it('hides the fertile window when the setting is off', () => {
		const m = predictionMarks(analyze(period('2026-11-02', 5), SETTINGS, today), today, false);
		expect(m.fertile.size).toBe(0);
		expect(m.ovulation.size).toBe(0);
		expect(m.predictedPeriod.size).toBe(15);
	});

	it('draws nothing for the past days of an overdue period', () => {
		// next period 11-12..11-16, 3 days late on 11-15
		const a = analyze(period('2026-10-15', 5), SETTINGS, today);
		expect(a.prediction.daysLate).toBe(3);
		const m = predictionMarks(a, today, true);
		expect(m.predictedPeriod.has('2026-11-12')).toBe(false);
		expect(m.predictedPeriod.has('2026-11-14')).toBe(false);
		expect(m.predictedPeriod.has('2026-11-15')).toBe(true);
		expect(m.predictedPeriod.has('2026-11-16')).toBe(true);
	});

	it('is empty without periods', () => {
		const m = predictionMarks(analyze([], SETTINGS, today), today, true);
		expect(m.predictedPeriod.size + m.fertile.size + m.ovulation.size).toBe(0);
	});
});

describe('predictionMarks: past estimates', () => {
	it('marks retrospective estimates for completed cycles', () => {
		// cycle 10-03 → 11-02 (30 days): ovulation ≈ 11-02 − 12 = 10-21, fertile 10-16..10-21
		const a = analyze(periods(['2026-10-03', '2026-11-02']), SETTINGS, '2026-11-15');
		expect(a.pastEstimates).toEqual([{ ovulationDay: '2026-10-21', fertileWindow: { start: '2026-10-16', end: '2026-10-21' } }]);
		const m = predictionMarks(a, '2026-11-15', true, true);
		expect(m.pastOvulation.has('2026-10-21')).toBe(true);
		expect([...m.pastFertile].filter((d) => d.startsWith('2026-10'))).toEqual([
			'2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21',
		]);
		// future predictions are unaffected
		expect(m.ovulation.has('2026-11-20')).toBe(true);
		expect(m.pastOvulation.has('2026-11-20')).toBe(false);
	});

	it('shows the passed part of the current cycle window as a past estimate', () => {
		// single period 11-02: window 11-13..11-18; on 11-16 the first three days are past
		const m = predictionMarks(analyze(period('2026-11-02', 5), SETTINGS, '2026-11-16'), '2026-11-16', true, true);
		expect([...m.pastFertile]).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
		expect(m.fertile.has('2026-11-16')).toBe(true);
		expect(m.ovulation.has('2026-11-18')).toBe(true);
	});

	it('marks a passed ovulation day as past', () => {
		const m = predictionMarks(analyze(period('2026-11-02', 5), SETTINGS, '2026-11-25'), '2026-11-25', true, true);
		expect(m.pastOvulation.has('2026-11-18')).toBe(true);
		expect(m.ovulation.has('2026-12-16')).toBe(true); // rolled-forward next window
	});

	it('skips outlier cycles', () => {
		// 10-01 → 10-08 is a 7-day "cycle" (outlier)
		const a = analyze(periods(['2026-10-01', '2026-10-08'], 3), SETTINGS, '2026-11-15');
		expect(a.cycles[0]!.outlier).toBe(true);
		expect(a.pastEstimates).toEqual([]);
	});

	it('is off by default and when the fertile window is hidden', () => {
		const a = analyze(periods(['2026-10-03', '2026-11-02']), SETTINGS, '2026-11-15');
		const off = predictionMarks(a, '2026-11-15', true);
		expect(off.pastFertile.size + off.pastOvulation.size).toBe(0);
		const hidden = predictionMarks(a, '2026-11-15', false, true);
		expect(hidden.pastFertile.size + hidden.pastOvulation.size + hidden.fertile.size).toBe(0);
	});
});
