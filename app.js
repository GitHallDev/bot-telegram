const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function ensureDirectory(dirPath) {
  if (!dirPath || dirPath === '.') return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function downloadVideo(embedUrl, outputPath, quality = 'best', format = 'mp4') {
  const targetDir = path.dirname(outputPath);
  ensureDirectory(targetDir);

  return new Promise((resolve, reject) => {
    const safeOutput = outputPath.replace(/"/g, '\\"');
    const safeUrl = embedUrl.replace(/"/g, '\\"');
    const ytDlpPath = '/opt/render/project/src/yt-dlp';

    // Construction dynamique de l'option de format / qualité pour yt-dlp
    let formatArg = '';
    if (quality === '360') {
      formatArg = `-f "bestvideo[height<=360][ext=${format}]+bestaudio/best[height<=360] / best[height<=360]"`;
    }
    else if (quality === '720') {
      formatArg = `-f "bestvideo[height<=720][ext=${format}]+bestaudio/best[height<=720] / best[height<=720]"`;
    } else if (quality === '1080') {
      formatArg = `-f "bestvideo[height<=1080][ext=${format}]+bestaudio/best[height<=1080] / best[height<=1080]"`;
    } else {
      // Qualité maximale demandée
      formatArg = `-f "bv*[ext=${format}]+ba/b[ext=${format}] / b"`;
    }

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

module.exports = { downloadVideo };