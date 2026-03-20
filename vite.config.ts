import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import vueDevTools from 'vite-plugin-vue-devtools';

export default defineConfig({
	plugins: [
		vue({
			template: {
				compilerOptions: {
					isCustomElement: tag => tag === 'iconify-icon', // Set the 'iconify-icon' tag as a web component
				},
			},
		}),
		mkcert(), // Use mkcert for enabling HTTPS in localhost
		vueDevTools(),
	],
});
