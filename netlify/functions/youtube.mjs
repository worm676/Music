// YouTube import relies on the yt-dlp binary, which isn't available on Netlify.
// Return a clear JSON error so the UI can explain it instead of showing a bare 404.
export default async () =>
  Response.json(
    { error: 'YouTube import isn’t available on the hosted site. Download the audio and drag the MP3 in, or run the app locally with "npm start".' },
    { status: 501 },
  );

export const config = { path: '/api/youtube' };
