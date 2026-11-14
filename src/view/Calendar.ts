import { moment, setIcon } from 'obsidian';
import {
	isInMonth,
	monthGrid,
	shiftMonth,
	weekdayOrder,
	yearMonthOf,
	type PredictionMarks,
	type WeekStartDay,
	type YearMonth,
} from '../core/calendar';
import type { Entry, IsoDate } from '../core/types';

export interface CalendarData {
	entries: readonly Entry[];
	today: IsoDate;
	weekStart: WeekStartDay;
	marks: PredictionMarks;
	showFertileWindow: boolean;
	showPastEstimates: boolean;
}

export interface CalendarOptions {
	onDayClick: (date: IsoDate) => void;
}

const FLOW_LABEL: Record<string, string> = {
	spotting: 'Spotting',
	light: 'Light flow',
	medium: 'Medium flow',
	heavy: 'Heavy flow',
};

/** Month grid with navigation. Keeps the displayed month across re-renders. */
export class Calendar {
	private shown: YearMonth | null = null;
	private data: CalendarData | null = null;

	constructor(
		private readonly containerEl: HTMLElement,
		private readonly opts: CalendarOptions,
	) {}

	render(data: CalendarData): void {
		this.data = data;
		if (!this.shown) this.shown = yearMonthOf(data.today);
		this.draw();
	}

	private go(delta: number | 'today'): void {
		if (!this.data || !this.shown) return;
		this.shown = delta === 'today' ? yearMonthOf(this.data.today) : shiftMonth(this.shown, delta);
		this.draw();
	}

	private draw(): void {
		const data = this.data;
		const shown = this.shown;
		if (!data || !shown) return;

		const el = this.containerEl;
		el.empty();
		el.addClass('ct-calendar');

		// Header: ‹ · Month Year · › · Today
		const header = el.createDiv({ cls: 'ct-cal-header' });
		const prev = header.createEl('button', { cls: 'ct-cal-nav clickable-icon', attr: { 'aria-label': 'Previous month' } });
		setIcon(prev, 'chevron-left');
		prev.addEventListener('click', () => this.go(-1));

		header.createDiv({
			cls: 'ct-cal-title',
			text: moment({ year: shown.year, month: shown.month - 1, day: 1 }).format('MMMM YYYY'),
		});

		const next = header.createEl('button', { cls: 'ct-cal-nav clickable-icon', attr: { 'aria-label': 'Next month' } });
		setIcon(next, 'chevron-right');
		next.addEventListener('click', () => this.go(1));

		const todayBtn = header.createEl('button', { cls: 'ct-cal-today', text: 'Today' });
		todayBtn.addEventListener('click', () => this.go('today'));

		// Grid
		const grid = el.createDiv({ cls: 'ct-cal-grid', attr: { role: 'grid' } });
		const weekdayNames = moment.weekdaysShort();
		for (const wd of weekdayOrder(data.weekStart)) {
			grid.createDiv({ cls: 'ct-cal-weekday', text: weekdayNames[wd] ?? '' });
		}

		const byDate = new Map(data.entries.map((e) => [e.date, e]));
		for (const date of monthGrid(shown.year, shown.month, data.weekStart)) {
			this.drawCell(grid, date, byDate.get(date), shown, data);
		}

		this.drawLegend(el, data.showFertileWindow, data.showPastEstimates);
	}

	private drawCell(grid: HTMLElement, date: IsoDate, entry: Entry | undefined, shown: YearMonth, data: CalendarData): void {
		const { today, marks: predicted } = data;
		const m = moment(date, 'YYYY-MM-DD');
		const labelParts = [m.format('dddd, D MMMM YYYY')];

		const cell = grid.createEl('button', { cls: 'ct-cal-day', attr: { role: 'gridcell', 'data-date': date } });
		if (!isInMonth(date, shown)) cell.addClass('ct-outside');
		if (date === today) {
			cell.addClass('ct-today');
			labelParts.push('today');
		}
		if (entry?.flow) {
			cell.addClass(`ct-flow-${entry.flow}`);
			labelParts.push(FLOW_LABEL[entry.flow] ?? entry.flow);
		}
		if (entry?.symptoms?.length) {
			cell.addClass('ct-has-symptoms');
			labelParts.push(entry.symptoms.join(', '));
		}
		if (predicted.predictedPeriod.has(date)) {
			cell.addClass('ct-predicted-period');
			labelParts.push('predicted period');
		}
		if (predicted.ovulation.has(date)) {
			cell.addClass('ct-ovulation');
			labelParts.push('predicted ovulation');
		}
		if (predicted.fertile.has(date)) {
			cell.addClass('ct-fertile');
			if (!predicted.ovulation.has(date)) labelParts.push('predicted fertile window');
		}
		if (predicted.pastOvulation.has(date)) {
			cell.addClass('ct-past-ovulation');
			labelParts.push('estimated ovulation');
		}
		if (predicted.pastFertile.has(date)) {
			cell.addClass('ct-past-fertile');
			if (!predicted.pastOvulation.has(date)) labelParts.push('estimated fertile window');
		}
		if (entry?.note) {
			cell.addClass('ct-has-note');
			labelParts.push(`note: ${entry.note}`);
		}

		cell.createSpan({ cls: 'ct-day-number', text: String(m.date()) });
		const marks = cell.createDiv({ cls: 'ct-day-marks' });
		if (entry?.flow === 'spotting') marks.createSpan({ cls: 'ct-mark ct-mark-spotting' });
		// Symptoms and notes share one dot: "something else was logged this day".
		if (entry?.symptoms?.length || entry?.note) marks.createSpan({ cls: 'ct-mark ct-mark-symptoms' });

		cell.setAttr('aria-label', labelParts.join(' · '));
		cell.addEventListener('click', () => this.opts.onDayClick(date));
	}

	private drawLegend(el: HTMLElement, showFertileWindow: boolean, showPastEstimates: boolean): void {
		const legend = el.createDiv({ cls: 'ct-legend' });
		const item = (swatchCls: string, text: string) => {
			const it = legend.createDiv({ cls: 'ct-legend-item' });
			it.createSpan({ cls: `ct-legend-swatch ${swatchCls}` });
			it.createSpan({ text });
		};
		item('ct-flow-heavy', 'Heavy');
		item('ct-flow-medium', 'Medium');
		item('ct-flow-light', 'Light');
		item('ct-flow-spotting', 'Spotting');
		item('ct-swatch-symptoms', 'Symptoms or note');
		item('ct-predicted-period', 'Predicted period');
		if (showFertileWindow) {
			item('ct-fertile', 'Fertile window');
			item('ct-ovulation', 'Ovulation');
		}
		if (showFertileWindow && showPastEstimates) {
			item('ct-past-fertile', 'Past fertile (est.)');
			item('ct-past-ovulation', 'Past ovulation (est.)');
		}
	}
}
