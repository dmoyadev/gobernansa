import { onMounted } from 'vue';

/**
 * Prevents pinch to zoom on mobile devices when using the web app in standalone mode (PWA).
 * This is a workaround for the fact that there is no way to disable pinch to zoom in Safari on iOS.
 */
export default function useWebAppZoom() {
	onMounted(() => {
		document.addEventListener('gesturestart', (e) => {
			e.preventDefault();
			// @ts-expect-error - This is a hack to prevent the pinch to zoom
			document.body.style.zoom = 0.99;
		});
		document.addEventListener('gesturechange', (e) => {
			e.preventDefault();
			// @ts-expect-error - This is a hack to prevent the pinch to zoom
			document.body.style.zoom = 0.99;
		});
		document.addEventListener('gestureend', (e) => {
			e.preventDefault();
			// @ts-expect-error - This is a hack to prevent the pinch to zoom
			document.body.style.zoom = 1;
		});
	});
}
