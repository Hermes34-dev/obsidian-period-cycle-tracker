import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import type CycleTrackerPlugin from './main';

export type WeekStart = 'monday' | 'sunday';

export interface CycleTrackerSettings {
	logFilePath: string;
	firstDayOfWeek: WeekStart;
	defaultCycleLength: number;
	defaultPeriodLength: number;
	lutealPhaseLength: number;
	maxGapDays: number;
	cyclesForAverages: number;
	outlierMinCycle: number;
	outlierMaxCycle: number;
	predictCycles: number;
	showFertileWindow: boolean;
	showPastEstimates: boolean;
	flowColor: string;
	symptoms: string[];
}

export const DEFAULT_SYMPTOMS: string[] = [
	'cramps',
	'bloating',
	'headache',
	'back pain',
	'breast tenderness',
	'fatigue',
	'acne',
	'mood swings',
	'irritability',
	'anxiety',
	'cravings',
	'nausea',
	'insomnia',
];

export const DEFAULT_SETTINGS: CycleTrackerSettings = {
	logFilePath: 'Cycle Tracker/Cycle log.md',
	firstDayOfWeek: 'monday',
	defaultCycleLength: 28,
	defaultPeriodLength: 5,
	lutealPhaseLength: 12,
	maxGapDays: 1,
	cyclesForAverages: 6,
	outlierMinCycle: 15,
	outlierMaxCycle: 90,
	predictCycles: 3,
	showFertileWindow: true,
	showPastEstimates: true,
	flowColor: 'hsl(350 60% 55%)',
	symptoms: [...DEFAULT_SYMPTOMS],
};

export const DISCLAIMER =
	'Cycle Tracker provides estimates only. It is not a medical device and must not be used for contraception.';

/** Parse a comma- or newline-separated list into unique, trimmed, lower-case keys. */
export function parseSymptomList(raw: string): string[] {
	const seen = new Set<string>();
	for (const part of raw.split(/[,\n]/)) {
		const key = part.trim().toLowerCase();
		if (key) seen.add(key);
	}
	return [...seen];
}

type NumericKey = {
	[K in keyof CycleTrackerSettings]: CycleTrackerSettings[K] extends number ? K : never;
}[keyof CycleTrackerSettings];

export class CycleSettingTab extends PluginSettingTab {
	plugin: CycleTrackerPlugin;

	constructor(app: App, plugin: CycleTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('p', { text: DISCLAIMER, cls: 'ct-disclaimer' });
		containerEl.createEl('p', {
			cls: 'ct-disclaimer',
			text:
				'Privacy: everything is stored in one Markdown file inside this vault. The plugin makes no network requests, ' +
				'but if your vault is synced (Obsidian Sync, iCloud, Dropbox, Git…) the log file is synced too. ' +
				'To keep it on this device only, exclude its folder in your sync settings.',
		});

		// --- Data ---
		new Setting(containerEl)
			.setName('Log file path')
			.setDesc('Markdown file (inside your vault) where all entries are stored. Created automatically if missing.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.logFilePath)
					.setValue(this.plugin.settings.logFilePath)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.logFilePath = trimmed
							? normalizePath(trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`)
							: DEFAULT_SETTINGS.logFilePath;
						await this.plugin.saveSettings();
					}),
			);

		// --- Calendar ---
		new Setting(containerEl).setName('Calendar').setHeading();

		new Setting(containerEl).setName('First day of week').addDropdown((dd) =>
			dd
				.addOption('monday', 'Monday')
				.addOption('sunday', 'Sunday')
				.setValue(this.plugin.settings.firstDayOfWeek)
				.onChange(async (value) => {
					this.plugin.settings.firstDayOfWeek = value as WeekStart;
					await this.plugin.saveSettings();
				}),
		);

		this.addNumber('Future cycles to project', 'How many upcoming cycles to draw on the calendar.', 'predictCycles', 0, 12);

		new Setting(containerEl)
			.setName('Show fertile window')
			.setDesc('Highlight the predicted fertile window and ovulation day.')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showFertileWindow).onChange(async (value) => {
					this.plugin.settings.showFertileWindow = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Show past estimates')
			.setDesc('Also mark the estimated fertile days and ovulation day of past cycles, drawn fainter. Only applies when the fertile window is shown.')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showPastEstimates).onChange(async (value) => {
					this.plugin.settings.showPastEstimates = value;
					await this.plugin.saveSettings();
				}),
			);

		const colorSetting = new Setting(containerEl)
			.setName('Flow colour')
			.setDesc('Any CSS colour value, for example #d9536a.');
		const swatch = colorSetting.controlEl.createDiv({ cls: 'ct-color-swatch' });
		swatch.style.setProperty('background', this.plugin.settings.flowColor);
		colorSetting.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SETTINGS.flowColor)
				.setValue(this.plugin.settings.flowColor)
				.onChange(async (value) => {
					const v = value.trim();
					const valid = v !== '' && CSS.supports('color', v);
					text.inputEl.toggleClass('ct-invalid', v !== '' && !valid);
					if (!valid && v !== '') return;
					this.plugin.settings.flowColor = valid ? v : DEFAULT_SETTINGS.flowColor;
					swatch.style.setProperty('background', this.plugin.settings.flowColor);
					await this.plugin.saveSettings();
				}),
		);

		// --- Predictions ---
		new Setting(containerEl).setName('Predictions').setHeading();

		this.addNumber('Default cycle length', 'Used until you have logged at least one full cycle (days).', 'defaultCycleLength', 15, 90);
		this.addNumber('Default period length', 'Used until you have logged a completed period (days).', 'defaultPeriodLength', 1, 15);
		this.addNumber(
			'Luteal phase length',
			'Days from ovulation to the next period. Ovulation is estimated backwards from the predicted period.',
			'lutealPhaseLength',
			7,
			20,
		);
		this.addNumber(
			'Max gap between flow days',
			'Days without flow allowed inside a single period before it counts as a new one.',
			'maxGapDays',
			0,
			5,
		);
		this.addNumber('Cycles used for averages', 'Statistics use the last N valid cycles.', 'cyclesForAverages', 1, 24);

		const outlier = new Setting(containerEl)
			.setName('Outlier cycle bounds')
			.setDesc('Cycles shorter than the minimum or longer than the maximum are excluded from averages (days).');
		outlier.addText((t) => this.bindNumber(t.inputEl, 'outlierMinCycle', 1, 60, 'Min'));
		outlier.addText((t) => this.bindNumber(t.inputEl, 'outlierMaxCycle', 20, 365, 'Max'));

		// --- Symptoms ---
		new Setting(containerEl).setName('Symptoms').setHeading();

		new Setting(containerEl)
			.setName('Symptom list')
			.setDesc(
				'Comma- or line-separated. Stored lower-case. Renaming a symptom does not rewrite past entries.',
			)
			.addTextArea((ta) => {
				ta.inputEl.rows = 6;
				ta.inputEl.addClass('ct-symptom-textarea');
				ta.setValue(this.plugin.settings.symptoms.join(', ')).onChange(async (value) => {
					this.plugin.settings.symptoms = parseSymptomList(value);
					await this.plugin.saveSettings();
				});
			})
			.addExtraButton((b) =>
				b
					.setIcon('rotate-ccw')
					.setTooltip('Restore default symptoms')
					.onClick(async () => {
						this.plugin.settings.symptoms = [...DEFAULT_SYMPTOMS];
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}

	private addNumber(name: string, desc: string, key: NumericKey, min: number, max: number): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) => this.bindNumber(t.inputEl, key, min, max));
	}

	private bindNumber(input: HTMLInputElement, key: NumericKey, min: number, max: number, placeholder?: string): void {
		input.type = 'number';
		input.min = String(min);
		input.max = String(max);
		input.addClass('ct-number-input');
		if (placeholder) input.placeholder = placeholder;
		input.value = String(this.plugin.settings[key]);
		input.addEventListener('change', () => {
			const n = Math.round(Number(input.value));
			const s = this.plugin.settings;
			const crossesBound =
				(key === 'outlierMinCycle' && n >= s.outlierMaxCycle) || (key === 'outlierMaxCycle' && n <= s.outlierMinCycle);
			if (!Number.isFinite(n) || n < min || n > max || crossesBound) {
				input.addClass('ct-invalid');
				return;
			}
			input.removeClass('ct-invalid');
			this.plugin.settings[key] = n;
			void this.plugin.saveSettings();
		});
	}
}
