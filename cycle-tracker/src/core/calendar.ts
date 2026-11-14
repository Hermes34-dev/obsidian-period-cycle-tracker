// PURE MODULE — must not import from 'obsidian' (unit-tested with plain Node).
//
// Month-grid maths for the calendar view.

import { addDays, compareIso, dayOfWeek, formatParts } from './dates';
import type { Analysis, DateRange, IsoDate } from './types';

/** 0 = weeks start on Sunday, 1 = weeks start on Monday. */
export type WeekStartDay = 0 | 1;

export const GRID_DAYS = 42; // 6 rows × 7 columns

export interface YearMonth {
	year: number;
	/** 1–12 */
	month: number;
}

/** The 42 dates shown for a month: starts on the week-start day on or before the 1st. */
export function monthGrid(year: number, month: number, weekStart: WeekStartDay): IsoDate[] {
	const first = formatParts(year, month, 1);
	const offset = (dayOfWeek(first) - weekStart + 7) % 7;
	const start = addDays(first, -offset);
	return Array.from({ length: GRID_DAYS }, (_, i) => addDays(start, i));
}

/** Weekday numbers (0 = Sunday) in display order. */
export function weekdayOrder(weekStart: WeekStartDay): number[] {
	return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
	const index = ym.year * 12 + (ym.month - 1) + delta;
	return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function yearMonthOf(iso: IsoDate): YearMonth {
	return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

export function isInMonth(iso: IsoDate, ym: YearMonth): boolean {
	const d = yearMonthOf(iso);
	return d.year === ym.year && d.month === ym.month;
}

export interface PredictionMarks {
	predictedPeriod: Set<IsoDate>;
	fertile: Set<IsoDate>;
	ovulation: Set<IsoDate>;
	/** Estimated fertile days before today (drawn fainter). */
	pastFertile: Set<IsoDate>;
	/** Estimated ovulation days before today (drawn fainter). */
	pastOvulation: Set<IsoDate>;
}

/**
 * Which calendar days get prediction styling. Predictions (future) are only drawn for dates
 * ≥ today, so an overdue period's predicted days in the past are not drawn (spec §4.2, §5.4).
 *
 * With `showPastEstimates`, fertile windows and ovulation days before today are returned
 * separately: retrospective estimates for completed cycles, plus the part of the current
 * cycle's window that is already behind us. Predicted *period* days are never shown in the past.
 */
export function predictionMarks(
	analysis: Analysis,
	today: IsoDate,
	showFertileWindow: boolean,
	showPastEstimates = false,
): PredictionMarks {
	const marks: PredictionMarks = {
		predictedPeriod: new Set(),
		fertile: new Set(),
		ovulation: new Set(),
		pastFertile: new Set(),
		pastOvulation: new Set(),
	};
	const pastFertile = showPastEstimates ? marks.pastFertile : null;
	const pastOvulation = showPastEstimates ? marks.pastOvulation : null;

	const addDay = (future: Set<IsoDate>, past: Set<IsoDate> | null, d: IsoDate) => {
		if (compareIso(d, today) >= 0) future.add(d);
		else past?.add(d);
	};
	const addRange = (future: Set<IsoDate>, past: Set<IsoDate> | null, r: DateRange) => {
		for (let d = r.start; compareIso(d, r.end) <= 0; d = addDays(d, 1)) addDay(future, past, d);
	};

	for (const p of analysis.projections) {
		addRange(marks.predictedPeriod, null, p.period);
		if (showFertileWindow) {
			addRange(marks.fertile, pastFertile, p.fertileWindow);
			addDay(marks.ovulation, pastOvulation, p.ovulationDay);
		}
	}
	if (showFertileWindow) {
		// The "next" fertile window may have been rolled past the projections (long overdue).
		const { fertileWindow, ovulationDay } = analysis.prediction;
		if (fertileWindow && ovulationDay) {
			addRange(marks.fertile, pastFertile, fertileWindow);
			addDay(marks.ovulation, pastOvulation, ovulationDay);
		}
		if (showPastEstimates) {
			for (const e of analysis.pastEstimates) {
				addRange(marks.fertile, pastFertile, e.fertileWindow);
				addDay(marks.ovulation, pastOvulation, e.ovulationDay);
			}
		}
	}
	return marks;
}
