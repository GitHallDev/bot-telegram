const test = require('node:test');
const assert = require('node:assert/strict');
const { parseYtDlpFormats } = require('./app.js');

test('parseYtDlpFormats parses yt-dlp rows into usable video formats', () => {
  const raw = [
    'format_id|ext|height|filesize|filesize_approx|format_note',
    '18|mp4|360||4200000|360p',
    '22|mp4|720||7100000|720p',
    '313|webm|1080|||2160p',
    'audio only|m4a|||1024000|audio',
  ].join('\n');

  const formats = parseYtDlpFormats(raw);
  assert.equal(formats.length, 3);
  assert.equal(formats[0].id, '313');
  assert.equal(formats[0].height, 1080);
  assert.equal(formats[0].label, '1080p WEBM');
  assert.equal(formats[2].id, '18');
  assert.equal(formats[2].height, 360);
});
