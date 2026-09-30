// Nightshade Studio server: serves the web app and proxies YouTube audio via yt-dlp.
// Zero npm dependencies. Run: node server.js  (PORT env var optional)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const MAX_DURATION_SEC = Number(process.env.YT_MAX_DURATION) || 15 * 60;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const AUDIO_MIME = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function isYouTubeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com';
  } catch {
    return false;
  }
}

function handleYouTube(req, res, query) {
  const url = query.get('url') || '';
  if (!isYouTubeUrl(url)) return sendJson(res, 400, { error: 'Please paste a valid youtube.com or youtu.be link.' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightshade-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }, () => {});
  const args = [
    '--no-playlist',
    '--no-progress',
    '--match-filter', `duration <= ${MAX_DURATION_SEC}`,
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '-o', path.join(dir, 'audio.%(ext)s'),
    '--print', 'before_dl:%(title)s',
    '--print', 'after_move:filepath',
    '--no-simulate',
    '--', url,
  ];

  let child;
  try {
    child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    cleanup();
    return sendJson(res, 501, { error: `Could not start yt-dlp: ${err.message}` });
  }

  let out = '';
  let errOut = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (errOut += d));
  child.on('error', (err) => {
    cleanup();
    if (res.headersSent) return;
    if (err.code === 'ENOENT') {
      return sendJson(res, 501, { error: 'yt-dlp is not installed on the server. Run "npm run setup:youtube" (or install yt-dlp) and restart.' });
    }
    sendJson(res, 500, { error: err.message });
  });
  child.on('close', (code) => {
    if (res.headersSent) return cleanup();
    const lines = out.trim().split('\n').filter(Boolean);
    const filePath = lines[lines.length - 1];
    const title = lines.length > 1 ? lines[0] : 'YouTube audio';
    if (code !== 0 || !filePath || !filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      cleanup();
      const msg = errOut.split('\n').filter((l) => l.includes('ERROR')).pop() || 'yt-dlp failed to download this video.';
      return sendJson(res, 502, { error: msg.replace(/^ERROR:\s*/, '') || 'Video is too long or unavailable.' });
    }
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': AUDIO_MIME[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Title': encodeURIComponent(title),
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('close', cleanup);
  });
  req.on('close', () => {
    if (!res.writableEnded && child.exitCode === null) child.kill('SIGKILL');
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/youtube' && req.method === 'GET') return handleYouTube(req, res, searchParams);
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Nightshade Studio running at http://localhost:${PORT}`);
});
