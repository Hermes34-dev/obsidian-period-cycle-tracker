import { App, Component, Notice, TFile, TFolder, debounce, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { LOG_VERSION, extractFrontmatter, parseEntries, removeRaw, upsertRaw } from '../core/entries';
import { replaceFrontmatter, serializeEntriesYaml, yamlErrorHint } from '../core/yaml';
import type { Entry, IsoDate } from '../core/types';

const LOG_PREFIX = '[Cycle Tracker]';

export const LOG_TEMPLATE = `---
cycle-log-version: ${LOG_VERSION}
entries: []
---

# Cycle log

This file is managed by the **Cycle Tracker** plugin. You can edit the
frontmatter by hand; the plugin will pick up changes automatically.

If you move or rename this file inside Obsidian, the plugin follows it.
If you move it outside Obsidian, update the path in Settings → Cycle Tracker.
`;

export interface LogStoreOptions {
	/** Current log file path from settings. */
	getPath: () => string;
	/** Called when the log file (or a parent folder) is renamed/moved inside Obsidian. */
	onRenamed: (newPath: string) => void;
}

type Mutator = (raw: readonly unknown[]) => unknown[];

/**
 * Owns the log file: reads and parses it, writes through processFrontMatter, creates it on
 * first write, and notifies listeners whenever its contents change (including manual edits).
 */
export class LogStore {
	private entries: Entry[] = [];
	private fileExists = false;
	private readError: string | null = null;
	private loaded = false;
	private readonly listeners = new Set<() => void>();
	private writeQueue: Promise<unknown> = Promise.resolve();
	private reloadToken = 0;
	private readonly scheduleReload = debounce(() => void this.reload(), 150, true);

	constructor(
		private readonly app: App,
		private readonly opts: LogStoreOptions,
	) {}

	get path(): string {
		return normalizePath(this.opts.getPath());
	}

	/** Entries sorted by date (read-only snapshot). */
	getEntries(): readonly Entry[] {
		return this.entries;
	}

	getEntry(date: IsoDate): Entry | undefined {
		return this.entries.find((e) => e.date === date);
	}

	hasFile(): boolean {
		return this.fileExists;
	}

	/** Why the log file could not be read (e.g. invalid YAML), or null if it is fine. */
	getReadError(): string | null {
		return this.readError;
	}

	isLoaded(): boolean {
		return this.loaded;
	}

	/** Subscribe to changes. Returns an unsubscribe function. */
	onChange(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	/** Register vault/metadata listeners on a component (the plugin) so they are cleaned up on unload. */
	registerEvents(component: Component): void {
		const { vault, metadataCache } = this.app;

		component.registerEvent(
			metadataCache.on('changed', (file) => {
				if (file.path === this.path) this.scheduleReload();
			}),
		);
		component.registerEvent(
			vault.on('create', (file) => {
				if (file.path === this.path) this.scheduleReload();
			}),
		);
		component.registerEvent(
			vault.on('delete', (file) => {
				if (file.path === this.path || this.path.startsWith(`${file.path}/`)) this.scheduleReload();
			}),
		);
		component.registerEvent(
			vault.on('rename', (file, oldPath) => {
				const current = this.path;
				if (file instanceof TFile && oldPath === current) {
					this.opts.onRenamed(file.path);
				} else if (file instanceof TFolder && current.startsWith(`${oldPath}/`)) {
					this.opts.onRenamed(file.path + current.slice(oldPath.length));
				} else if (file.path !== current) {
					return; // unrelated file
				}
				this.scheduleReload();
			}),
		);
	}

	/** Re-read the log file and notify listeners. Safe to call at any time. */
	async reload(): Promise<void> {
		const token = ++this.reloadToken;
		const file = this.getFile();
		let entries: Entry[] = [];
		let readError: string | null = null;
		if (file) {
			try {
				const raw = await this.readFrontmatter(file);
				const { entries: parsed, warnings } = parseEntries(raw?.entries);
				for (const w of warnings) console.warn(`${LOG_PREFIX} ${file.path}: ${w}`);
				entries = parsed;
			} catch (err) {
				readError = err instanceof Error ? err.message : String(err);
				console.warn(`${LOG_PREFIX} Could not read ${file.path}`, err);
			}
		}
		if (token !== this.reloadToken) return; // a newer reload superseded this one
		this.entries = entries;
		this.readError = readError;
		this.fileExists = file !== null;
		this.loaded = true;
		this.emit();
	}

	/** Insert or replace the entry for its date. An empty entry deletes the day. */
	async upsert(entry: Entry): Promise<boolean> {
		return this.write((raw) => upsertRaw(raw, entry), true);
	}

	/** Delete the entry for a date ("Clear day"). Does not create the file. */
	async remove(date: IsoDate): Promise<boolean> {
		if (!this.getFile()) return true;
		return this.write((raw) => removeRaw(raw, date), false);
	}

	/** Return the log file, creating it (and its folders) from the template if missing. */
	async ensureFile(): Promise<TFile> {
		const path = this.path;
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		if (existing) throw new Error(`"${path}" exists but is a folder`);

		const slash = path.lastIndexOf('/');
		if (slash > 0) await this.ensureFolder(path.slice(0, slash));
		return this.app.vault.create(path, LOG_TEMPLATE);
	}

	/** Open the log file in the current tab, creating it first if needed. */
	async openLogFile(): Promise<void> {
		try {
			const file = await this.ensureFile();
			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (err) {
			this.reportError('Could not open the log file', err);
		}
	}

	private getFile(): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.path);
		return f instanceof TFile ? f : null;
	}

	private async readFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
		const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (cached) return cached;
		// Cache not ready (e.g. file just created), no frontmatter, or invalid YAML (Obsidian then
		// drops it from the cache): parse the file ourselves so we can report what is wrong.
		return parseFrontmatterOf(await this.app.vault.cachedRead(file));
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		let current = '';
		for (const part of folderPath.split('/')) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(`"${current}" exists but is not a folder`);
			await this.app.vault.createFolder(current);
		}
	}

	/** Serialise writes so concurrent saves cannot clobber each other. */
	private write(mutate: Mutator, createIfMissing: boolean): Promise<boolean> {
		const run = async (): Promise<boolean> => {
			const file = createIfMissing ? await this.ensureFile() : this.getFile();
			if (!file) return true;
			// vault.process is an atomic read-modify-write. We use it instead of
			// processFrontMatter because Obsidian's YAML writer leaves dates unquoted.
			// Throwing inside the callback aborts the write, so a broken file is never overwritten.
			await this.app.vault.process(file, (text) => {
				const fm = parseFrontmatterOf(text) ?? {};
				const version = Number(fm['cycle-log-version'] ?? LOG_VERSION);
				if (Number.isFinite(version) && version > LOG_VERSION) {
					throw new Error(`the log file uses a newer format (version ${version}); update the plugin`);
				}
				const current = fm.entries;
				if (current !== undefined && current !== null && !Array.isArray(current)) {
					throw new Error('`entries` in the log file is not a list; fix it by hand first');
				}
				const entries = mutate(Array.isArray(current) ? current : []);

				const others: Record<string, unknown> = { ...fm };
				delete others['cycle-log-version'];
				delete others.entries;
				const parts = [`cycle-log-version: ${Number.isFinite(version) ? version : LOG_VERSION}`];
				if (Object.keys(others).length) parts.push(stringifyYaml(others).trimEnd());
				parts.push(serializeEntriesYaml(entries));
				return replaceFrontmatter(text, parts.join('\n'));
			});
			return true;
		};
		const result = this.writeQueue.then(run, run).catch((err: unknown) => {
			this.reportError('Could not save', err);
			return false;
		});
		this.writeQueue = result;
		return result;
	}

	private reportError(what: string, err: unknown): void {
		console.error(`${LOG_PREFIX} ${what}`, err);
		const msg = err instanceof Error ? err.message : String(err);
		new Notice(`Cycle Tracker: ${what.toLowerCase()} — ${msg}`);
	}

	private emit(): void {
		for (const cb of this.listeners) {
			try {
				cb();
			} catch (err) {
				console.error(`${LOG_PREFIX} change listener failed`, err);
			}
		}
	}
}

/**
 * Parse the frontmatter of a document into an object. Returns null when there is none.
 * Throws a readable Error when the YAML is invalid or is not a set of properties.
 */
function parseFrontmatterOf(text: string): Record<string, unknown> | null {
	const block = extractFrontmatter(text);
	if (block === null || block.trim() === '') return null;
	let parsed: unknown;
	try {
		parsed = parseYaml(block);
	} catch (err) {
		const hint = yamlErrorHint(block);
		const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
		throw new Error(`The log file's frontmatter is not valid YAML. ${hint ?? `(${detail})`}`);
	}
	if (parsed === null || parsed === undefined) return null;
	if (typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error("The log file's frontmatter is not a set of properties.");
	}
	return parsed as Record<string, unknown>;
}
