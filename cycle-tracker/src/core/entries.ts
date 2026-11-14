// PURE MODULE — must not import from 'obsidian' (unit-tested with plain Node).
//
// Parsing, normalising and editing the `entries` list of the log file frontmatter (spec §3).
// Parsing is tolerant: malformed items are skipped with a warning, never thrown.
// Editing works on the *raw* list so that anything the plugin does not understand
// (malformed items, unknown keys on an entry) survives a write untouched.

import { compareIso, formatParts, isIsoDate } from './dates';
import { FLOW_LEVELS, LH_RESULTS, type Entry, type Flow, type IsoDate, type LhResult } from './types';

export const LOG_VERSION = 1;

const KNOWN_KEYS = ['date', 'flow', 'symptoms', 'note', 'bbt', 'lh', 'ovulation'] as const;
const KNOWN_KEY_SET: ReadonlySet<string> = new Set(KNOWN_KEYS);

type RawObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is RawObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Accept a quoted `"YYYY-MM-DD"` string, or a Date object in case a YAML parser coerced
 * an unquoted date (YAML timestamps without time are UTC midnight, so use UTC parts).
 */
export function normalizeDate(value: unknown): IsoDate | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return isIsoDate(trimmed) ? trimmed : null;
	}
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		const iso = formatParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
		return isIsoDate(iso) ? iso : null;
	}
	return null;
}

/** Lower-case, trim and de-duplicate symptom keys, keeping first-seen order. */
export function normalizeSymptoms(list: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const s of list) {
		const key = s.trim().toLowerCase();
		if (key) seen.add(key);
	}
	return [...seen];
}

export interface NormalizeResult {
	entry: Entry | null;
	warnings: string[];
}

/** Turn one raw frontmatter item into an Entry. Never throws. */
export function normalizeEntry(raw: unknown): NormalizeResult {
	const warnings: string[] = [];
	if (!isPlainObject(raw)) {
		return { entry: null, warnings: [`Skipped entry that is not an object: ${preview(raw)}`] };
	}
	const date = normalizeDate(raw.date);
	if (!date) {
		return { entry: null, warnings: [`Skipped entry with missing or invalid date: ${preview(raw.date)}`] };
	}
	const entry: Entry = { date };

	if (raw.flow !== undefined && raw.flow !== null && raw.flow !== '') {
		const flow = typeof raw.flow === 'string' ? raw.flow.trim().toLowerCase() : raw.flow;
		if ((FLOW_LEVELS as readonly unknown[]).includes(flow)) entry.flow = flow as Flow;
		else warnings.push(`${date}: ignored unknown flow ${preview(raw.flow)}`);
	}

	if (raw.symptoms !== undefined && raw.symptoms !== null) {
		let list: string[] | null = null;
		if (Array.isArray(raw.symptoms)) {
			list = raw.symptoms.filter((s): s is string => typeof s === 'string');
			if (list.length !== raw.symptoms.length) warnings.push(`${date}: ignored non-text symptoms`);
		} else if (typeof raw.symptoms === 'string') {
			list = raw.symptoms.split(',');
		} else {
			warnings.push(`${date}: ignored symptoms that are not a list`);
		}
		const symptoms = list ? normalizeSymptoms(list) : [];
		if (symptoms.length) entry.symptoms = symptoms;
	}

	if (typeof raw.note === 'string' || typeof raw.note === 'number') {
		const note = String(raw.note).trim();
		if (note) entry.note = note;
	} else if (raw.note !== undefined && raw.note !== null) {
		warnings.push(`${date}: ignored note that is not text`);
	}

	if (raw.bbt !== undefined && raw.bbt !== null && raw.bbt !== '') {
		const bbt = typeof raw.bbt === 'number' ? raw.bbt : Number(raw.bbt);
		if (Number.isFinite(bbt)) entry.bbt = bbt;
		else warnings.push(`${date}: ignored invalid bbt ${preview(raw.bbt)}`);
	}

	if (raw.lh !== undefined && raw.lh !== null && raw.lh !== '') {
		const lh = typeof raw.lh === 'string' ? raw.lh.trim().toLowerCase() : raw.lh;
		if ((LH_RESULTS as readonly unknown[]).includes(lh)) entry.lh = lh as LhResult;
		else warnings.push(`${date}: ignored invalid lh ${preview(raw.lh)}`);
	}

	if (typeof raw.ovulation === 'boolean') entry.ovulation = raw.ovulation;
	else if (raw.ovulation !== undefined && raw.ovulation !== null) {
		warnings.push(`${date}: ignored ovulation that is not true/false`);
	}

	return { entry, warnings };
}

export interface ParseResult {
	/** Valid, non-empty entries sorted by date, one per date. */
	entries: Entry[];
	warnings: string[];
}

/** Parse the raw `entries` value from frontmatter. Never throws. */
export function parseEntries(raw: unknown): ParseResult {
	if (raw === undefined || raw === null) return { entries: [], warnings: [] };
	if (!Array.isArray(raw)) {
		return { entries: [], warnings: ['`entries` is not a list; ignoring it.'] };
	}
	const warnings: string[] = [];
	const byDate = new Map<IsoDate, Entry>();
	for (const item of raw) {
		const { entry, warnings: w } = normalizeEntry(item);
		warnings.push(...w);
		if (!entry || isEmptyEntry(entry)) continue;
		if (byDate.has(entry.date)) warnings.push(`${entry.date}: duplicate date, using the last one`);
		byDate.set(entry.date, entry);
	}
	const entries = [...byDate.values()].sort((a, b) => compareIso(a.date, b.date));
	return { entries, warnings };
}

/** True when an entry carries no data and should be deleted rather than stored (spec §3.2). */
export function isEmptyEntry(entry: Entry): boolean {
	return (
		entry.flow === undefined &&
		(entry.symptoms === undefined || entry.symptoms.length === 0) &&
		(entry.note === undefined || entry.note.trim() === '') &&
		entry.bbt === undefined &&
		entry.lh === undefined &&
		entry.ovulation === undefined
	);
}

/** Normalise an entry coming from the UI before it is written. */
export function cleanEntry(entry: Entry): Entry {
	const out: Entry = { date: entry.date };
	if (entry.flow) out.flow = entry.flow;
	const symptoms = entry.symptoms ? normalizeSymptoms(entry.symptoms) : [];
	if (symptoms.length) out.symptoms = symptoms;
	const note = entry.note?.trim();
	if (note) out.note = note;
	if (entry.bbt !== undefined && Number.isFinite(entry.bbt)) out.bbt = entry.bbt;
	if (entry.lh) out.lh = entry.lh;
	if (entry.ovulation !== undefined) out.ovulation = entry.ovulation;
	return out;
}

/** Plain object for YAML, known keys in a stable order, then any extra (unknown) keys. */
export function serializeEntry(entry: Entry, extra: RawObject = {}): RawObject {
	const out: RawObject = {};
	for (const key of KNOWN_KEYS) {
		const value = entry[key];
		if (value !== undefined) out[key] = Array.isArray(value) ? [...value] : value;
	}
	for (const [key, value] of Object.entries(extra)) {
		if (!KNOWN_KEY_SET.has(key)) out[key] = value;
	}
	return out;
}

function unknownKeys(item: RawObject): RawObject {
	const extra: RawObject = {};
	for (const [key, value] of Object.entries(item)) if (!KNOWN_KEY_SET.has(key)) extra[key] = value;
	return extra;
}

/**
 * Prepare a raw list for writing: items with a valid date get their date normalised to a
 * string (so a coerced Date is not written back as a timestamp) and are sorted; anything
 * unrecognisable is kept, untouched, at the end.
 */
function tidyRaw(raw: readonly unknown[]): unknown[] {
	const dated: { date: IsoDate; item: RawObject }[] = [];
	const rest: unknown[] = [];
	for (const item of raw) {
		const date = isPlainObject(item) ? normalizeDate(item.date) : null;
		if (date && isPlainObject(item)) dated.push({ date, item: item.date === date ? item : { ...item, date } });
		else rest.push(item);
	}
	dated.sort((a, b) => compareIso(a.date, b.date)); // stable: duplicates keep their order
	return [...dated.map((d) => d.item), ...rest];
}

/**
 * Insert or replace the entry for `entry.date` in a raw `entries` list. Unknown keys on the
 * replaced item are kept. An empty entry deletes the date instead (spec §3.2).
 */
export function upsertRaw(raw: readonly unknown[], entry: Entry): unknown[] {
	const clean = cleanEntry(entry);
	if (!isIsoDate(clean.date)) throw new RangeError(`Invalid ISO date: ${JSON.stringify(clean.date)}`);
	let extra: RawObject = {};
	const kept: unknown[] = [];
	for (const item of raw) {
		if (isPlainObject(item) && normalizeDate(item.date) === clean.date) {
			extra = { ...extra, ...unknownKeys(item) };
		} else {
			kept.push(item);
		}
	}
	if (!isEmptyEntry(clean)) kept.push(serializeEntry(clean, extra));
	return tidyRaw(kept);
}

/** Remove every item for `date` from a raw `entries` list. */
export function removeRaw(raw: readonly unknown[], date: IsoDate): unknown[] {
	return tidyRaw(raw.filter((item) => !(isPlainObject(item) && normalizeDate(item.date) === date)));
}

/** The YAML text between the opening and closing `---` lines, or null if there is none. */
export function extractFrontmatter(text: string): string | null {
	const m = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return null;
	return m[1] ?? '';
}

function preview(value: unknown): string {
	try {
		const s = value instanceof Date ? value.toISOString() : JSON.stringify(value);
		return s === undefined ? String(value) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
	} catch {
		return String(value);
	}
}
