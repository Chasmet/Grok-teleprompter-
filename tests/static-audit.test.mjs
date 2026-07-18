import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const android = fs.readFileSync(new URL('../app/src/main/java/com/chasmet/grokteleprompter/MainActivity.java', import.meta.url), 'utf8');

test('every interface id is unique', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('camera and microphone are requested separately', () => {
  assert.match(script, /getUserMedia\(\{ video: attempts\[index\], audio: false \}\)/);
  assert.match(script, /getUserMedia\(\{ audio: constraints, video: false \}\)/);
  assert.doesNotMatch(script, /getUserMedia\(\{\s*video: videoConstraints\(\),\s*audio: audioConstraints\(\)/);
});

test('Android declares camera and microphone permissions', () => {
  assert.match(manifest, /android\.permission\.CAMERA/);
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
});

test('Android provides a native 48 kHz microphone when WebView capture fails', () => {
  assert.match(android, /new AudioRecord\.Builder\(\)/);
  assert.match(android, /startNativeMicrophone\(\)/);
  assert.match(android, /NATIVE_MIC_SAMPLE_RATE = 48000/);
  assert.match(android, /MediaRecorder\.AudioSource\.VOICE_RECOGNITION/);
  assert.match(script, /window\.GrokNativeAudio/);
  assert.match(script, /startNativeMicrophoneFallback/);
});

test('the tactile and short-text safeguards stay wired', () => {
  for (const id of ['faceResizeHandle', 'teleResizeHandle', 'retryCameraBtn', 'cameraSettingsBtn']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /textHeight > availableHeight/);
  assert.match(script, /if \(!state\.teleShouldScroll\)/);
  assert.match(script, /grokTeleprompterLayout/);
});

test('recording falls back without a microphone and both audio sources have tactile gains', () => {
  for (const id of ['includeMicrophone', 'includeMediaAudio', 'micVolumeRange', 'mediaVolumeRange', 'microphoneHelp']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /microphoneUnavailable/);
  assert.doesNotMatch(script, /Enregistrement annulé : aucun micro actif/);
  assert.match(script, /createRecorder\(outputStream, outputStream\.getAudioTracks\(\)\.length > 0/);
  assert.match(script, /profile\.gain \* microphoneVolume\(\)/);
  assert.match(script, /mediaGain\.gain\.value = mediaVolume\(\)/);
  assert.match(script, /state\.mode === 'live'.*includeMediaAudio\.checked/);
});
