import { App, Modal, moment } from 'obsidian';
import { normalizeSymptoms } from '../core/entries';
import type { Entry, Flow, IsoDate } from '../core/types';
import type { LogStore } from '../data/LogStore';

const FLOW_OPTIONS: { value: Flow | null; label: string }[] = [
	{ value: null, label: 'None' },
	{ value: 'spotting', label: 'Spotting' },
	{ value: 'light', label: 'Light' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'heavy', label: 'Heavy' },
];

/** Log or edit a single day (spec §4.3). Saving goes through LogStore; the view re-renders via its change listener. */
export class DayModal extends Modal {
	private readonly existing: Entry | undefined;
	private flow: Flow | null;
	private readonly symptoms: Set<string>;
	private note: string;
	private saving = false;

	constructor(
		app: App,
		private readonly store: LogStore,
		private readonly date: IsoDate,
		private readonly symptomList: readonly string[],
		private readonly flowColor: string,
	) {
		super(app);
		this.existing = store.getEntry(date);
		this.flow = this.existing?.flow ?? null;
		this.symptoms = new Set(this.existing?.symptoms ?? []);
		this.note = this.existing?.note ?? '';
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('ct-day-modal');
		this.modalEl.style.setProperty('--ct-flow-color', this.flowColor);
		this.setTitle(moment(this.date, 'YYYY-MM-DD').format('dddd, D MMMM YYYY'));

		if (this.store.getReadError()) {
			contentEl.createEl('p', { cls: 'ct-error', text: this.store.getReadError() ?? '' });
		}

		// --- Flow: segmented, single select ---
		contentEl.createEl('h4', { text: 'Flow' });
		const seg = contentEl.createDiv({ cls: 'ct-segmented', attr: { role: 'radiogroup', 'aria-label': 'Flow' } });
		const segButtons: HTMLButtonElement[] = [];
		const syncSeg = () => {
			FLOW_OPTIONS.forEach((opt, i) => {
				const active = opt.value === this.flow;
				segButtons[i]?.toggleClass('is-active', active);
				segButtons[i]?.setAttr('aria-checked', String(active));
			});
		};
		for (const opt of FLOW_OPTIONS) {
			const btn = seg.createEl('button', {
				text: opt.label,
				cls: opt.value ? `ct-seg ct-seg-${opt.value}` : 'ct-seg ct-seg-none',
				attr: { role: 'radio', type: 'button' },
			});
			btn.addEventListener('click', () => {
				this.flow = opt.value;
				syncSeg();
			});
			segButtons.push(btn);
		}
		syncSeg();

		// --- Symptoms: checkbox chips. Configured list first, then any unknown keys already logged. ---
		contentEl.createEl('h4', { text: 'Symptoms' });
		const chips = contentEl.createDiv({ cls: 'ct-chips' });
		const configured = normalizeSymptoms(this.symptomList);
		const extra = [...this.symptoms].filter((s) => !configured.includes(s));
		for (const key of [...configured, ...extra]) {
			const label = chips.createEl('label', { cls: 'ct-chip' });
			if (extra.includes(key)) label.addClass('ct-chip-unknown');
			const cb = label.createEl('input', { type: 'checkbox' });
			cb.checked = this.symptoms.has(key);
			label.toggleClass('is-checked', cb.checked);
			label.createSpan({ text: key });
			cb.addEventListener('change', () => {
				if (cb.checked) this.symptoms.add(key);
				else this.symptoms.delete(key);
				label.toggleClass('is-checked', cb.checked);
			});
		}
		if (configured.length === 0 && extra.length === 0) {
			chips.createSpan({ cls: 'ct-placeholder', text: 'No symptoms configured (Settings → Cycle Tracker).' });
		}

		// --- Note ---
		contentEl.createEl('h4', { text: 'Note' });
		const noteEl = contentEl.createEl('textarea', {
			cls: 'ct-note',
			attr: { rows: '2', placeholder: 'Optional · Shift+Enter for a new line' },
		});
		noteEl.value = this.note;
		noteEl.addEventListener('input', () => (this.note = noteEl.value));

		// --- Buttons ---
		const buttons = contentEl.createDiv({ cls: 'ct-modal-buttons' });
		const clearBtn = buttons.createEl('button', { text: 'Clear day', cls: 'mod-warning', attr: { type: 'button' } });
		clearBtn.disabled = !this.existing;
		clearBtn.addEventListener('click', () => void this.clear());
		buttons.createDiv({ cls: 'ct-spacer' });
		const cancelBtn = buttons.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = buttons.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'button' } });
		saveBtn.addEventListener('click', () => void this.save());

		// Enter saves from anywhere in the modal (including after clicking a flow button or chip,
		// which keeps focus). Exceptions: Shift+Enter adds a newline in the note, and Enter on
		// Cancel / Clear day activates that button. Esc cancels (Modal default).
		this.modalEl.addEventListener('keydown', (evt) => {
			if (evt.key !== 'Enter' || evt.shiftKey || evt.altKey || evt.isComposing) return;
			if (evt.target === cancelBtn || evt.target === clearBtn) return;
			evt.preventDefault();
			evt.stopPropagation();
			void this.save();
		});

		saveBtn.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async save(): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		// Keep v2 fields (bbt, lh, ovulation) that this modal does not edit yet.
		const entry: Entry = {
			...this.existing,
			date: this.date,
			flow: this.flow ?? undefined,
			symptoms: [...this.symptoms],
			note: this.note,
		};
		const ok = await this.store.upsert(entry);
		this.saving = false;
		if (ok) this.close();
	}

	private async clear(): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		const ok = await this.store.remove(this.date);
		this.saving = false;
		if (ok) this.close();
	}
}
