import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { extractFrontmatter, parseEntries, upsertRaw } from '../src/core/entries';
import { replaceFrontmatter, serializeEntriesYaml, yamlErrorHint } from '../src/core/yaml';

/** Parse as YAML 1.1, where unquoted dates become timestamps: the strictest test for quoting. */
const parse11 = (s: string): unknown => parse(s, { version: '1.1' });
const parse12 = (s: string): unknown => parse(s);

describe('serializeEntriesYaml', () => {
	it('writes an empty list inline', () => {
		expect(serializeEntriesYaml([])).toBe('entries: []');
	});

	it('matches the documented layout, with quoted dates', () => {
		const out = serializeEntriesYaml([
			{ date: '2026-11-02', flow: 'heavy', symptoms: ['cramps', 'fatigue'] },
			{ date: '2026-11-03', flow: 'medium', symptoms: ['back pain'], note: 'ok' },
			{ date: '2026-11-04', flow: 'light' },
		]);
		expect(out).toBe(
			[
				'entries:',
				'  - date: "2026-11-02"',
				'    flow: heavy',
				'    symptoms: [cramps, fatigue]',
				'  - date: "2026-11-03"',
				'    flow: medium',
				'    symptoms: [back pain]',
				'    note: "ok"',
				'  - date: "2026-11-04"',
				'    flow: light',
			].join('\n'),
		);
	});

	it('quotes anything that is not plainly safe', () => {
		const out = serializeEntriesYaml([
			{ date: '2026-11-02', symptoms: ['yes', 'no', 'null', 'true', 'a: b', '#tag', '[x]', 'héllo', '3', ' padded'], note: 'line1\nline2 "quoted" # not a comment' },
		]);
		const parsed = parse11(out) as { entries: { symptoms: string[]; note: string }[] };
		expect(parsed.entries[0]!.symptoms).toEqual(['yes', 'no', 'null', 'true', 'a: b', '#tag', '[x]', 'héllo', '3', ' padded']);
		expect(parsed.entries[0]!.note).toBe('line1\nline2 "quoted" # not a comment');
	});

	it('writes numbers, booleans, unknown keys and malformed items', () => {
		const raw = [
			{ date: '2026-11-02', bbt: 36.55, lh: 'positive', ovulation: true, 'weird key': { a: [1, 2] }, list: [{ x: 1 }] },
			'garbage',
			{ date: 'tomorrow' },
			42,
			{},
		];
		const parsed = parse11(serializeEntriesYaml(raw)) as { entries: unknown[] };
		expect(parsed.entries).toEqual(raw);
	});

	it('round-trips through YAML 1.1 and 1.2 with dates kept as strings', () => {
		const raw = upsertRaw(
			[
				{ date: '2026-11-10', flow: 'heavy', symptoms: ['headache', 'my weird symptom'] },
				{ date: '2026-12-01', flow: 'spotting', note: 'light day: fine' },
			],
			{ date: '2026-11-14', flow: 'medium', symptoms: ['cramps'] },
		);
		const yamlText = serializeEntriesYaml(raw);
		for (const p of [parse11, parse12]) {
			const parsed = p(yamlText) as { entries: unknown[] };
			expect(parsed.entries).toEqual(raw);
			expect(parseEntries(parsed.entries).warnings).toEqual([]);
		}
	});
});

describe('replaceFrontmatter', () => {
	const body = '\n# Cycle log\n\nSome text.\n';

	it('replaces an existing block and keeps the body', () => {
		const text = `---\ncycle-log-version: 1\nentries: []\n---\n${body}`;
		const out = replaceFrontmatter(text, 'cycle-log-version: 1\nentries:\n  - date: "2026-11-02"\n    flow: heavy\n');
		expect(out).toBe(`---\ncycle-log-version: 1\nentries:\n  - date: "2026-11-02"\n    flow: heavy\n---\n${body}`);
		expect(extractFrontmatter(out)).toBe('cycle-log-version: 1\nentries:\n  - date: "2026-11-02"\n    flow: heavy');
	});

	it('handles CRLF and a BOM', () => {
		const out = replaceFrontmatter('﻿---\r\na: 1\r\n---\r\nbody', 'a: 2');
		expect(out).toBe('﻿---\na: 2\n---\nbody');
	});

	it('adds a block when there is none', () => {
		expect(replaceFrontmatter('# Note\n', 'a: 1')).toBe('---\na: 1\n---\n\n# Note\n');
		expect(replaceFrontmatter('', 'a: 1')).toBe('---\na: 1\n---\n');
	});
});

describe('yamlErrorHint', () => {
	it('detects tab indentation', () => {
		expect(yamlErrorHint('entries:\n  - date: "2026-11-10"\n\tflow: heavy')).toMatch(/tab/);
		expect(yamlErrorHint('entries:\n  - date: "2026-11-10"\n  \t- x')).toMatch(/tab/);
	});

	it('returns null otherwise', () => {
		expect(yamlErrorHint('entries:\n  - date: "2026-11-10"\n    note: "a\tb"')).toBeNull();
	});
});
