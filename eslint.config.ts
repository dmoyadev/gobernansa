import antfu from '@antfu/eslint-config';

export default antfu({
	stylistic: {
		indent: 'tab',
		semi: true,
		overrides: {
			'curly': ['error', 'all'],
			'style/brace-style': ['error', '1tbs'],
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
	// The functions run on the Node of their package.json's engines, not on the local one: nothing newer than that
	files: ['apps/functions/**/*.js'],
	rules: {
		'node/no-unsupported-features/es-builtins': 'error',
		'node/no-unsupported-features/es-syntax': 'error',
		'node/no-unsupported-features/node-builtins': 'error',
	},
});
