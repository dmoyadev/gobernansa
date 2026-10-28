/* eslint-disable perfectionist/sort-imports */
import type { Component } from 'vue';
import { createApp } from 'vue';

/* App core dependencies */
import App from './app/App.vue';
import router from './app/router.ts';

/* Firebase */
import { VueFire, VueFireAuth } from 'vuefire';
import { firebaseApp } from '@gobernansa/shared/infrastructure/firebase.ts';

/* Icons */
import 'iconify-icon';

/* CSS Utils */
import '@gobernansa/shared/theme/skeleton.scss';
import '@gobernansa/shared/theme/colors.scss';
import '@gobernansa/shared/theme/typography.scss';
import './theme/view-transitions.scss';

/* Components Library */
import 'lnxjs-components/dist/base.css';
import '@gobernansa/shared/theme/custom-theme.scss';

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
