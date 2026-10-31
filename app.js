const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function ensureDirectory(dirPath) {
  if (!dirPath || dirPath === '.') return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return 'Inconnue';
  const mb = value / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} Go`;
  return `${mb.toFixed(1)} Mo`;
}

function formatSizeLabel(filesize, filesizeApprox) {
  const value = Number(filesize) || Number(filesizeApprox) || 0;
  if (!value) return 'taille inconnue';
  return formatBytes(value);
}

function parseYtDlpFormats(rawOutput) {
  const text = String(rawOutput || '').trim();
  if (!text) return [];

  const seen = new Set();
  const formats = [];

  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim();
    if (!cleaned || cleaned.startsWith('formats:') || cleaned.startsWith('WARNING') || cleaned.includes('error') || cleaned.includes('ERROR')) {
      continue;
    }

    const parts = cleaned.split('|');
    if (parts.length < 2) continue;

    const [idRaw, extRaw = '', resolutionRaw = '', fpsRaw = '', filesizeRaw = '', filesizeApproxRaw = '', bitrateRaw = '', protocolRaw = '', videoCodecRaw = '', audioCodecRaw = ''] = parts;
    const id = String(idRaw || '').trim();
    const ext = String(extRaw || '').trim().toLowerCase();
    if (!id || !ext) continue;

    const normalizedId = id.toLowerCase();
    if (normalizedId.includes('audio only') || normalizedId.includes('audio')) continue;

    const resolution = String(resolutionRaw || '').trim();
    const parsedHeight = Number.parseInt((resolution.match(/(\d+)x(\d+)/)?.[2] || resolution.match(/(\d+)/)?.[1] || '') || '', 10);
    const height = Number.isFinite(parsedHeight) ? parsedHeight : null;
    const filesize = Number.parseInt(filesizeRaw, 10) || null;
    const filesizeApprox = Number.parseInt(filesizeApproxRaw, 10) || null;
    const label = height ? `${height}p ${ext.toUpperCase()}` : `${ext.toUpperCase()} ${String(fpsRaw || '').trim() || 'video'}`.trim();

    const sizeLabel = formatSizeLabel(filesize, filesizeApprox);

    const item = {
      id,
      ext,
      height,
      resolution,
      fps: fpsRaw || null,
      bitrate: bitrateRaw || null,
      protocol: protocolRaw || null,
      videoCodec: videoCodecRaw || null,
      audioCodec: audioCodecRaw || null,
      filesize,
      filesizeApprox,
      sizeLabel,
      label,
    };

    const key = `${item.id}|${item.ext}|${item.height ?? 'na'}|${item.resolution}`;
    if (!seen.has(key)) {
      seen.add(key);
      formats.push(item);
    }
  }

  return formats.sort((a, b) => {
    const byHeight = (b.height ?? 0) - (a.height ?? 0);
    if (byHeight !== 0) return byHeight;
    return String(a.id).localeCompare(String(b.id));
  });
}

function buildYtDlpFormatArg({ quality = 'best', format = 'mp4', formatId = null } = {}) {
  if (formatId) return `-f "${formatId}"`;

  if (quality === '360') {
    return `-f "bestvideo[height<=360][ext=${format}]+bestaudio/best[height<=360] / best[height<=360]"`;
  }

  if (quality === '720') {
    return `-f "bestvideo[height<=720][ext=${format}]+bestaudio/best[height<=720] / best[height<=720]"`;
  }

  if (quality === '1080') {
    return `-f "bestvideo[height<=1080][ext=${format}]+bestaudio/best[height<=1080] / best[height<=1080]"`;
  }

  return `-f "bv*[ext=${format}]+ba/b[ext=${format}] / b"`;
}

function downloadVideo(embedUrl, outputPath, quality = 'best', format = 'mp4', formatId = null) {
  const targetDir = path.dirname(outputPath);
  ensureDirectory(targetDir);

  return new Promise((resolve, reject) => {
    const safeOutput = outputPath.replace(/"/g, '\\"');
    const safeUrl = embedUrl.replace(/"/g, '\\"');
    const ytDlpPath = path.join(__dirname, 'yt-dlp');
    const formatArg = buildYtDlpFormatArg({ quality, format, formatId });
    const command = `"${ytDlpPath}" ${formatArg} -o "${safeOutput}" "${safeUrl}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        const message = stderr || stdout || error.message;
        console.error(`Erreur de téléchargement : ${message}`);
        return reject(new Error(message));
      }
      resolve(outputPath);
    });
  });
}

module.exports = { downloadVideo, parseYtDlpFormats, formatBytes };