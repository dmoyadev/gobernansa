import { newWorkOrderToken } from '@gobernansa/shared/domain/workOrder.ts';
import { emulators, storage } from '@gobernansa/shared/infrastructure/firebase.ts';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

// Photos and videos go to Firebase Storage. Hidden without a bucket: the project needs the paid plan for one
export const canUploadMedia = !!storage.app.options.storageBucket;
// As storage.rules allow: videos up to 100 MB and in these formats, photos are made smaller before uploading
export const MAX_VIDEO_SIZE = 100_000_000;
export const VIDEO_TYPE_REGEX = /^video\/(?:mp4|quicktime|webm)$/;

const MAX_IMAGE_SIDE = 1920;
const EXTENSION_REGEX = /\.\w+$/;
const ACCENT_REGEX = /\p{M}/gu;
const UNSAFE_REGEX = /[^\w-]+/g;
// The extension each type is saved with, the rest is the type's subtype
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'video/quicktime': 'mov' };

// Smaller photos upload faster on mobile data and take less space, and look the same on a phone
async function shrinkImage(file: File): Promise<Blob> {
	try {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);
		canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
		return blob && blob.size < file.size ? blob : file;
	} catch {
		// e.g. HEIC photos on browsers that can't read them, uploaded as they are
		return file;
	}
}

/**
 * Uploads a photo or a video and returns its download URL, which opens it without an account, as providers do
 *
 * @param {File} file - The photo or video picked by the user
 * @param {string} folder - Where to keep it, one storage.rules allows: issues/{communityId}/{authorKey} or workOrders/{token}
 * @param {(fraction: number) => void} onProgress - Called with how much has been uploaded, from 0 to 1
 *
 * @returns {Promise<string>} The URL, with its type's extension so the app tells videos apart (isVideoUrl). Without its
 * host with the emulators: the page's own server forwards /v0/b to them, wherever it's opened from (firebase.ts emulatorAt)
 */
export async function uploadMedia(file: File, folder: string, onProgress?: (fraction: number) => void): Promise<string> {
	const body = file.type.startsWith('video/') ? file : await shrinkImage(file);
	const extension = EXTENSIONS[body.type] ?? body.type.split('/')[1] ?? 'bin';
	const name = file.name.replace(EXTENSION_REGEX, '').normalize('NFD').replace(ACCENT_REGEX, '').replace(UNSAFE_REGEX, '-').slice(0, 60);
	// Random, so nobody finds another's files by their name. Not crypto.randomUUID: the local demo is served over http
	const task = uploadBytesResumable(ref(storage, `${folder}/${newWorkOrderToken()}-${name}.${extension}`), body, { contentType: body.type });
	task.on('state_changed', snapshot => snapshot.totalBytes && onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes));
	await task;

	const url = await getDownloadURL(task.snapshot.ref);
	return emulators ? url.slice(new URL(url).origin.length) : url;
}
