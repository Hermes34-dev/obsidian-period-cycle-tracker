// PURE MODULE — must not import from 'obsidian' (unit-tested with plain Node).
//
// All dates are ISO calendar dates `YYYY-MM-DD`. Arithmetic is done on UTC day numbers
// (Date.UTC), so results never depend on the local time zone or DST transitions.
// Never use `new Date("YYYY-MM-DD")`: it parses as UTC midnight and shows the previous
// day in zones west of UTC.

import type { IsoDate } from './types';

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateParts {
	year: number;
	/** 1–12 */
	month: number;
	/** 1–31 */
	day: number;
}

/** Parse a strict `YYYY-MM-DD` string into parts; null if malformed or not a real date. */
export function parseIsoDate(value: string): DateParts | null {
	const m = ISO_RE.exec(value);
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
	return { year, month, day };
}

export function isIsoDate(value: unknown): value is IsoDate {
	return typeof value === 'string' && parseIsoDate(value) !== null;
}

export function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
	if (month === 2) return isLeapYear(year) ? 29 : 28;
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Days since 1970-01-01 for an ISO date. Throws on invalid input. */
export function toDayNumber(iso: IsoDate): number {
	const p = parseIsoDate(iso);
	if (!p) throw new RangeError(`Invalid ISO date: ${JSON.stringify(iso)}`);
	return Date.UTC(p.year, p.month - 1, p.day) / MS_PER_DAY;
}

export function fromDayNumber(dayNumber: number): IsoDate {
	const d = new Date(dayNumber * MS_PER_DAY);
	return formatParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
	return toDayNumber(b) - toDayNumber(a);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
	return fromDayNumber(toDayNumber(iso) + days);
}

/** Lexicographic order equals chronological order for valid ISO dates. */
export function compareIso(a: IsoDate, b: IsoDate): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: IsoDate): number {
	return new Date(toDayNumber(iso) * MS_PER_DAY).getUTCDay();
}

export function formatParts(year: number, month: number, day: number): IsoDate {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The local calendar date of a JS Date (what the user sees on their clock). */
export function toLocalIsoDate(date: Date): IsoDate {
	return formatParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function todayIso(now: Date = new Date()): IsoDate {
	return toLocalIsoDate(now);
}
