const test = require('node:test');
const assert = require('node:assert/strict');
const { parseYtDlpFormats } = require('./app.js');

test('parseYtDlpFormats parses yt-dlp rows into usable video formats', () => {
  const raw = [
    '18|mp4|640x360|30|4200000|600|https|h264|aac',
    '22|mp4|1280x720|30|7100000|1200|https|h264|aac',
    '313|webm|1920x1080|30||10240000|https|vp9|opus',
    'audio only|m4a|0x0|0||1024000|0|https|none|aac',
  ].join('\n');

  const formats = parseYtDlpFormats(raw);
  assert.equal(formats.length, 3);
  assert.equal(formats[0].id, '313');
  assert.equal(formats[0].height, 1080);
  assert.equal(formats[0].label, '1080p WEBM');
  assert.equal(formats[2].id, '18');
  assert.equal(formats[2].height, 360);
});
