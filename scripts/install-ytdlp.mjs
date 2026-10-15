import fs from 'node:fs';
import path from 'node:path';
import YTDlpWrapModule from 'yt-dlp-wrap';
const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;

const binaryPath = path.resolve(process.env.YTDLP_BINARY_PATH || './bin/yt-dlp');
if (fs.existsSync(binaryPath)) {
  fs.chmodSync(binaryPath, 0o755);
  console.log(`yt-dlp already present: ${binaryPath}`);
} else {
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  await YTDlpWrap.downloadFile(downloadUrl, binaryPath);
  fs.chmodSync(binaryPath, 0o755);
  console.log(`yt-dlp downloaded: ${binaryPath}`);
}
