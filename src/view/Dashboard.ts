import { moment } from 'obsidian';
import { diffDays } from '../core/dates';
import type { Analysis, DateRange, IsoDate } from '../core/types';
import { DISCLAIMER } from '../settings';

export interface DashboardData {
	analysis: Analysis;
	today: IsoDate;
	showFertileWindow: boolean;
}

export interface DashboardOptions {
	onLogToday: () => void;
}

/** A line of text where some parts are emphasised: ['in ', { b: '12' }, ' days']. */
type Rich = (string | { b: string })[];

const fmtDay = (iso: IsoDate) => moment(iso, 'YYYY-MM-DD').format('D MMM');
const fmtRange = (r: DateRange) => `${fmtDay(r.start)} – ${fmtDay(r.end)}`;
const days = (n: number) => (n === 1 ? 'day' : 'days');

/** Stack of stat cards (spec §4.4). */
export class Dashboard {
	constructor(
		private readonly containerEl: HTMLElement,
		private readonly opts: DashboardOptions,
	) {}

	render(data: DashboardData): void {
		const el = this.containerEl;
		el.empty();
		el.addClass('ct-dashboard');

		const { analysis } = data;
		const { prediction: p } = analysis;

		if (p.confidence === 'none') {
			const empty = el.createDiv({ cls: 'ct-card ct-card-empty' });
			empty.createDiv({ cls: 'ct-card-main', text: 'Log your first period to get started.' });
			empty.createDiv({
				cls: 'ct-card-sub',
				text: 'Click a day on the calendar and choose a flow. Predictions appear after your first period.',
			});
			const btn = empty.createEl('button', { text: 'Log today', cls: 'mod-cta' });
			btn.addEventListener('click', () => this.opts.onLogToday());
			this.footer(el);
			return;
		}

		if (p.confidence === 'low') {
			el.createDiv({
				cls: 'ct-confidence',
				text:
					analysis.stats.cyclesUsed === 0
						? 'Low confidence · using your default cycle length until you log a second period.'
						: 'Low confidence · predictions improve after 3 logged cycles.',
			});
		}

		this.nextPeriodCard(el, data);
		if (data.showFertileWindow) this.fertileCard(el, data);
		this.cycleLengthCard(el, data);
		this.periodLengthCard(el, data);
		this.currentCycleCard(el, data);
		this.footer(el);
	}

	private nextPeriodCard(el: HTMLElement, { analysis, today }: DashboardData): void {
		const p = analysis.prediction;
		const next = p.nextPeriodStart;
		if (!next) return;
		const card = this.card(el, 'Next period', 'ct-card-period');

		if (p.periodDay !== null) {
			this.main(card, ['Day ', { b: String(p.periodDay) }, ' of period']);
			this.sub(card, `Next period ≈ ${fmtDay(next)} · ±${p.uncertainty} ${days(p.uncertainty)}`);
		} else if (p.daysLate !== null) {
			card.addClass('ct-card-late');
			this.main(card, [{ b: String(p.daysLate) }, ` ${days(p.daysLate)} late`]);
			this.sub(card, `Expected ≈ ${fmtDay(next)} · ±${p.uncertainty} ${days(p.uncertainty)}`);
		} else {
			const inDays = diffDays(today, next);
			this.main(card, inDays === 0 ? ['Expected ', { b: 'today' }] : ['in ', { b: String(inDays) }, ` ${days(inDays)}`]);
			this.sub(card, `≈ ${fmtDay(next)} · ±${p.uncertainty} ${days(p.uncertainty)}`);
		}
	}

	private fertileCard(el: HTMLElement, { analysis, today }: DashboardData): void {
		const { fertileWindow: w, ovulationDay: ov } = analysis.prediction;
		if (!w || !ov) return;
		const card = this.card(el, 'Fertile window', 'ct-card-fertile');

		if (ov === today) {
			this.main(card, [{ b: 'Predicted ovulation today' }]);
			this.sub(card, `Fertile window ${fmtRange(w)}`);
		} else if (diffDays(w.start, today) >= 0) {
			const toOv = diffDays(today, ov);
			this.main(card, [{ b: 'Fertile window now' }]);
			this.sub(card, `Ovulation ≈ in ${toOv} ${days(toOv)} (${fmtDay(ov)}) · window ${fmtRange(w)}`);
		} else {
			const inDays = diffDays(today, w.start);
			this.main(card, ['starts in ', { b: String(inDays) }, ` ${days(inDays)}`]);
			this.sub(card, `${fmtRange(w)} · ovulation ≈ ${fmtDay(ov)}`);
		}
	}

	private cycleLengthCard(el: HTMLElement, { analysis }: DashboardData): void {
		const { stats } = analysis;
		const card = this.card(el, 'Average cycle length');
		const n = Math.round(stats.avgCycleLength);
		this.main(card, [{ b: String(n) }, ` ${days(n)}`]);
		if (stats.cyclesUsed === 0) {
			this.sub(card, 'Default from settings · log a second period to measure it');
		} else {
			const based = `based on last ${stats.cyclesUsed} ${stats.cyclesUsed === 1 ? 'cycle' : 'cycles'}`;
			const r = stats.cycleRange;
			this.sub(card, r && r[0] !== r[1] ? `${based} · range ${r[0]}–${r[1]}` : based);
		}
		const outliers = analysis.cycles.filter((c) => c.outlier).length;
		if (outliers) this.sub(card, `${outliers} unusual ${outliers === 1 ? 'cycle' : 'cycles'} left out`);
	}

	private periodLengthCard(el: HTMLElement, { analysis }: DashboardData): void {
		const { stats } = analysis;
		const card = this.card(el, 'Average period length');
		const n = Math.round(stats.avgPeriodLength);
		this.main(card, [{ b: String(n) }, ` ${days(n)}`]);
		this.sub(
			card,
			stats.periodsUsed === 0
				? 'Default from settings · measured once your current period ends'
				: `based on last ${stats.periodsUsed} ${stats.periodsUsed === 1 ? 'period' : 'periods'}`,
		);
	}

	private currentCycleCard(el: HTMLElement, { analysis }: DashboardData): void {
		const p = analysis.prediction;
		if (p.cycleDay === null || !p.lastPeriodStart) return;
		const card = this.card(el, 'Current cycle');
		this.main(card, ['Cycle day ', { b: String(p.cycleDay) }]);
		this.sub(card, `started ${fmtDay(p.lastPeriodStart)}`);
	}

	private footer(el: HTMLElement): void {
		el.createDiv({ cls: 'ct-disclaimer', text: DISCLAIMER });
	}

	private card(el: HTMLElement, title: string, cls?: string): HTMLElement {
		const card = el.createDiv({ cls: cls ? `ct-card ${cls}` : 'ct-card' });
		card.createDiv({ cls: 'ct-card-title', text: title });
		return card;
	}

	private main(card: HTMLElement, parts: Rich): void {
		const line = card.createDiv({ cls: 'ct-card-main' });
		for (const part of parts) {
			if (typeof part === 'string') line.appendText(part);
			else line.createEl('strong', { text: part.b });
		}
	}

	private sub(card: HTMLElement, text: string): void {
		card.createDiv({ cls: 'ct-card-sub', text });
	}
}
