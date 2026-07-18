(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const elements = {
    stage: $('stage'), viewer: $('viewer'), empty: $('empty'), mediaVideo: $('mediaVideo'),
    mediaImage: $('mediaImage'), cameraVideo: $('cameraVideo'), mediaInput: $('mediaInput'),
    download: $('download'), status: $('status'), timer: $('timer'), teleprompter: $('teleprompter'),
    teleText: $('teleText'), scriptInput: $('scriptInput'), speedRange: $('speedRange'),
    sizeRange: $('sizeRange'), liveTab: $('liveTab'), mediaTab: $('mediaTab'), faceTab: $('faceTab'),
    recBtn: $('recBtn'), stopBtn: $('stopBtn'), cameraBtn: $('cameraBtn'), flipBtn: $('flipBtn'),
    mirrorBtn: $('mirrorBtn'), playBtn: $('playBtn'), pauseBtn: $('pauseBtn'), audioMode: $('audioMode'),
    videoQuality: $('videoQuality'), includeMediaAudio: $('includeMediaAudio'), audioMeter: $('audioMeter'),
    audioPeak: $('audioPeak'), audioLabel: $('audioLabel'), recordQuality: $('recordQuality')
  };

  const state = {
    mode: 'facecam', mediaType: '', mediaWidth: 720, mediaHeight: 1280, mediaUrl: '',
    cameraStream: null, micOnlyStream: null, recorder: null, chunks: [], recordingBlob: null,
    recordingName: '', timerId: 0, startedAt: 0, renderId: 0, wakeLock: null,
    audioGraph: null, audioMeterId: 0, facingMode: 'user', mirrored: true,
    face: { x: .05, y: .05, w: .28, h: .16 },
    mediaView: { scale: 1, x: 0, y: 0 }, viewPointers: new Map(), pinchStart: null,
    panStart: null, lastTap: 0, faceDrag: false, faceDx: 0, faceDy: 0,
    teleRaf: 0, teleStartedAt: 0, teleRunning: false, downloadUrl: ''
  };

  const AUDIO_PROFILES = {
    studio: { label: 'Voix studio', echoCancellation: true, noiseSuppression: true, autoGainControl: true, channels: 1, highpass: 75, presence: 2.8, threshold: -24, ratio: 3.2, gain: 1.08 },
    natural: { label: 'Voix naturelle', echoCancellation: true, noiseSuppression: true, autoGainControl: false, channels: 1, highpass: 55, presence: 1.2, threshold: -20, ratio: 2.2, gain: 1.02 },
    music: { label: 'Musique / chant', echoCancellation: false, noiseSuppression: false, autoGainControl: false, channels: 2, highpass: 30, presence: .5, threshold: -14, ratio: 1.6, gain: 1 }
  };

  function showStatus(message, isError = false, timeout = 2800) {
    elements.status.textContent = message;
    elements.status.style.color = isError ? '#f87171' : '#34d399';
    elements.status.style.display = 'block';
    clearTimeout(elements.status._timer);
    elements.status._timer = setTimeout(() => { elements.status.style.display = 'none'; }, timeout);
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const selectedProfile = () => AUDIO_PROFILES[elements.audioMode.value] || AUDIO_PROFILES.studio;

  function audioConstraints() {
    const profile = selectedProfile();
    return {
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 24 },
      channelCount: { ideal: profile.channels },
      echoCancellation: { ideal: profile.echoCancellation },
      noiseSuppression: { ideal: profile.noiseSuppression },
      autoGainControl: { ideal: profile.autoGainControl },
      latency: { ideal: .01 }
    };
  }

  function videoConstraints() {
    const high = elements.videoQuality.value === '1080';
    return {
      facingMode: { ideal: state.facingMode },
      width: { ideal: high ? 1920 : 1280 },
      height: { ideal: high ? 1080 : 720 },
      frameRate: { ideal: 30, max: 30 }
    };
  }

  function updateAudioLabel() {
    const profile = selectedProfile();
    const track = state.cameraStream?.getAudioTracks()[0] || state.micOnlyStream?.getAudioTracks()[0];
    if (!track) {
      elements.audioLabel.textContent = `${profile.label} · micro non activé`;
      return;
    }
    const settings = track.getSettings ? track.getSettings() : {};
    const rate = settings.sampleRate ? `${Math.round(settings.sampleRate / 1000)} kHz` : 'haute qualité';
    const channels = settings.channelCount === 2 ? 'stéréo' : 'mono';
    elements.audioLabel.textContent = `${profile.label} · ${rate} · ${channels}`;
  }

  function updateMirror() {
    const enabled = state.facingMode === 'user' && state.mirrored;
    elements.cameraVideo.classList.toggle('mirrored', enabled);
    elements.mirrorBtn.textContent = `Miroir : ${state.mirrored ? 'ON' : 'OFF'}`;
  }

  function updateTabs() {
    elements.liveTab.classList.toggle('active', state.mode === 'live');
    elements.mediaTab.classList.toggle('active', state.mode === 'media');
    elements.faceTab.classList.toggle('active', state.mode === 'facecam');
    document.body.dataset.mode = state.mode;
    const cameraVisible = (state.mode === 'live' || state.mode === 'facecam') && state.cameraStream;
    elements.cameraVideo.classList.toggle('hide', !cameraVisible);
    elements.cameraVideo.classList.toggle('face', state.mode === 'facecam');
    elements.cameraVideo.classList.toggle('liveCamera', state.mode === 'live');
    updateTeleVisibility();
    layoutFace();
    updateMirror();
  }

  function setMode(mode) {
    if (state.recorder && state.recorder.state !== 'inactive') return;
    state.mode = mode;
    state.viewPointers.clear();
    stopTeleprompter(true);
    if (mode === 'live') {
      elements.empty.classList.add('hide');
      elements.mediaVideo.classList.add('hide');
      elements.mediaImage.classList.add('hide');
      setAspect(9, 16);
    } else {
      displayImportedMedia();
    }
    updateTabs();
    updateTeleText(true);
  }

  function setAspect(width, height) {
    state.mediaWidth = Math.max(1, Number(width) || 720);
    state.mediaHeight = Math.max(1, Number(height) || 1280);
    resizeStage();
  }

  function resizeStage() {
    const ratio = state.mediaWidth / state.mediaHeight;
    const maxWidth = Math.max(120, elements.viewer.clientWidth - 20);
    const maxHeight = Math.max(120, elements.viewer.clientHeight - 20);
    let width = maxWidth;
    let height = width / ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    elements.stage.style.width = `${Math.max(120, width)}px`;
    elements.stage.style.height = `${Math.max(120, height)}px`;
    layoutFace();
    clampMediaView();
  }

  function layoutFace() {
    const face = state.face;
    elements.cameraVideo.style.left = `${face.x * 100}%`;
    elements.cameraVideo.style.top = `${face.y * 100}%`;
    elements.cameraVideo.style.width = `${face.w * 100}%`;
    elements.cameraVideo.style.height = `${face.h * 100}%`;
  }

  function moveFace(position) {
    const margin = .03;
    if (position === 'tl') { state.face.x = margin; state.face.y = margin; }
    if (position === 'tr') { state.face.x = 1 - state.face.w - margin; state.face.y = margin; }
    if (position === 'br') { state.face.x = 1 - state.face.w - margin; state.face.y = 1 - state.face.h - margin; }
    layoutFace();
  }

  function resizeFace(delta) {
    state.face.w = clamp(state.face.w + delta, .14, .58);
    state.face.h = clamp(state.face.h + delta * .7, .10, .46);
    state.face.x = clamp(state.face.x, 0, 1 - state.face.w);
    state.face.y = clamp(state.face.y, 0, 1 - state.face.h);
    layoutFace();
  }

  function applyMediaView() {
    const transform = `translate(${state.mediaView.x}px,${state.mediaView.y}px) scale(${state.mediaView.scale})`;
    for (const media of [elements.mediaVideo, elements.mediaImage]) {
      media.style.transform = transform;
      media.style.transformOrigin = 'center center';
    }
  }

  function clampMediaView() {
    const rect = elements.stage.getBoundingClientRect();
    state.mediaView.scale = clamp(state.mediaView.scale, 1, 5);
    if (state.mediaView.scale <= 1.01) {
      state.mediaView = { scale: 1, x: 0, y: 0 };
    } else {
      const maxX = rect.width * (state.mediaView.scale - 1) / 2;
      const maxY = rect.height * (state.mediaView.scale - 1) / 2;
      state.mediaView.x = clamp(state.mediaView.x, -maxX, maxX);
      state.mediaView.y = clamp(state.mediaView.y, -maxY, maxY);
    }
    applyMediaView();
  }

  function resetMediaView() {
    state.mediaView = { scale: 1, x: 0, y: 0 };
    applyMediaView();
  }

  function pointerDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function pointerCenter(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function displayImportedMedia() {
    const hasMedia = Boolean(state.mediaType);
    elements.empty.classList.toggle('hide', hasMedia);
    elements.mediaImage.classList.toggle('hide', state.mediaType !== 'image');
    elements.mediaVideo.classList.toggle('hide', state.mediaType !== 'video');
  }

  function teleHasText() { return Boolean(elements.scriptInput.value.trim()); }
  function updateTeleVisibility() {
    const visible = teleHasText() && (state.mode === 'live' || state.mode === 'facecam');
    elements.teleprompter.classList.toggle('hide', !visible);
  }
  function updateTeleText(reset = false) {
    elements.teleText.textContent = elements.scriptInput.value.trim() || 'Écris ton texte ici.';
    elements.teleText.style.fontSize = `${clamp(Number(elements.sizeRange.value) || 36, 20, 78)}px`;
    if (reset) elements.teleText.style.transform = 'translateY(0)';
    updateTeleVisibility();
  }
  function stopTeleprompter(reset = false) {
    state.teleRunning = false;
    if (state.teleRaf) cancelAnimationFrame(state.teleRaf);
    state.teleRaf = 0;
    if (reset) elements.teleText.style.transform = 'translateY(0)';
  }
  function startTeleprompter() {
    updateTeleText(true);
    if (!teleHasText() || state.mode === 'media') return;
    state.teleRunning = true;
    state.teleStartedAt = performance.now();
    const loop = (now) => {
      if (!state.teleRunning) return;
      const speed = 10 + clamp(Number(elements.speedRange.value) || 3, 1, 10) * 9;
      const elapsed = (now - state.teleStartedAt) / 1000;
      const maxMove = Math.max(0, elements.teleText.scrollHeight + elements.teleprompter.clientHeight * .58);
      elements.teleText.style.transform = `translateY(${-Math.min(maxMove, elapsed * speed)}px)`;
      state.teleRaf = requestAnimationFrame(loop);
    };
    state.teleRaf = requestAnimationFrame(loop);
  }

  async function stopCameraTracks() {
    [state.cameraStream, state.micOnlyStream].forEach((stream) => stream?.getTracks().forEach((track) => track.stop()));
    state.cameraStream = null;
    state.micOnlyStream = null;
    elements.cameraVideo.srcObject = null;
    stopLiveMeter();
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showStatus('Caméra non compatible avec cet appareil', true, 4500);
      return;
    }
    elements.cameraBtn.disabled = true;
    await stopCameraTracks();
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(), audio: audioConstraints() });
    } catch (firstError) {
      try {
        state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.facingMode }, audio: true });
        showStatus('Mode compatible activé : certains traitements dépendent du téléphone');
      } catch (error) {
        const denied = error.name === 'NotAllowedError' || error.name === 'SecurityError';
        showStatus(denied ? 'Autorise la caméra et le micro dans les réglages' : `Caméra indisponible : ${error.name || 'erreur'}`, true, 5000);
        elements.cameraBtn.disabled = false;
        return;
      }
    }
    const audioTrack = state.cameraStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.contentHint = elements.audioMode.value === 'music' ? 'music' : 'speech';
    const videoTrack = state.cameraStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.contentHint = 'motion';
    elements.cameraVideo.srcObject = state.cameraStream;
    await elements.cameraVideo.play().catch(() => {});
    elements.cameraBtn.disabled = false;
    elements.cameraBtn.textContent = 'Caméra activée';
    updateTabs();
    updateAudioLabel();
    startLiveMeter(state.cameraStream);
    showStatus('Caméra et micro prêts');
  }

  async function ensureMicrophone() {
    if (state.cameraStream?.getAudioTracks().length) return state.cameraStream;
    if (state.micOnlyStream?.getAudioTracks().length) return state.micOnlyStream;
    try {
      state.micOnlyStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: false });
      const track = state.micOnlyStream.getAudioTracks()[0];
      if (track) track.contentHint = elements.audioMode.value === 'music' ? 'music' : 'speech';
      updateAudioLabel();
      return state.micOnlyStream;
    } catch (error) {
      showStatus('Autorise le micro pour enregistrer ta voix', true, 4500);
      return null;
    }
  }

  function createContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { return new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' }); }
    catch (_) { return new AudioContextClass(); }
  }

  function connectVoicePipeline(context, inputStream, master) {
    const profile = selectedProfile();
    const source = context.createMediaStreamSource(inputStream);
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = profile.highpass;
    highpass.Q.value = .7;
    const presence = context.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3000;
    presence.Q.value = .8;
    presence.gain.value = profile.presence;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = profile.threshold;
    compressor.knee.value = 18;
    compressor.ratio.value = profile.ratio;
    compressor.attack.value = .005;
    compressor.release.value = .18;
    const gain = context.createGain();
    gain.gain.value = profile.gain;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .78;
    source.connect(highpass).connect(presence).connect(compressor).connect(gain).connect(analyser).connect(master);
    return analyser;
  }

  function captureMediaAudio() {
    if (state.mediaType !== 'video' || !elements.includeMediaAudio.checked) return null;
    const capture = elements.mediaVideo.captureStream || elements.mediaVideo.mozCaptureStream;
    if (!capture) return null;
    try {
      const stream = capture.call(elements.mediaVideo);
      return stream.getAudioTracks().length ? stream : null;
    } catch (_) { return null; }
  }

  async function buildAudioGraph() {
    const micStream = await ensureMicrophone();
    const mediaAudio = captureMediaAudio();
    if (!micStream && !mediaAudio) return null;
    const context = createContext();
    if (!context) {
      const fallback = new MediaStream();
      (micStream || mediaAudio).getAudioTracks().forEach((track) => fallback.addTrack(track));
      return { stream: fallback, context: null, analyser: null };
    }
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = .002;
    limiter.release.value = .08;
    limiter.connect(destination);
    let analyser = null;
    if (micStream) analyser = connectVoicePipeline(context, micStream, limiter);
    if (mediaAudio) {
      const mediaSource = context.createMediaStreamSource(mediaAudio);
      const mediaGain = context.createGain();
      mediaGain.gain.value = .82;
      mediaSource.connect(mediaGain).connect(limiter);
    }
    return { stream: destination.stream, context, analyser };
  }

  function meterLoop(analyser) {
    cancelAnimationFrame(state.audioMeterId);
    if (!analyser) return;
    const values = new Uint8Array(analyser.fftSize);
    const update = () => {
      analyser.getByteTimeDomainData(values);
      let sum = 0;
      for (const value of values) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / values.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      elements.audioMeter.value = clamp((db + 55) / 50, 0, 1);
      elements.audioPeak.textContent = `${Math.round(Math.max(-60, db))} dB`;
      state.audioMeterId = requestAnimationFrame(update);
    };
    update();
  }

  function stopLiveMeter() {
    cancelAnimationFrame(state.audioMeterId);
    state.audioMeterId = 0;
    if (state.audioGraph?.context) state.audioGraph.context.close().catch(() => {});
    state.audioGraph = null;
    elements.audioMeter.value = 0;
    elements.audioPeak.textContent = '— dB';
  }

  function startLiveMeter(stream) {
    stopLiveMeter();
    const context = createContext();
    if (!context || !stream?.getAudioTracks().length) return;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .78;
    context.createMediaStreamSource(stream).connect(analyser);
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    analyser.connect(silentOutput).connect(context.destination);
    context.resume().catch(() => {});
    state.audioGraph = { context, analyser, silentOutput, meterOnly: true };
    meterLoop(analyser);
  }

  function drawContained(context, source, x, y, width, height) {
    const sourceWidth = source.videoWidth || source.naturalWidth || width;
    const sourceHeight = source.videoHeight || source.naturalHeight || height;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function drawCovered(context, source, x, y, width, height, mirror = false) {
    const sourceWidth = source.videoWidth || source.naturalWidth || width;
    const sourceHeight = source.videoHeight || source.naturalHeight || height;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const cropWidth = width / scale;
    const cropHeight = height / scale;
    context.save();
    if (mirror) {
      context.translate(x + width, y);
      context.scale(-1, 1);
      context.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, width, height);
    } else {
      context.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, x, y, width, height);
    }
    context.restore();
  }

  function drawImported(context, canvas) {
    const source = state.mediaType === 'image' ? elements.mediaImage : elements.mediaVideo;
    if (!source || (state.mediaType === 'video' && source.readyState < 2)) return;
    const stageRect = elements.stage.getBoundingClientRect();
    const tx = stageRect.width ? state.mediaView.x / stageRect.width * canvas.width : 0;
    const ty = stageRect.height ? state.mediaView.y / stageRect.height * canvas.height : 0;
    context.save();
    context.translate(canvas.width / 2 + tx, canvas.height / 2 + ty);
    context.scale(state.mediaView.scale, state.mediaView.scale);
    context.translate(-canvas.width / 2, -canvas.height / 2);
    drawContained(context, source, 0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function drawFrame(context, canvas) {
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const mirrorCamera = state.facingMode === 'user' && state.mirrored;
    if (state.mode === 'live' && elements.cameraVideo.readyState >= 2) {
      drawCovered(context, elements.cameraVideo, 0, 0, canvas.width, canvas.height, mirrorCamera);
      return;
    }
    drawImported(context, canvas);
    if (state.mode === 'facecam' && elements.cameraVideo.readyState >= 2) {
      const x = Math.round(state.face.x * canvas.width);
      const y = Math.round(state.face.y * canvas.height);
      const width = Math.round(state.face.w * canvas.width);
      const height = Math.round(state.face.h * canvas.height);
      drawCovered(context, elements.cameraVideo, x, y, width, height, mirrorCamera);
      context.lineWidth = Math.max(4, canvas.width * .006);
      context.strokeStyle = '#fff';
      context.strokeRect(x, y, width, height);
    }
  }

  function outputSize() {
    const sourceWidth = state.mode === 'live' ? 1080 : state.mediaWidth;
    const sourceHeight = state.mode === 'live' ? 1920 : state.mediaHeight;
    const maxEdge = elements.videoQuality.value === '1080' ? 1920 : 1280;
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const makeEven = (value) => Math.max(2, Math.round(value * scale / 2) * 2);
    return { width: makeEven(sourceWidth), height: makeEven(sourceHeight) };
  }

  function pickMimeType() {
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function createRecorder(stream, mimeType, width, height) {
    const pixels = width * height;
    const options = {
      audioBitsPerSecond: 256000,
      videoBitsPerSecond: pixels >= 1800000 ? 12000000 : 6500000
    };
    if (mimeType) options.mimeType = mimeType;
    try { return new MediaRecorder(stream, options); }
    catch (_) {
      try { return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); }
      catch (error) { throw new Error(`Format vidéo non compatible (${error.name || 'erreur'})`); }
    }
  }

  async function requestWakeLock() {
    try { if (navigator.wakeLock) state.wakeLock = await navigator.wakeLock.request('screen'); }
    catch (_) {}
  }

  async function releaseWakeLock() {
    try { await state.wakeLock?.release(); }
    catch (_) {}
    state.wakeLock = null;
  }

  function setRecordingUi(recording) {
    document.body.classList.toggle('recording', recording);
    elements.recBtn.disabled = recording;
    elements.stopBtn.disabled = !recording;
    [elements.liveTab, elements.mediaTab, elements.faceTab, elements.mediaInput, elements.cameraBtn, elements.flipBtn, elements.audioMode, elements.videoQuality].forEach((item) => { item.disabled = recording; });
  }

  function updateTimer() {
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    elements.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  async function startRecording() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      showStatus('Enregistrement non compatible avec ce navigateur', true, 5000);
      return;
    }
    if (state.mode === 'live' && !state.cameraStream) { showStatus('Active d’abord la caméra', true); return; }
    if (state.mode !== 'live' && !state.mediaType) { showStatus('Importe d’abord une vidéo ou une image', true); return; }
    if (state.mode === 'facecam' && !state.cameraStream) { showStatus('Active d’abord la caméra', true); return; }

    state.chunks = [];
    state.recordingBlob = null;
    elements.download.style.display = 'none';
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = '';

    if (state.mediaType === 'video' && state.mode !== 'live') await elements.mediaVideo.play().catch(() => {});
    stopLiveMeter();
    const audioGraph = await buildAudioGraph();
    if (!audioGraph?.stream?.getAudioTracks().length) {
      showStatus('Aucune piste audio disponible', true, 4500);
      if (state.cameraStream) startLiveMeter(state.cameraStream);
      return;
    }
    state.audioGraph = audioGraph;
    meterLoop(audioGraph.analyser);

    const size = outputSize();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const render = () => {
      drawFrame(context, canvas);
      state.renderId = requestAnimationFrame(render);
    };
    render();
    const outputStream = canvas.captureStream(30);
    audioGraph.stream.getAudioTracks().forEach((track) => outputStream.addTrack(track));

    try {
      const mimeType = pickMimeType();
      state.recorder = createRecorder(outputStream, mimeType, size.width, size.height);
      state.recorder.ondataavailable = (event) => { if (event.data?.size) state.chunks.push(event.data); };
      state.recorder.onerror = (event) => showStatus(`Erreur d’enregistrement : ${event.error?.name || 'inconnue'}`, true, 5000);
      state.recorder.onstop = finishRecording;
      state.recorder.start(1000);
    } catch (error) {
      cleanupAfterRecording();
      showStatus(error.message, true, 5000);
      return;
    }

    state.startedAt = Date.now();
    state.timerId = window.setInterval(updateTimer, 400);
    setRecordingUi(true);
    startTeleprompter();
    requestWakeLock();
    const profile = selectedProfile();
    elements.recordQuality.textContent = `${Math.min(size.width, size.height)}p · audio ${profile.label} 256 kb/s`;
    showStatus('Enregistrement lancé · audio haute qualité');
  }

  function stopRecording() {
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.recorder.requestData();
      state.recorder.stop();
    }
  }

  async function cleanupAfterRecording() {
    if (state.renderId) cancelAnimationFrame(state.renderId);
    state.renderId = 0;
    clearInterval(state.timerId);
    state.timerId = 0;
    elements.timer.textContent = '00:00';
    stopTeleprompter(true);
    if (state.mediaType === 'video') elements.mediaVideo.pause();
    cancelAnimationFrame(state.audioMeterId);
    state.audioMeterId = 0;
    if (state.audioGraph?.context) await state.audioGraph.context.close().catch(() => {});
    state.audioGraph = null;
    releaseWakeLock();
    setRecordingUi(false);
    updateAudioLabel();
    const meterStream = state.cameraStream || state.micOnlyStream;
    if (meterStream) startLiveMeter(meterStream);
  }

  async function finishRecording() {
    const mimeType = state.recorder?.mimeType || state.chunks[0]?.type || 'video/webm';
    state.recordingBlob = new Blob(state.chunks, { type: mimeType });
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    state.recordingName = `Grok_Teleprompteur_${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    state.downloadUrl = URL.createObjectURL(state.recordingBlob);
    elements.download.style.display = 'block';
    elements.download.textContent = 'Enregistrer la vidéo sur le téléphone';
    elements.recordQuality.textContent = `${(state.recordingBlob.size / 1048576).toFixed(1)} Mo · prête à enregistrer`;
    await cleanupAfterRecording();
    showStatus('Vidéo prête · appuie sur le bouton vert');
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
    }
    return btoa(binary);
  }

  async function saveWithAndroidBridge(blob, name) {
    const bridge = window.AndroidBridge;
    const session = bridge.beginSave(name, blob.type || 'video/webm');
    if (!session) throw new Error('Impossible de préparer le fichier Android');
    const chunkSize = 512 * 1024;
    try {
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const data = await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer();
        if (!bridge.writeChunk(session, bufferToBase64(data))) throw new Error('Écriture interrompue');
        const percent = Math.min(100, Math.round((offset + data.byteLength) / blob.size * 100));
        elements.download.textContent = `Enregistrement… ${percent} %`;
        await delay(0);
      }
      if (!bridge.finishSave(session)) throw new Error('Finalisation impossible');
    } catch (error) {
      try { bridge.cancelSave(session); } catch (_) {}
      throw error;
    }
  }

  async function saveRecording() {
    if (!state.recordingBlob) return;
    elements.download.disabled = true;
    try {
      if (window.AndroidBridge?.beginSave) {
        await saveWithAndroidBridge(state.recordingBlob, state.recordingName);
        showStatus('Vidéo enregistrée dans Films/Grok Téléprompteur', false, 4500);
      } else {
        const anchor = document.createElement('a');
        anchor.href = state.downloadUrl;
        anchor.download = state.recordingName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        showStatus('Téléchargement lancé');
      }
    } catch (error) {
      showStatus(`Échec de l’enregistrement : ${error.message}`, true, 5000);
    } finally {
      elements.download.disabled = false;
      elements.download.textContent = 'Enregistrer la vidéo sur le téléphone';
    }
  }

  function saveScript() {
    try {
      localStorage.setItem('grokTeleprompterScript', elements.scriptInput.value);
      localStorage.setItem('grokTeleprompterAudio', elements.audioMode.value);
      localStorage.setItem('grokTeleprompterQuality', elements.videoQuality.value);
    } catch (_) {}
  }

  function restorePreferences() {
    try {
      const script = localStorage.getItem('grokTeleprompterScript');
      const audio = localStorage.getItem('grokTeleprompterAudio');
      const quality = localStorage.getItem('grokTeleprompterQuality');
      if (script !== null) elements.scriptInput.value = script;
      if (audio && AUDIO_PROFILES[audio]) elements.audioMode.value = audio;
      if (quality === '720' || quality === '1080') elements.videoQuality.value = quality;
    } catch (_) {}
  }

  elements.liveTab.addEventListener('click', () => setMode('live'));
  elements.mediaTab.addEventListener('click', () => setMode('media'));
  elements.faceTab.addEventListener('click', () => setMode('facecam'));
  elements.cameraBtn.addEventListener('click', startCamera);
  elements.recBtn.addEventListener('click', startRecording);
  elements.stopBtn.addEventListener('click', stopRecording);
  elements.download.addEventListener('click', saveRecording);
  elements.playBtn.addEventListener('click', () => { if (state.mediaType === 'video') elements.mediaVideo.play().catch(() => {}); });
  elements.pauseBtn.addEventListener('click', () => { if (state.mediaType === 'video') elements.mediaVideo.pause(); });
  $('tlBtn').addEventListener('click', () => moveFace('tl'));
  $('trBtn').addEventListener('click', () => moveFace('tr'));
  $('brBtn').addEventListener('click', () => moveFace('br'));
  $('minusBtn').addEventListener('click', () => resizeFace(-.05));
  $('plusBtn').addEventListener('click', () => resizeFace(.05));

  elements.flipBtn.addEventListener('click', async () => {
    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    await startCamera();
  });
  elements.mirrorBtn.addEventListener('click', () => { state.mirrored = !state.mirrored; updateMirror(); });
  elements.audioMode.addEventListener('change', async () => {
    saveScript();
    updateAudioLabel();
    if (state.cameraStream) await startCamera();
  });
  elements.videoQuality.addEventListener('change', saveScript);
  elements.scriptInput.addEventListener('input', () => {
    updateTeleText(false);
    clearTimeout(elements.scriptInput._saveTimer);
    elements.scriptInput._saveTimer = setTimeout(saveScript, 350);
  });
  elements.sizeRange.addEventListener('input', () => updateTeleText(false));

  elements.mediaInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      showStatus('Choisis une image ou une vidéo', true);
      return;
    }
    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = URL.createObjectURL(file);
    elements.download.style.display = 'none';
    resetMediaView();
    if (file.type.startsWith('image/')) {
      state.mediaType = 'image';
      elements.mediaImage.onload = () => {
        setAspect(elements.mediaImage.naturalWidth, elements.mediaImage.naturalHeight);
        displayImportedMedia();
        showStatus('Image prête');
      };
      elements.mediaImage.src = state.mediaUrl;
    } else {
      state.mediaType = 'video';
      elements.mediaVideo.onloadedmetadata = () => {
        setAspect(elements.mediaVideo.videoWidth, elements.mediaVideo.videoHeight);
        displayImportedMedia();
        showStatus('Vidéo prête');
      };
      elements.mediaVideo.src = state.mediaUrl;
      elements.mediaVideo.muted = true;
      elements.mediaVideo.load();
    }
    displayImportedMedia();
  });

  elements.cameraVideo.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'facecam') return;
    const rect = elements.stage.getBoundingClientRect();
    state.faceDrag = true;
    state.faceDx = (event.clientX - rect.left) / rect.width - state.face.x;
    state.faceDy = (event.clientY - rect.top) / rect.height - state.face.y;
    elements.cameraVideo.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  elements.cameraVideo.addEventListener('pointermove', (event) => {
    if (!state.faceDrag) return;
    const rect = elements.stage.getBoundingClientRect();
    state.face.x = clamp((event.clientX - rect.left) / rect.width - state.faceDx, 0, 1 - state.face.w);
    state.face.y = clamp((event.clientY - rect.top) / rect.height - state.faceDy, 0, 1 - state.face.h);
    layoutFace();
    event.preventDefault();
  });
  ['pointerup', 'pointercancel'].forEach((name) => elements.cameraVideo.addEventListener(name, () => { state.faceDrag = false; }));

  elements.stage.addEventListener('pointerdown', (event) => {
    if (event.target === elements.cameraVideo || state.mode === 'live' || !state.mediaType) return;
    const now = Date.now();
    if (now - state.lastTap < 280 && state.viewPointers.size === 0) {
      resetMediaView();
      showStatus('Zoom remis à zéro');
    }
    state.lastTap = now;
    state.viewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { elements.stage.setPointerCapture(event.pointerId); } catch (_) {}
    if (state.viewPointers.size === 1 && state.mediaView.scale > 1) {
      state.panStart = { x: event.clientX, y: event.clientY, viewX: state.mediaView.x, viewY: state.mediaView.y };
    }
    if (state.viewPointers.size === 2) {
      const points = [...state.viewPointers.values()];
      const center = pointerCenter(points[0], points[1]);
      state.pinchStart = { distance: pointerDistance(points[0], points[1]), scale: state.mediaView.scale, x: state.mediaView.x, y: state.mediaView.y, centerX: center.x, centerY: center.y };
      state.panStart = null;
    }
    event.preventDefault();
  });

  elements.stage.addEventListener('pointermove', (event) => {
    if (!state.viewPointers.has(event.pointerId) || event.target === elements.cameraVideo) return;
    state.viewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.viewPointers.size >= 2 && state.pinchStart) {
      const points = [...state.viewPointers.values()].slice(0, 2);
      const center = pointerCenter(points[0], points[1]);
      state.mediaView.scale = state.pinchStart.scale * pointerDistance(points[0], points[1]) / Math.max(1, state.pinchStart.distance);
      state.mediaView.x = state.pinchStart.x + center.x - state.pinchStart.centerX;
      state.mediaView.y = state.pinchStart.y + center.y - state.pinchStart.centerY;
      clampMediaView();
      event.preventDefault();
    } else if (state.viewPointers.size === 1 && state.panStart && state.mediaView.scale > 1) {
      state.mediaView.x = state.panStart.viewX + event.clientX - state.panStart.x;
      state.mediaView.y = state.panStart.viewY + event.clientY - state.panStart.y;
      clampMediaView();
      event.preventDefault();
    }
  });

  function endMediaPointer(event) {
    state.viewPointers.delete(event.pointerId);
    state.pinchStart = null;
    state.panStart = null;
    if (state.viewPointers.size === 1 && state.mediaView.scale > 1) {
      const point = [...state.viewPointers.values()][0];
      state.panStart = { x: point.x, y: point.y, viewX: state.mediaView.x, viewY: state.mediaView.y };
    }
  }
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => elements.stage.addEventListener(name, endMediaPointer));

  window.addEventListener('resize', resizeStage);
  window.addEventListener('beforeunload', (event) => {
    if (state.recorder && state.recorder.state !== 'inactive') {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => {
    if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    stopCameraTracks();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.recorder?.state === 'recording') requestWakeLock();
  });

  restorePreferences();
  setAspect(9, 16);
  updateTabs();
  resizeStage();
  applyMediaView();
  updateTeleText(true);
  updateAudioLabel();

  if ('serviceWorker' in navigator && location.hostname !== 'appassets.androidplatform.net') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
