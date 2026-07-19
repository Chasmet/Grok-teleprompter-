import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const android = fs.readFileSync(new URL('../app/src/main/java/com/chasmet/grokteleprompter/MainActivity.java', import.meta.url), 'utf8');
const nativeWorklet = fs.readFileSync(new URL('../native-audio-worklet.js', import.meta.url), 'utf8');
const androidBuild = fs.readFileSync(new URL('../app/build.gradle', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

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

test('Android provides a clean native 48 kHz microphone when WebView capture fails', () => {
  assert.match(android, /new AudioRecord\.Builder\(\)/);
  assert.match(android, /startNativeMicrophone\(String profileName\)/);
  assert.match(android, /NATIVE_MIC_SAMPLE_RATE = 48000/);
  assert.match(android, /NATIVE_MIC_CHUNK_BYTES = 3840/);
  assert.match(android, /while \(filled < pcm\.length/);
  assert.match(android, /Base64\.encodeToString\(pcm, Base64\.NO_WRAP\)/);
  assert.match(android, /MediaRecorder\.AudioSource\.UNPROCESSED[\s\S]*MediaRecorder\.AudioSource\.VOICE_RECOGNITION[\s\S]*MediaRecorder\.AudioSource\.MIC[\s\S]*MediaRecorder\.AudioSource\.CAMCORDER/);
  assert.match(android, /MediaRecorder\.AudioSource\.CAMCORDER/);
  assert.doesNotMatch(android, /NoiseSuppressor/);
  assert.match(android, /calculatePcmRms\(pcm, filled\)/);
  assert.match(android, /dispatchNativeAudio\(String encoded, double rms\)/);
  assert.match(script, /window\.GrokNativeAudio/);
  assert.match(script, /push\(base64Pcm, sampleRate = 48000, nativeRms = 0\)/);
  assert.match(script, /startNativeMicrophoneFallback/);
  assert.match(script, /new AudioWorkletNode\(context, 'grok-native-pcm'/);
  assert.match(nativeWorklet, /prebufferFrames/);
  assert.match(nativeWorklet, /fadeInFrames/);
  assert.match(nativeWorklet, /fadeOutFrames/);
  assert.match(nativeWorklet, /packetFrames/);
  assert.match(nativeWorklet, /suppressPacketClicks/);
  assert.match(androidBuild, /native-audio-worklet\.js/);
  assert.match(serviceWorker, /native-audio-worklet\.js/);
});

test('the native PCM worklet keeps adjacent Android chunks continuous', () => {
  let Processor;
  const sandbox = {
    sampleRate: 48000,
    Float32Array,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { onmessage: null };
      }
    },
    registerProcessor(name, constructor) {
      assert.equal(name, 'grok-native-pcm');
      Processor = constructor;
    }
  };
  vm.runInNewContext(nativeWorklet, sandbox);
  const processor = new Processor();
  const frequency = 440;
  for (let chunkIndex = 0; chunkIndex < 3; chunkIndex += 1) {
    const samples = new Float32Array(1920);
    for (let index = 0; index < samples.length; index += 1) {
      const absoluteIndex = chunkIndex * samples.length + index;
      samples[index] = Math.sin(2 * Math.PI * frequency * absoluteIndex / 48000) * .5;
    }
    processor.port.onmessage({ data: { type: 'pcm', samples } });
  }

  const rendered = new Float32Array(5760);
  for (let offset = 0; offset < rendered.length; offset += 128) {
    const block = new Float32Array(128);
    assert.equal(processor.process([], [[block]]), true);
    rendered.set(block, offset);
  }

  for (const boundary of [1920, 3840]) {
    const expected = Math.sin(2 * Math.PI * frequency * boundary / 48000) * .5;
    assert.ok(Math.abs(rendered[boundary] - expected) < 1e-6);
    assert.ok(Math.abs(rendered[boundary] - rendered[boundary - 1]) < .04);
  }
  let maxSignalError = 0;
  for (let index = 128; index < rendered.length; index += 1) {
    const expected = Math.sin(2 * Math.PI * frequency * index / 48000) * .5;
    maxSignalError = Math.max(maxSignalError, Math.abs(rendered[index] - expected));
  }
  assert.ok(maxSignalError < 1e-6);
});

test('the native PCM worklet smooths abnormal jumps at 10 ms packet boundaries', () => {
  let Processor;
  const sandbox = {
    sampleRate: 48000,
    Float32Array,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { onmessage: null };
      }
    },
    registerProcessor(_name, constructor) {
      Processor = constructor;
    }
  };
  vm.runInNewContext(nativeWorklet, sandbox);
  const processor = new Processor();
  const samples = new Float32Array(5760);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.floor(index / 480) % 2 === 0 ? .6 : -.6;
  }
  processor.port.onmessage({ data: { type: 'pcm', samples } });

  const rendered = new Float32Array(5760);
  for (let offset = 0; offset < rendered.length; offset += 128) {
    const block = new Float32Array(128);
    assert.equal(processor.process([], [[block]]), true);
    rendered.set(block, offset);
  }
  for (let boundary = 480; boundary < rendered.length; boundary += 480) {
    assert.ok(Math.abs(rendered[boundary] - rendered[boundary - 1]) < .05);
  }
});

test('the tactile and short-text safeguards stay wired', () => {
  for (const id of ['faceResizeHandle', 'teleResizeHandle', 'retryCameraBtn', 'cameraSettingsBtn', 'faceFormatVertical', 'faceFormatHorizontal']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /textHeight > availableHeight/);
  assert.match(script, /if \(!state\.teleShouldScroll\)/);
  assert.match(script, /grokTeleprompterLayout/);
});

test('imported media stays automatic and only the facecam gets a selectable aspect', () => {
  assert.match(script, /const ratio = state\.mediaWidth \/ state\.mediaHeight/);
  assert.match(script, /const sourceWidth = state\.mode === 'live' \? 1080 : state\.mediaWidth/);
  assert.match(script, /const wantedRatio = selectedFaceOrientation\(\) === 'horizontal' \? 16 \/ 9 : 9 \/ 16/);
  assert.match(script, /grokTeleprompterFaceOrientation/);
  assert.doesNotMatch(android, /setCaptureOrientation/);
  assert.match(html, /Orientation de la webcam/);
  assert.match(html, /⬇ Télécharger la vidéo/);
});

test('the sound meter cannot add a second audio path while recording', () => {
  assert.match(script, /state\.nativeMicrophone\?\.active && stream === state\.micOnlyStream/);
  assert.match(script, /native\.lastMeterAt >= 100/);
  assert.match(script, /setInterval\(\(\) => drawFrame\(context, canvas\), 1000 \/ 30\)/);
  assert.doesNotMatch(script, /meterLoop\(audioGraph\.analyser\)/);
  assert.doesNotMatch(script, /connect\(gain\)\.connect\(analyser\)/);
});

test('the Android microphone is recorded directly without a second AudioContext', () => {
  assert.match(script, /micStream === native\.destination\?\.stream/);
  assert.match(script, /nativeDirect: true/);
  assert.match(script, /stream: micStream,[\s\S]*context: null/);
  assert.match(script, /destination\.channelCount = 1/);
  assert.match(script, /mediaSource\.connect\(mediaGain\)\.connect\(native\.limiter\)/);
  assert.match(script, /micro natif direct 48 kHz/);
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
