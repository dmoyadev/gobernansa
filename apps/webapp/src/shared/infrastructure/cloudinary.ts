// Photos and videos go to Cloudinary: Cloud Storage needs Firebase's paid plan
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
// An unsigned upload preset, so the app can upload without a backend to sign the requests
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

export const canUploadMedia = !!CLOUD_NAME && !!UPLOAD_PRESET;
// Cloudinary's free plan limit for videos, photos are made smaller before uploading
export const MAX_VIDEO_SIZE = 100_000_000;

const MAX_IMAGE_SIDE = 1920;
const EXTENSION_REGEX = /\.\w+$/;

// Smaller photos upload faster on mobile data and use less of the free plan, and look the same on a phone
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
		// e.g. HEIC photos on browsers that can't read them, Cloudinary takes them as they are
		return file;
	}
}

/**
 * Uploads a photo or a video and returns its URL
 *
 * @param {File} file - The photo or video picked by the user
 * @param {string} folder - Where to keep it in Cloudinary
 * @param {(fraction: number) => void} onProgress - Called with how much has been uploaded, from 0 to 1
 *
 * @returns {Promise<string>} The URL, always .mp4 for videos so every browser plays them and the app tells them apart
 */
export async function uploadMedia(file: File, folder: string, onProgress?: (fraction: number) => void): Promise<string> {
	if (!canUploadMedia) {
		throw new Error('Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to upload media');
	}

	const isVideo = file.type.startsWith('video/');
	const body = new FormData();
	body.append('file', isVideo ? file : await shrinkImage(file));
	body.append('upload_preset', UPLOAD_PRESET!);
	body.append('folder', folder);

	// fetch can't tell how much of a request has been sent, videos take a while
	interface UploadResponse { secure_url: string; resource_type: string; format: string }
	const response = await new Promise<UploadResponse>((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`);
		request.responseType = 'json';
		request.upload.addEventListener('progress', event => event.lengthComputable && onProgress?.(event.loaded / event.total));
		request.addEventListener('load', () => request.status < 300
			? resolve(request.response as UploadResponse)
			: reject(new Error(`Cloudinary upload failed (${request.status}): ${JSON.stringify(request.response)}`)));
		request.addEventListener('error', () => reject(new Error('Cloudinary upload failed: network error')));
		request.send(body);
	});

	if (response.resource_type === 'video') {
		return response.secure_url.replace(EXTENSION_REGEX, '.mp4');
	}
	// Photos browsers can't show (HEIC) are delivered as JPEG
	return ['heic', 'heif'].includes(response.format) ? response.secure_url.replace(EXTENSION_REGEX, '.jpg') : response.secure_url;
}
