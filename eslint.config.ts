import antfu from '@antfu/eslint-config';

export default antfu({
	stylistic: {
		indent: 'tab',
		semi: true,
		overrides: {
			'curly': ['error', 'all'],
			'style/brace-style': ['error', '1tbs'],
			'test/prefer-lowercase-title': ['error', { ignore: ['describe'] }],
			'ts/strict-boolean-expressions': 'off',
		},
	},

	javascript: {
		overrides: {
			'no-console': 'warn',
		},
	},

	typescript: {
		tsconfigPath: 'tsconfig.json',
	},
}, {
	// Tests run with Node's own runner (`npm test`), which awaits each test itself
	files: ['**/*.test.ts'],
	rules: {
		'test/no-import-node-test': 'off',
		'ts/no-floating-promises': 'off',
	},
});
