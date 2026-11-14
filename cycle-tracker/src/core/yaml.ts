// PURE MODULE — must not import from 'obsidian' (unit-tested with plain Node).
//
// A tiny, deterministic YAML writer for the `entries` list. We write this block ourselves
// because Obsidian's stringifier leaves date-like strings unquoted (`date: 2026-11-02`),
// which other YAML tools coerce to timestamps. Here dates are always double-quoted
// (spec §3.2) and the layout matches the documented template.
//
// Strings that are not provably safe as plain scalars are written with JSON.stringify:
// JSON strings are valid YAML double-quoted scalars.

/** Keys/values that YAML (1.1 or 1.2) would read as something other than a string. */
const RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i;
/** Lower-case words, digits, spaces, `_` and `-`, starting with a letter. */
const SAFE_PLAIN = /^[a-z][a-z0-9 _-]*$/i;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Fields whose string values are always quoted, even when they would be safe plain. */
const ALWAYS_QUOTED = new Set(['date', 'note']);

function quote(s: string): string {
	return JSON.stringify(s);
}

function isPlainSafe(s: string): boolean {
	return SAFE_PLAIN.test(s) && !s.endsWith(' ') && !RESERVED.test(s);
}

function key(k: string): string {
	return SAFE_KEY.test(k) && !RESERVED.test(k) ? k : quote(k);
}

/** JSON is valid flow-style YAML; Dates become ISO strings, non-finite numbers null. */
function toJsonYaml(value: unknown): string {
	const json = JSON.stringify(value, (_k, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
	return json === undefined ? 'null' : json;
}

function scalar(value: unknown, field: string): string {
	if (typeof value === 'string') return !ALWAYS_QUOTED.has(field) && isPlainSafe(value) ? value : quote(value);
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (value === null || value === undefined) return 'null';
	if (Array.isArray(value)) {
		if (value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
			return `[${value.map((v) => scalar(v, '')).join(', ')}]`;
		}
		return toJsonYaml(value);
	}
	return toJsonYaml(value);
}

/** Serialise the raw `entries` list as a complete `entries:` YAML block (no trailing newline). */
export function serializeEntriesYaml(entries: readonly unknown[]): string {
	if (entries.length === 0) return 'entries: []';
	const lines = ['entries:'];
	for (const item of entries) {
		if (typeof item !== 'object' || item === null || Array.isArray(item) || item instanceof Date) {
			lines.push(`  - ${scalar(item, '')}`);
			continue;
		}
		const pairs = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
		if (pairs.length === 0) {
			lines.push('  - {}');
			continue;
		}
		pairs.forEach(([k, v], i) => {
			lines.push(`${i === 0 ? '  - ' : '    '}${key(k)}: ${scalar(v, k)}`);
		});
	}
	return lines.join('\n');
}

/**
 * Replace the frontmatter block of a Markdown document with `yamlBody` (no `---` lines),
 * keeping the body untouched. Adds a frontmatter block if there is none.
 */
export function replaceFrontmatter(text: string, yamlBody: string): string {
	const body = yamlBody.replace(/\s+$/, '');
	const block = `---\n${body}\n---\n`;
	const m = /^(\uFEFF?)---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return block + (text.startsWith('\n') || text === '' ? text : `\n${text}`);
	return m[1] + block + text.slice(m[0].length);
}

/** A human hint for common hand-editing mistakes in a YAML block that failed to parse. */
export function yamlErrorHint(yamlText: string): string | null {
	if (/^[ ]*\t/m.test(yamlText)) {
		return 'It contains tab characters. YAML only allows spaces for indentation.';
	}
	return null;
}
