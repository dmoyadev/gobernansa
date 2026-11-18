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
}, {
	// One app never imports another: what both need goes in packages/shared
	files: ['apps/**', 'packages/**'],
	rules: {
		'no-restricted-imports': ['warn', {
			patterns: [{ regex: '(^|/)(webapp|admin)/src/', message: 'Una app no importa de otra: lo común va en packages/shared.' }],
		}],
	},
}, {
	// Reads and writes go in application/ (docs/desarrollo.md, Convenciones)
	files: ['apps/*/src/modules/*/ui/**'],
	rules: {
		'ts/no-restricted-imports': ['error', {
			paths: [{
				name: 'firebase/firestore',
				importNames: ['getFirestore', 'collection', 'collectionGroup', 'doc', 'query', 'getDoc', 'getDocs', 'getCountFromServer', 'onSnapshot', 'addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'],
				allowTypeImports: true,
				message: 'Las lecturas y escrituras de Firestore van en application/, no en ui/.',
			}, {
				name: 'vuefire',
				importNames: ['useFirestore', 'useCollection', 'useDocument'],
				message: 'Las lecturas y escrituras de Firestore van en application/, no en ui/.',
			}],
		}],
	},
});
