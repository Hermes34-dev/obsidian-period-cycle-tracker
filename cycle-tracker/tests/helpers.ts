import { addDays } from '../src/core/dates';
import type { PredictSettings } from '../src/core/predict';
import type { Entry, Flow, IsoDate } from '../src/core/types';

export const SETTINGS: PredictSettings = {
	defaultCycleLength: 28,
	defaultPeriodLength: 5,
	lutealPhaseLength: 12,
	maxGapDays: 1,
	cyclesForAverages: 6,
	outlierMinCycle: 15,
	outlierMaxCycle: 90,
	predictCycles: 3,
};

/** `length` consecutive flow days starting at `start`. */
export function period(start: IsoDate, length: number, flow: Flow = 'medium'): Entry[] {
	return Array.from({ length }, (_, i) => ({ date: addDays(start, i), flow }));
}

/** Several periods of the same length, one per start date. */
export function periods(starts: IsoDate[], length = 5): Entry[] {
	return starts.flatMap((s) => period(s, length));
}
