// PURE MODULE — must not import from 'obsidian' (unit-tested with plain Node).

/** Calendar date as `YYYY-MM-DD` (local calendar date, no time or zone). */
export type IsoDate = string;

export const FLOW_LEVELS = ['spotting', 'light', 'medium', 'heavy'] as const;
export type Flow = (typeof FLOW_LEVELS)[number];

/** Flow levels that start or extend a period. Spotting is recorded but excluded (spec §5.1). */
export const PERIOD_FLOWS: ReadonlySet<Flow> = new Set<Flow>(['light', 'medium', 'heavy']);

export const LH_RESULTS = ['positive', 'negative'] as const;
export type LhResult = (typeof LH_RESULTS)[number];

/** One logged day. Mirrors the `entries[]` items in the log file frontmatter (spec §3.2). */
export interface Entry {
	date: IsoDate;
	flow?: Flow;
	/** Lower-case symptom keys. Unknown keys are preserved. */
	symptoms?: string[];
	note?: string;
	/** Reserved for v2: basal body temperature, °C. */
	bbt?: number;
	/** Reserved for v2: LH test result. */
	lh?: LhResult;
	/** Reserved for v2: user-confirmed ovulation day. */
	ovulation?: boolean;
}

export interface DateRange {
	start: IsoDate;
	end: IsoDate;
}

export interface Period extends DateRange {
	/** Days, inclusive of start and end. */
	length: number;
	/** Ends today or yesterday, so it may still be going on. */
	ongoing: boolean;
}

export interface Cycle {
	/** Start of the period that opens this cycle. */
	start: IsoDate;
	/** Days from this period's start to the next period's start. */
	length: number;
	/** Outside the configured bounds; shown in history but excluded from averages. */
	outlier: boolean;
}

export type Confidence = 'none' | 'low' | 'normal';

export interface Stats {
	/** Median of the last N valid cycle lengths (unrounded), or the default. */
	avgCycleLength: number;
	/** Sample standard deviation of the same set; null when n < 3. */
	cycleSD: number | null;
	cycleRange: [number, number] | null;
	/** Median of the last N completed periods, or the default. */
	avgPeriodLength: number;
	cyclesUsed: number;
	periodsUsed: number;
}

export interface Prediction {
	confidence: Confidence;
	lastPeriodStart: IsoDate | null;
	/** lastPeriodStart + round(avgCycleLength). Not rolled forward when overdue. */
	nextPeriodStart: IsoDate | null;
	/** ± days for display. */
	uncertainty: number;
	/** [nextPeriodStart, nextPeriodStart + round(avgPeriodLength) − 1]. */
	predictedPeriod: DateRange | null;
	/** The next ovulation day that is not in the past (rolled forward whole cycles if needed). */
	ovulationDay: IsoDate | null;
	/** The next fertile window that has not ended yet (ovulation − 5 … ovulation). */
	fertileWindow: DateRange | null;
	/** Days past nextPeriodStart with no new period logged; null if not late. */
	daysLate: number | null;
	/** 1-based day of the current cycle; null without data. */
	cycleDay: number | null;
	/** 1-based day of the ongoing period; null when no period is ongoing. */
	periodDay: number | null;
}

/** Estimated ovulation day and fertile window of one cycle. */
export interface OvulationEstimate {
	ovulationDay: IsoDate;
	fertileWindow: DateRange;
}

/** One future cycle drawn on the calendar. */
export interface ProjectedCycle extends OvulationEstimate {
	period: DateRange;
}

/** Everything the UI needs, computed in one pass. */
export interface Analysis {
	periods: Period[];
	cycles: Cycle[];
	stats: Stats;
	prediction: Prediction;
	/** The next `predictCycles` cycles, starting with the one beginning at nextPeriodStart. */
	projections: ProjectedCycle[];
	/**
	 * Retrospective estimates for completed, non-outlier cycles: counted back from the period
	 * that actually followed, so they do not depend on any prediction.
	 */
	pastEstimates: OvulationEstimate[];
}
