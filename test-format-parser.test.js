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

test('parseYtDlpFormats parses yt-dlp all-formats output', () => {
  const raw = [
    '3979|mp4|1920x1080|23.974|NA|NA|3979.875|m3u8_native|avc1.640028|mp4a.40.2',
    '451|mp4|852x480|23.974|NA|NA|451.805|m3u8_native|avc1.4d401f|mp4a.40.2',
  ].join('\n');

  const formats = parseYtDlpFormats(raw);
  assert.equal(formats.length, 2);
  assert.equal(formats[0].id, '3979');
  assert.equal(formats[0].height, 1080);
  assert.equal(formats[1].id, '451');
  assert.equal(formats[1].height, 480);
});

test('parseYtDlpFormats parses yt-dlp --list-formats table output', () => {
  const raw = [
    '[info] Available formats for master.m3u8:',
    'ID   EXT RESOLUTION FPS |   FILESIZE   TBR PROTO | VCODEC      ACODEC',
    '------------------------------------------------------------------------',
    '451  mp4 852x480     24 | ~ 77.40MiB  452k m3u8  | avc1.4d401f mp4a.40.2',
    '3979 mp4 1920x1080   24 | ~681.77MiB 3980k m3u8  | avc1.640028 mp4a.40.2',
    '251  webm 0x0        0  | ~ 4.20MiB  120k webm  | none        opus',
  ].join('\n');

  const formats = parseYtDlpFormats(raw);
  assert.equal(formats.length, 3);
  assert.equal(formats[0].id, '3979');
  assert.equal(formats[0].height, 1080);
  assert.equal(formats[1].id, '451');
  assert.equal(formats[1].height, 480);
  assert.equal(formats[2].id, '251');
  assert.equal(formats[2].height, null);
});
