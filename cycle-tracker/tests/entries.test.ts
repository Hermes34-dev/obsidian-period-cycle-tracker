import { describe, expect, it } from 'vitest';
import {
	cleanEntry,
	extractFrontmatter,
	isEmptyEntry,
	normalizeDate,
	normalizeEntry,
	parseEntries,
	removeRaw,
	upsertRaw,
} from '../src/core/entries';

describe('normalizeDate', () => {
	it('accepts ISO strings and YAML-coerced Dates', () => {
		expect(normalizeDate('2026-11-02')).toBe('2026-11-02');
		expect(normalizeDate(' 2026-11-02 ')).toBe('2026-11-02');
		expect(normalizeDate(new Date(Date.UTC(2026, 10, 2)))).toBe('2026-11-02');
	});

	it('rejects everything else', () => {
		expect(normalizeDate('2026-11-31')).toBeNull();
		expect(normalizeDate('Nov 2')).toBeNull();
		expect(normalizeDate(20261102)).toBeNull();
		expect(normalizeDate(new Date('nope'))).toBeNull();
		expect(normalizeDate(undefined)).toBeNull();
	});
});

describe('normalizeEntry', () => {
	it('keeps valid fields and normalises case', () => {
		const { entry, warnings } = normalizeEntry({
			date: '2026-11-02',
			flow: 'Heavy',
			symptoms: ['Cramps', ' fatigue ', 'cramps', 'my custom thing'],
			note: '  ouch  ',
			bbt: '36.6',
			lh: 'POSITIVE',
			ovulation: false,
		});
		expect(warnings).toEqual([]);
		expect(entry).toEqual({
			date: '2026-11-02',
			flow: 'heavy',
			symptoms: ['cramps', 'fatigue', 'my custom thing'],
			note: 'ouch',
			bbt: 36.6,
			lh: 'positive',
			ovulation: false,
		});
	});

	it('accepts a comma-separated symptom string', () => {
		expect(normalizeEntry({ date: '2026-11-02', symptoms: 'cramps, Headache' }).entry?.symptoms).toEqual(['cramps', 'headache']);
	});

	it('drops invalid fields with a warning but keeps the entry', () => {
		const { entry, warnings } = normalizeEntry({ date: '2026-11-02', flow: 'torrential', symptoms: 5, bbt: 'hot', lh: 'maybe', ovulation: 'yes', note: 'kept' });
		expect(entry).toEqual({ date: '2026-11-02', note: 'kept' });
		expect(warnings).toHaveLength(5);
	});

	it('skips items without a valid date', () => {
		expect(normalizeEntry({ flow: 'heavy' }).entry).toBeNull();
		expect(normalizeEntry({ date: '2026-02-30', flow: 'heavy' }).entry).toBeNull();
		expect(normalizeEntry('2026-11-02').entry).toBeNull();
		expect(normalizeEntry(null).entry).toBeNull();
		expect(normalizeEntry(['2026-11-02']).entry).toBeNull();
	});
});

describe('parseEntries', () => {
	it('returns nothing for missing entries', () => {
		expect(parseEntries(undefined)).toEqual({ entries: [], warnings: [] });
		expect(parseEntries(null)).toEqual({ entries: [], warnings: [] });
		expect(parseEntries([])).toEqual({ entries: [], warnings: [] });
	});

	it('warns instead of throwing when entries is not a list', () => {
		const r = parseEntries({ date: '2026-11-02' });
		expect(r.entries).toEqual([]);
		expect(r.warnings).toHaveLength(1);
	});

	it('skips malformed items, sorts, and dedupes (last wins)', () => {
		const r = parseEntries([
			{ date: '2026-11-04', flow: 'light' },
			'garbage',
			{ date: '2026-11-02', flow: 'heavy' },
			{ date: 'tomorrow', flow: 'heavy' },
			{ date: '2026-11-03', flow: 'medium' },
			{ date: '2026-11-02', flow: 'medium', note: 'corrected' },
		]);
		expect(r.entries.map((e) => e.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
		expect(r.entries[0]).toEqual({ date: '2026-11-02', flow: 'medium', note: 'corrected' });
		expect(r.warnings).toHaveLength(3); // garbage, bad date, duplicate
	});

	it('silently drops entries that carry no data', () => {
		expect(parseEntries([{ date: '2026-11-02' }, { date: '2026-11-03', symptoms: [] }]).entries).toEqual([]);
	});
});

describe('isEmptyEntry / cleanEntry', () => {
	it('detects empty entries', () => {
		expect(isEmptyEntry({ date: '2026-11-02' })).toBe(true);
		expect(isEmptyEntry({ date: '2026-11-02', symptoms: [], note: '  ' })).toBe(true);
		expect(isEmptyEntry({ date: '2026-11-02', flow: 'spotting' })).toBe(false);
		expect(isEmptyEntry({ date: '2026-11-02', ovulation: false })).toBe(false);
	});

	it('cleans UI input', () => {
		expect(cleanEntry({ date: '2026-11-02', symptoms: ['Cramps', 'cramps', ''], note: ' ' })).toEqual({ date: '2026-11-02', symptoms: ['cramps'] });
	});
});

describe('upsertRaw', () => {
	it('inserts in date order', () => {
		const raw = [{ date: '2026-11-01', flow: 'heavy' }, { date: '2026-11-05', flow: 'light' }];
		const out = upsertRaw(raw, { date: '2026-11-03', flow: 'medium', symptoms: ['cramps'] });
		expect(out).toEqual([
			{ date: '2026-11-01', flow: 'heavy' },
			{ date: '2026-11-03', flow: 'medium', symptoms: ['cramps'] },
			{ date: '2026-11-05', flow: 'light' },
		]);
		expect(raw).toHaveLength(2); // input not mutated
	});

	it('replaces the same date (including duplicates) and keeps unknown keys', () => {
		const raw = [
			{ date: '2026-11-02', flow: 'heavy', mood: 'meh', symptoms: ['cramps'] },
			{ date: '2026-11-02', flow: 'light' },
		];
		expect(upsertRaw(raw, { date: '2026-11-02', flow: 'medium' })).toEqual([{ date: '2026-11-02', flow: 'medium', mood: 'meh' }]);
	});

	it('deletes the date when the new entry is empty', () => {
		const raw = [{ date: '2026-11-02', flow: 'heavy' }, { date: '2026-11-03', flow: 'light' }];
		expect(upsertRaw(raw, { date: '2026-11-02', symptoms: [] })).toEqual([{ date: '2026-11-03', flow: 'light' }]);
	});

	it('keeps malformed items untouched at the end', () => {
		const raw = ['garbage', { date: 'tomorrow', flow: 'heavy' }, { date: '2026-11-03', flow: 'light' }];
		expect(upsertRaw(raw, { date: '2026-11-01', flow: 'heavy' })).toEqual([
			{ date: '2026-11-01', flow: 'heavy' },
			{ date: '2026-11-03', flow: 'light' },
			'garbage',
			{ date: 'tomorrow', flow: 'heavy' },
		]);
	});

	it('rewrites YAML-coerced Date values as ISO strings', () => {
		const raw = [{ date: new Date(Date.UTC(2026, 10, 1)), flow: 'heavy' }];
		expect(upsertRaw(raw, { date: '2026-11-02', flow: 'heavy' })).toEqual([
			{ date: '2026-11-01', flow: 'heavy' },
			{ date: '2026-11-02', flow: 'heavy' },
		]);
	});

	it('writes known keys in a stable order', () => {
		const [item] = upsertRaw([], { note: 'n', symptoms: ['acne'], flow: 'light', date: '2026-11-02' } as never) as object[];
		expect(Object.keys(item!)).toEqual(['date', 'flow', 'symptoms', 'note']);
	});

	it('rejects an invalid date', () => {
		expect(() => upsertRaw([], { date: '2026-02-30', flow: 'heavy' })).toThrow(RangeError);
	});
});

describe('removeRaw', () => {
	it('removes every item for the date and leaves the rest', () => {
		const raw = [{ date: '2026-11-02', flow: 'heavy' }, 'garbage', { date: '2026-11-02' }, { date: '2026-11-03', flow: 'light' }];
		expect(removeRaw(raw, '2026-11-02')).toEqual([{ date: '2026-11-03', flow: 'light' }, 'garbage']);
	});

	it('is a no-op for unknown dates', () => {
		expect(removeRaw([{ date: '2026-11-03', flow: 'light' }], '2026-11-02')).toEqual([{ date: '2026-11-03', flow: 'light' }]);
	});
});

describe('extractFrontmatter', () => {
	it('extracts the YAML block', () => {
		expect(extractFrontmatter('---\ncycle-log-version: 1\nentries: []\n---\n\n# Cycle log\n')).toBe('cycle-log-version: 1\nentries: []');
	});

	it('handles CRLF, BOM, empty blocks and files without a body', () => {
		expect(extractFrontmatter('﻿---\r\na: 1\r\n---\r\nbody')).toBe('a: 1');
		expect(extractFrontmatter('---\n---\nbody')).toBe('');
		expect(extractFrontmatter('---\na: 1\n---')).toBe('a: 1');
	});

	it('returns null without frontmatter', () => {
		expect(extractFrontmatter('# Just a note\n---\na: 1\n---')).toBeNull();
		expect(extractFrontmatter('')).toBeNull();
		expect(extractFrontmatter('---\na: 1\n')).toBeNull();
	});
});
