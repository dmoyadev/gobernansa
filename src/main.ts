import type { Component } from 'vue';
import { createApp } from 'vue';
import App from './App.vue';

/* Firebase */
import { firebaseApp } from './utils/firebase.ts';
import { VueFire, VueFireAuth } from 'vuefire'

/* Icons */
import 'iconify-icon';

/* CSS Utils */
import './theme/skeleton.scss';
import './theme/colors.scss';
import './theme/typography.scss';

/* Components Library */
import 'lnxjs-components/dist/base.css';
import './theme/custom-theme.scss'

/* App core dependencies */
import router from './router';

const app = createApp(App as Component);
app.use(router);

app.use(VueFire, {
	firebaseApp,
	modules: [
		VueFireAuth(),
	],
})

/* Create the router and mount the app */
router.isReady()
.then(async () => {
	app.mount('#app');
})
.catch((error) => {
	// eslint-disable-next-line no-console
	console.error(error);
});
