const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function ensureDirectory(dirPath) {
  if (!dirPath || dirPath === '.') return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function downloadVideo(embedUrl, outputPath) {
  const targetDir = path.dirname(outputPath);
  ensureDirectory(targetDir);

  return new Promise((resolve, reject) => {
    const safeOutput = outputPath.replace(/"/g, '\\"');
    const safeUrl = embedUrl.replace(/"/g, '\\"');
    const command = `yt-dlp -o "${safeOutput}" "${safeUrl}"`;

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