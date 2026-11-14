import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// src/core is pure logic, unit-tested in plain Node: no Obsidian API allowed.
		files: ['src/core/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{ paths: [{ name: 'obsidian', message: 'src/core must not import obsidian (see spec).' }] },
			],
		},
	},
	{
		// Tests run in Node and are never shipped, so Node built-ins are fine there.
		files: ['tests/**/*.ts'],
		rules: { 'obsidianmd/no-nodejs-modules': 'off' },
	},
);
