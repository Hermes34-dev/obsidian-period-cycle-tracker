import { ItemView, WorkspaceLeaf } from 'obsidian';
import { predictionMarks } from '../core/calendar';
import { todayIso } from '../core/dates';
import { analyze } from '../core/predict';
import type CycleTrackerPlugin from '../main';
import { DISCLAIMER } from '../settings';
import { Calendar } from './Calendar';
import { Dashboard } from './Dashboard';

export const VIEW_TYPE_CYCLE = 'cycle-tracker-view';

/** Container width (px) below which the two panels stack vertically. */
const STACK_BREAKPOINT = 700;
/** Container width (px) below which spacing is tightened (phones, narrow sidebars). */
const NARROW_BREAKPOINT = 420;

export class CycleView extends ItemView {
	private plugin: CycleTrackerPlugin;
	private rootEl!: HTMLElement;
	private calendarEl!: HTMLElement;
	private dashboardEl!: HTMLElement;
	private resizeObserver: ResizeObserver | null = null;
	private calendar: Calendar | null = null;
	private dashboard: Dashboard | null = null;
	private renderedToday = '';

	constructor(leaf: WorkspaceLeaf, plugin: CycleTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CYCLE;
	}

	getDisplayText(): string {
		return 'Cycle Tracker';
	}

	getIcon(): string {
		return 'droplet';
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('ct-view');

		this.rootEl = container.createDiv({ cls: 'ct-layout' });
		this.calendarEl = this.rootEl.createDiv({ cls: 'ct-panel ct-calendar-panel' });
		this.dashboardEl = this.rootEl.createDiv({ cls: 'ct-panel ct-dashboard-panel' });
		this.calendar = new Calendar(this.calendarEl, {
			onDayClick: (date) => this.plugin.openDay(date),
		});
		this.dashboard = new Dashboard(this.dashboardEl, {
			onLogToday: () => this.plugin.openDay(todayIso()),
		});

		// Pane width, not viewport width, decides the layout (panes can be narrow on wide screens).
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const width = entry.contentRect.width;
				if (width === 0) continue; // hidden tab: keep the last layout
				this.rootEl.toggleClass('ct-stacked', width < STACK_BREAKPOINT);
				container.toggleClass('ct-narrow', width < NARROW_BREAKPOINT);
			}
		});
		this.resizeObserver.observe(container);

		// Re-render on any log change (our own saves and manual edits alike).
		this.register(this.plugin.store.onChange(() => this.render()));
		// Roll "today" over at midnight.
		this.registerInterval(
			window.setInterval(() => {
				if (todayIso() !== this.renderedToday) this.render();
			}, 60_000),
		);
		this.render();
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.contentEl.empty();
	}

	/** Re-render everything. Called on open, on log changes, on settings changes and at midnight. */
	render(): void {
		if (!this.rootEl) return;
		this.rootEl.style.setProperty('--ct-flow-color', this.plugin.settings.flowColor);

		const store = this.plugin.store;
		const entries = store.getEntries();
		const readError = store.getReadError();

		if (readError) {
			this.renderReadError(readError);
			return;
		}

		const settings = this.plugin.settings;
		const today = todayIso();
		this.renderedToday = today;
		const analysis = analyze(entries, settings, today);

		this.calendar?.render({
			entries,
			today,
			weekStart: settings.firstDayOfWeek === 'sunday' ? 0 : 1,
			marks: predictionMarks(analysis, today, settings.showFertileWindow, settings.showPastEstimates),
			showFertileWindow: settings.showFertileWindow,
			showPastEstimates: settings.showFertileWindow && settings.showPastEstimates,
		});
		this.dashboard?.render({
			analysis,
			today,
			showFertileWindow: settings.showFertileWindow,
		});
	}

	/** Shown instead of the calendar/dashboard while the log file cannot be parsed. */
	private renderReadError(message: string): void {
		this.calendarEl.empty();
		this.dashboardEl.empty();
		const box = this.calendarEl.createDiv({ cls: 'ct-error' });
		box.createEl('h3', { text: 'Cannot read the cycle log' });
		box.createEl('p', { text: message });
		box.createEl('p', {
			cls: 'ct-placeholder',
			text: 'Nothing is saved until this is fixed, so your data is safe. Open the file in source mode and correct the frontmatter.',
		});
		const btn = box.createEl('button', { text: 'Open log file', cls: 'mod-cta' });
		btn.addEventListener('click', () => void this.plugin.store.openLogFile());
		this.dashboardEl.createDiv({ cls: 'ct-disclaimer', text: DISCLAIMER });
	}
}
