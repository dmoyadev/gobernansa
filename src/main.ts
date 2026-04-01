/* eslint-disable perfectionist/sort-imports */
import type { Component } from 'vue';
import { createApp } from 'vue';

/* App core dependencies */
import App from './App.vue';
import router from './router';

/* Firebase */
import { VueFire, VueFireAuth } from 'vuefire';
import { firebaseApp } from './utils/firebase.ts';

/* Icons */
import 'iconify-icon';

/* CSS Utils */
import './theme/skeleton.scss';
import './theme/colors.scss';
import './theme/typography.scss';

/* Components Library */
import 'lnxjs-components/dist/base.css';
import './theme/custom-theme.scss';

const app = createApp(App as Component);
app.use(router);

app.use(VueFire, {
	firebaseApp,
	modules: [
		VueFireAuth(),
	],
});

/* Create the router and mount the app */
router.isReady()
	.then(async () => {
		app.mount('#app');
	})
	.catch((error) => {
	// eslint-disable-next-line no-console
		console.error(error);
	});
