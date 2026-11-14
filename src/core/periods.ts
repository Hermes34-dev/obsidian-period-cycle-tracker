// PURE MODULE — must not import from 'obsidian' (unit-tested with plain Node).
//
// Group logged flow days into periods, and consecutive periods into cycles (spec §5.1–5.2).

import { compareIso, diffDays, isIsoDate } from './dates';
import { PERIOD_FLOWS, type Cycle, type Entry, type IsoDate, type Period } from './types';

/** Sort by date and keep one entry per date (the last one wins). Drops invalid dates. */
export function normalizeEntries(entries: readonly Entry[]): Entry[] {
	const byDate = new Map<IsoDate, Entry>();
	for (const e of entries) if (isIsoDate(e.date)) byDate.set(e.date, e);
	return [...byDate.values()].sort((a, b) => compareIso(a.date, b.date));
}

/**
 * Periods from logged flow. Only light/medium/heavy count: spotting neither starts nor
 * extends a period, and does not bridge a gap. Up to `maxGapDays` flow-free days are
 * allowed inside one period.
 *
 * A period whose last flow day is today or yesterday (or later) is `ongoing`.
 */
export function findPeriods(entries: readonly Entry[], maxGapDays: number, today: IsoDate): Period[] {
	const gap = Math.max(0, Math.floor(maxGapDays));
	const flowDays = normalizeEntries(entries)
		.filter((e) => e.flow !== undefined && PERIOD_FLOWS.has(e.flow))
		.map((e) => e.date);

	const periods: Period[] = [];
	let start: IsoDate | null = null;
	let end: IsoDate | null = null;
	const close = () => {
		if (start === null || end === null) return;
		periods.push({ start, end, length: diffDays(start, end) + 1, ongoing: diffDays(end, today) <= 1 });
	};

	for (const day of flowDays) {
		if (start !== null && end !== null && diffDays(end, day) <= gap + 1) {
			end = day;
		} else {
			close();
			start = day;
			end = day;
		}
	}
	close();
	return periods;
}

export interface CycleBounds {
	/** Cycles shorter than this are outliers. */
	outlierMinCycle: number;
	/** Cycles longer than this are outliers. */
	outlierMaxCycle: number;
}

/** One cycle per pair of consecutive periods: from one period start to the next. */
export function deriveCycles(periods: readonly Period[], bounds: CycleBounds): Cycle[] {
	const cycles: Cycle[] = [];
	for (let i = 0; i + 1 < periods.length; i++) {
		const start = periods[i]!.start;
		const length = diffDays(start, periods[i + 1]!.start);
		cycles.push({ start, length, outlier: length < bounds.outlierMinCycle || length > bounds.outlierMaxCycle });
	}
	return cycles;
}
