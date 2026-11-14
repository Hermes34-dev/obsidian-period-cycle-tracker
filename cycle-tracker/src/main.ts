import { Plugin, WorkspaceLeaf, normalizePath } from 'obsidian';
import { todayIso } from './core/dates';
import type { IsoDate } from './core/types';
import { LogStore } from './data/LogStore';
import { DayModal } from './modal/DayModal';
import { CycleSettingTab, CycleTrackerSettings, DEFAULT_SETTINGS, DEFAULT_SYMPTOMS } from './settings';
import { CycleView, VIEW_TYPE_CYCLE } from './view/CycleView';

export default class CycleTrackerPlugin extends Plugin {
	settings!: CycleTrackerSettings;
	store!: LogStore;
	private lastLogPath = '';

	async onload(): Promise<void> {
		await this.loadSettings();

		this.store = new LogStore(this.app, {
			getPath: () => this.settings.logFilePath,
			onRenamed: (newPath) => {
				// Follow the file when it is renamed/moved inside Obsidian.
				this.settings.logFilePath = newPath;
				this.lastLogPath = normalizePath(newPath);
				void this.saveData(this.settings);
			},
		});
		this.store.registerEvents(this);
		this.app.workspace.onLayoutReady(() => void this.store.reload());

		this.registerView(VIEW_TYPE_CYCLE, (leaf) => new CycleView(leaf, this));

		this.addRibbonIcon('droplet', 'Open Cycle Tracker', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-cycle-tracker',
			name: 'Open calendar and dashboard',
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: 'open-log-file',
			name: 'Open cycle log file',
			callback: () => {
				void this.store.openLogFile();
			},
		});

		this.addCommand({
			id: 'log-today',
			name: 'Log today',
			callback: () => this.openDay(todayIso()),
		});

		this.addSettingTab(new CycleSettingTab(this.app, this));
	}

	onunload(): void {
		// Listeners registered via register*/registerEvent are cleaned up automatically.
		// Leaves are intentionally not detached (Obsidian plugin guidelines).
	}

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<CycleTrackerSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (!Array.isArray(this.settings.symptoms)) this.settings.symptoms = [...DEFAULT_SYMPTOMS];
		this.lastLogPath = normalizePath(this.settings.logFilePath);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		const path = normalizePath(this.settings.logFilePath);
		if (path !== this.lastLogPath) {
			this.lastLogPath = path;
			await this.store.reload(); // emits → views re-render
		} else {
			this.refreshViews();
		}
	}

	/** Open the day modal for a date. */
	openDay(date: IsoDate): void {
		new DayModal(this.app, this.store, date, this.settings.symptoms, this.settings.flowColor).open();
	}

	/** Re-render every open Cycle Tracker view. */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CYCLE)) {
			const view = leaf.view;
			if (view instanceof CycleView) view.render();
		}
	}

	/** Reveal an existing Cycle Tracker tab, or open a new one in the main area. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CYCLE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE_CYCLE, active: true });
		}
		// setActiveLeaf instead of revealLeaf: the latter's async form needs Obsidian 1.7.2+.
		workspace.setActiveLeaf(leaf, { focus: true });
	}
}
