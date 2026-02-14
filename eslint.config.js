'use strict';

const js = require('@eslint/js');
const nodePlugin = require('eslint-plugin-n');

module.exports = [
	js.configs.recommended,
	nodePlugin.configs['flat/recommended'],
	{
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: 'commonjs',
		},
		rules: {
			'strict': ['error', 'global'],
			'n/no-unsupported-features/es-syntax': ['error'],
			'n/no-unsupported-features/es-builtins': ['error'],
			'no-irregular-whitespace': 2,
			'quotes': [2, 'single'],
			'no-unused-vars': [
				'error',
				{ 'vars': 'all', 'args': 'none', 'ignoreRestSiblings': false }
			],
			'eqeqeq': ['error'],
			'no-throw-literal': ['error'],
			'semi': ['error', 'always'],
		}
	},
	{
		ignores: ['docs/**', 'test.js']
	}
];
