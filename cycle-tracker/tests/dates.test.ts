import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import {
	addDays,
	compareIso,
	dayOfWeek,
	daysInMonth,
	diffDays,
	fromDayNumber,
	isIsoDate,
	parseIsoDate,
	toDayNumber,
	toLocalIsoDate,
	todayIso,
} from '../src/core/dates';

describe('parseIsoDate / isIsoDate', () => {
	it('accepts valid dates', () => {
		expect(parseIsoDate('2026-11-02')).toEqual({ year: 2026, month: 11, day: 2 });
		expect(isIsoDate('2028-02-29')).toBe(true);
		expect(isIsoDate('2000-02-29')).toBe(true);
	});

	it('rejects malformed or impossible dates', () => {
		for (const bad of ['2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29', '2100-02-29', '2026-1-2', '26-11-02', '2026-11-02T00:00', ' 2026-11-02', '', '0999-01-01']) {
			expect(isIsoDate(bad), bad).toBe(false);
		}
		expect(isIsoDate(20261102)).toBe(false);
		expect(isIsoDate(null)).toBe(false);
	});

	it('knows month lengths', () => {
		expect(daysInMonth(2028, 2)).toBe(29);
		expect(daysInMonth(2026, 2)).toBe(28);
		expect(daysInMonth(2026, 4)).toBe(30);
		expect(daysInMonth(2026, 12)).toBe(31);
	});
});

describe('diffDays', () => {
	it('is zero for the same day and signed otherwise', () => {
		expect(diffDays('2026-11-02', '2026-11-02')).toBe(0);
		expect(diffDays('2026-11-02', '2026-11-05')).toBe(3);
		expect(diffDays('2026-11-05', '2026-11-02')).toBe(-3);
	});

	it('crosses month and year boundaries', () => {
		expect(diffDays('2026-01-31', '2026-02-01')).toBe(1);
		expect(diffDays('2026-11-30', '2026-12-01')).toBe(1);
		expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
		expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
	});

	it('handles leap years', () => {
		expect(diffDays('2028-02-28', '2028-03-01')).toBe(2);
		expect(diffDays('2028-02-28', '2028-02-29')).toBe(1);
		expect(diffDays('2027-02-28', '2027-03-01')).toBe(1);
		expect(diffDays('2028-01-01', '2029-01-01')).toBe(366);
	});

	it('is unaffected by DST transitions', () => {
		// EU: 2026-03-29 (spring forward), 2026-10-25 (fall back)
		expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
		expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
		// US: 2026-03-08, 2026-11-01
		expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
		expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
	});

	it('throws on invalid input', () => {
		expect(() => diffDays('2026-02-30', '2026-03-01')).toThrow(RangeError);
	});
});

describe('addDays', () => {
	it('adds and subtracts across boundaries', () => {
		expect(addDays('2026-11-02', 28)).toBe('2026-11-30');
		expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
		expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
		expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
	});

	it('round-trips through day numbers', () => {
		const iso = '2026-11-14';
		expect(fromDayNumber(toDayNumber(iso))).toBe(iso);
		expect(diffDays(iso, addDays(iso, 123))).toBe(123);
	});
});

describe('compareIso / dayOfWeek', () => {
	it('orders chronologically', () => {
		expect(['2026-11-10', '2025-12-31', '2026-02-01'].sort(compareIso)).toEqual(['2025-12-31', '2026-02-01', '2026-11-10']);
	});

	it('returns the weekday (0 = Sunday)', () => {
		expect(dayOfWeek('2026-11-02')).toBe(1); // Monday
		expect(dayOfWeek('2026-11-14')).toBe(6); // Saturday
		expect(dayOfWeek('2026-11-15')).toBe(0); // Sunday
	});
});

describe('local dates in different time zones', () => {
	const originalTz = process.env.TZ;
	afterEach(() => {
		process.env.TZ = originalTz;
	});

	for (const tz of ['UTC', 'America/Los_Angeles', 'Europe/Berlin', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
		it(`uses the local calendar date in ${tz}`, () => {
			process.env.TZ = tz;
			expect(toLocalIsoDate(new Date(2026, 10, 2, 0, 5))).toBe('2026-11-02');
			expect(toLocalIsoDate(new Date(2026, 10, 2, 23, 55))).toBe('2026-11-02');
			expect(todayIso(new Date(2026, 2, 29, 12))).toBe('2026-03-29');
			// diffDays never depends on the zone
			expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
		});
	}
});
