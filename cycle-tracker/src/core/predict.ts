// PURE MODULE — must not import from 'obsidian' (unit-tested with plain Node).
//
// Statistics and predictions (spec §5.3–5.4).
//
// Scientific rationale (spec §5.5):
// - Ovulation is NOT fixed at cycle day 14. In 612,613 app-tracked ovulatory cycles the mean
//   cycle length was 29.3 days, the follicular phase 16.9 days (95% CI 10–30) and the luteal
//   phase 12.4 days (95% CI 7–17); only 13% of cycles were 28 days long (Bull et al., 2019,
//   npj Digit Med 2:83). The luteal phase is the more stable one, so ovulation is estimated
//   BACKWARDS from the predicted next period (nextPeriodStart − luteal length), not forwards
//   from the last period.
// - Fertile window = the 5 days before ovulation plus ovulation day (Wilcox et al., 1995,
//   N Engl J Med 333:1517–1521).
// - Calendar-only prediction is inherently imprecise; physiological markers (BBT, LH)
//   improve it (Bull et al., 2019). Planned for v2.
//
// These are estimates only — not a method of contraception or a medical device.

import { addDays, diffDays } from './dates';
import { deriveCycles, findPeriods } from './periods';
import type {
	Analysis,
	Confidence,
	Cycle,
	DateRange,
	Entry,
	IsoDate,
	OvulationEstimate,
	Period,
	Prediction,
	ProjectedCycle,
	Stats,
} from './types';

export interface PredictSettings {
	defaultCycleLength: number;
	defaultPeriodLength: number;
	lutealPhaseLength: number;
	maxGapDays: number;
	/** N: statistics use the last N valid cycles / completed periods. */
	cyclesForAverages: number;
	outlierMinCycle: number;
	outlierMaxCycle: number;
	/** Number of future cycles to project on the calendar. */
	predictCycles: number;
}

/** Cycles needed before predictions are labelled normal confidence. */
export const NORMAL_CONFIDENCE_CYCLES = 3;
/** Days before ovulation that belong to the fertile window. */
export const FERTILE_DAYS_BEFORE_OVULATION = 5;
/** ± days shown when there are too few cycles for a standard deviation. */
export const DEFAULT_UNCERTAINTY = 2;

export function median(values: readonly number[]): number {
	if (values.length === 0) throw new RangeError('median of an empty list');
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Sample standard deviation (n − 1). Null for fewer than 3 values (spec §5.3). */
export function sampleSD(values: readonly number[]): number | null {
	if (values.length < 3) return null;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
	return Math.sqrt(variance);
}

function lastN<T>(items: readonly T[], n: number): T[] {
	const count = Math.max(1, Math.floor(n));
	return items.slice(-count);
}

export function computeStats(periods: readonly Period[], cycles: readonly Cycle[], settings: PredictSettings): Stats {
	const valid = lastN(
		cycles.filter((c) => !c.outlier),
		settings.cyclesForAverages,
	).map((c) => c.length);
	// Ongoing periods may still grow, so they are excluded until they end.
	const completed = lastN(
		periods.filter((p) => !p.ongoing),
		settings.cyclesForAverages,
	).map((p) => p.length);

	return {
		avgCycleLength: valid.length ? median(valid) : settings.defaultCycleLength,
		cycleSD: sampleSD(valid),
		cycleRange: valid.length ? [Math.min(...valid), Math.max(...valid)] : null,
		avgPeriodLength: completed.length ? median(completed) : settings.defaultPeriodLength,
		cyclesUsed: valid.length,
		periodsUsed: completed.length,
	};
}

export function confidenceFor(periodCount: number, validCycles: number): Confidence {
	if (periodCount === 0) return 'none';
	return validCycles >= NORMAL_CONFIDENCE_CYCLES ? 'normal' : 'low';
}

function range(start: IsoDate, length: number): DateRange {
	return { start, end: addDays(start, Math.max(1, length) - 1) };
}

function fertileFor(ovulationDay: IsoDate): DateRange {
	return { start: addDays(ovulationDay, -FERTILE_DAYS_BEFORE_OVULATION), end: ovulationDay };
}

const EMPTY_PREDICTION: Prediction = {
	confidence: 'none',
	lastPeriodStart: null,
	nextPeriodStart: null,
	uncertainty: DEFAULT_UNCERTAINTY,
	predictedPeriod: null,
	ovulationDay: null,
	fertileWindow: null,
	daysLate: null,
	cycleDay: null,
	periodDay: null,
};

/** Periods, cycles, statistics, the next-event prediction and calendar projections. */
export function analyze(entries: readonly Entry[], settings: PredictSettings, today: IsoDate): Analysis {
	const periods = findPeriods(entries, settings.maxGapDays, today);
	const cycles = deriveCycles(periods, settings);
	const stats = computeStats(periods, cycles, settings);
	const last = periods[periods.length - 1];
	if (!last) return { periods, cycles, stats, prediction: { ...EMPTY_PREDICTION }, projections: [], pastEstimates: [] };

	const cycleLen = Math.max(1, Math.round(stats.avgCycleLength));
	const periodLen = Math.max(1, Math.round(stats.avgPeriodLength));
	const luteal = Math.max(0, Math.round(settings.lutealPhaseLength));

	const pastEstimates: OvulationEstimate[] = cycles
		.filter((c) => !c.outlier)
		.map((c) => {
			const ov = addDays(addDays(c.start, c.length), -luteal);
			return { ovulationDay: ov, fertileWindow: fertileFor(ov) };
		});

	const nextPeriodStart = addDays(last.start, cycleLen);

	// Next fertile window: the current cycle's, rolled forward whole cycles while it has ended.
	let ovulationDay = addDays(nextPeriodStart, -luteal);
	let fertileWindow = fertileFor(ovulationDay);
	while (diffDays(fertileWindow.end, today) > 0) {
		ovulationDay = addDays(ovulationDay, cycleLen);
		fertileWindow = fertileFor(ovulationDay);
	}

	const sinceStart = diffDays(last.start, today);
	const late = diffDays(nextPeriodStart, today);

	const prediction: Prediction = {
		confidence: confidenceFor(periods.length, stats.cyclesUsed),
		lastPeriodStart: last.start,
		nextPeriodStart,
		uncertainty: stats.cycleSD !== null ? Math.max(1, Math.round(stats.cycleSD)) : DEFAULT_UNCERTAINTY,
		predictedPeriod: range(nextPeriodStart, periodLen),
		ovulationDay,
		fertileWindow,
		// Overdue: not rolled forward automatically (spec §5.4).
		daysLate: late > 0 ? late : null,
		cycleDay: sinceStart >= 0 ? sinceStart + 1 : null,
		periodDay: last.ongoing && sinceStart >= 0 ? sinceStart + 1 : null,
	};

	const projections: ProjectedCycle[] = [];
	for (let k = 0; k < Math.max(0, Math.floor(settings.predictCycles)); k++) {
		const start = addDays(nextPeriodStart, k * cycleLen);
		const ov = addDays(start, -luteal);
		projections.push({ period: range(start, periodLen), ovulationDay: ov, fertileWindow: fertileFor(ov) });
	}

	return { periods, cycles, stats, prediction, projections, pastEstimates };
}
