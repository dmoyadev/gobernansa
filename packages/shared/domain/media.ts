// The uploader names each file with its type's extension, which stays readable in the URL: '.' is never encoded
const VIDEO_EXTENSION_REGEX = /\.(?:mp4|mov|webm)$/i;
const QUERY_REGEX = /[?#]/;

// Whether a photo or video of an issue is a video, from its URL
export function isVideoUrl(url: string) {
	return VIDEO_EXTENSION_REGEX.test(url.split(QUERY_REGEX, 1)[0]);
}
