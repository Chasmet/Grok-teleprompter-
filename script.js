const $ = (id) => document.getElementById(id);

// ─── Éléments DOM ───────────────────────────────────────────────────────────
const modeLiveBtn         = $('modeLiveBtn');
const modeVideoBtn        = $('modeVideoBtn');
const cameraPreview       = $('cameraPreview');
const importedVideo       = $('importedVideo');
const cameraBtn           = $('cameraBtn');
const flipBtn             = $('flipBtn');
const mirrorLiveBtn       = $('mirrorLiveBtn');
const mirrorVideoBtn      = $('mirrorVideoBtn');
const videoInput          = $('videoInput');
const playBtn             = $('playBtn');
const pauseBtn            = $('pauseBtn');
const stopVideoBtn        = $('stopVideoBtn');
const recordBtn           = $('recordBtn');
const stopBtn             = $('stopBtn');
const recordTimer         = $('recordTimer');
const downloadLink        = $('downloadLink');
const statusMessage       = $('statusMessage');
const speedRange          = $('speedRange');
const sizeRange           = $('sizeRange');
const scriptInput         = $('scriptInput');
const applyTextBtn        = $('applyTextBtn');
const upBtn               = $('upBtn');
const downBtn             = $('downBtn');
const teleprompterText    = $('teleprompterText');
const teleprompterContainer = $('teleprompterContainer');
const livePanel           = $('livePanel');
const videoPanel          = $('videoPanel');

// ─── État global ─────────────────────────────────────────────────────────────
let activeMode      = 'live';
let facingMode      = 'user';
let cameraStream    = null;
let micStream       = null;
let importedVideoFile = null;
let importedVideoUrl  = null;
let isRecording     = false;
let downloadUrl     = null;
let recordingMode   = null;

// ─── MediaRecorder natif ─────────────────────────────────────────────────────
let mediaRecorder       = null;
let recordedChunks      = [];
let recordingStart      = null;
let timerInterval       = null;

// ─── Canvas (mode vidéo importée) ────────────────────────────────────────────
let offscreenCanvas     = null;
let offscreenCtx        = null;
let drawFrameId         = null;

// ─── AudioContext (mixage vidéo + micro) ─────────────────────────────────────
let audioCtx            = null;
let audioDestNode       = null;
let videoAudioSource    = null;

// ─── Téléprompteur ───────────────────────────────────────────────────────────
let scrollY         = 0;
let baseOffset      = Number(localStorage.getItem('teleprompter_base_offset') || 0);
let scrollSpeed     = 3;
let scrolling       = false;
let animationFrame  = null;
let lastTimestamp   = 0;

function save(key, value) { localStorage.setItem(key, String(value)); }

function formatTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function setStatus(message = '', level = 'info') {
  if (!statusMessage) return;
  if (!message) {
    statusMessage.hidden = true;
    statusMessage.textContent = '';
    statusMessage.dataset.level = '';
    return;
  }
  statusMessage.textContent = message;
  statusMessage.dataset.level = level;
  statusMessage.hidden = false;
}

function setDownload(blob, filename, label) {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(blob);
  downloadLink.href = downloadUrl;
  downloadLink.download = filename;
  downloadLink.textContent = label;
  downloadLink.hidden = false;
}

function resetDownload() {
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  downloadLink.removeAttribute('href');
  downloadLink.removeAttribute('download');
  downloadLink.hidden = true;
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

function setRecordingState(recording) {
  isRecording = recording;
  recordBtn.disabled = recording;
  stopBtn.disabled = !recording;
}

function getBestMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function setMode(mode) {
  activeMode = mode;
  const isLive = mode === 'live';
  modeLiveBtn.classList.toggle('active', isLive);
  modeVideoBtn.classList.toggle('active', !isLive);
  cameraPreview.hidden = !isLive;
  importedVideo.hidden = isLive;
  livePanel.hidden = !isLive;
  videoPanel.hidden = isLive;
  if (!isLive) {
    stopStream(cameraStream);
    cameraStream = null;
    cameraPreview.srcObject = null;
  }
  if (!isRecording) setStatus('');
  recordBtn.disabled = isRecording;
}

async function startCamera() {
  try {
    stopStream(cameraStream);
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    setMode('live');
    cameraPreview.srcObject = cameraStream;
    cameraPreview.muted = true;
    cameraPreview.playsInline = true;
    await cameraPreview.play();
  } catch (err) {
    console.error(err);
    alert("Impossible d'accéder à la caméra.");
  }
}

function flipCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
}

function openVideoPicker() {
  setMode('video');
  videoInput.click();
}

function loadVideo(file) {
  if (!file) return;
  importedVideoFile = file;
  if (importedVideoUrl) URL.revokeObjectURL(importedVideoUrl);
  importedVideoUrl = URL.createObjectURL(file);
  importedVideo.src = importedVideoUrl;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.load();
  setMode('video');
}

async function getMicrophoneStream() {
  if (micStream && micStream.active) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  return micStream;
}

function ensureCanvas() {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
  }
  offscreenCanvas.width = importedVideo.videoWidth || 1280;
  offscreenCanvas.height = importedVideo.videoHeight || 720;
  offscreenCtx = offscreenCanvas.getContext('2d');
  return offscreenCanvas;
}

function drawFrame() {
  if (!offscreenCtx) return;
  offscreenCtx.drawImage(importedVideo, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
  drawFrameId = requestAnimationFrame(drawFrame);
}

function stopCanvasDraw() {
  if (drawFrameId) { cancelAnimationFrame(drawFrameId); drawFrameId = null; }
}

function setupAudioMix(micStreamObj) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
  audioDestNode = audioCtx.createMediaStreamDestination(); 

  if (!videoAudioSource) {
    videoAudioSource = audioCtx.createMediaElementSource(importedVideo);
  }
  videoAudioSource.connect(audioCtx.destination);
  videoAudioSource.connect(audioDestNode);

  const micSource = audioCtx.createMediaStreamSource(micStreamObj);
  micSource.connect(audioDestNode);
}

function teardownAudioMix() {
  if (audioCtx) {
    if (videoAudioSource) {
      try { videoAudioSource.disconnect(); } catch (_) {}
    }
    audioCtx.close().catch(() => {});
    audioCtx = null;
    audioDestNode = null;
    videoAudioSource = null;
  }
}

async function startRecordingVideoMode() {
  if (!importedVideoFile) {
    alert("Importe une vidéo avant de lancer l'enregistrement.");
    return false;
  }

  const mic = await getMicrophoneStream(); 
  ensureCanvas(); 

  importedVideo.muted = false;
  setupAudioMix(mic);

  drawFrame(); 

  if (importedVideo.paused) await importedVideo.play().catch(() => {});

  const canvasStream = offscreenCanvas.captureStream(30);
  audioDestNode.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t)); 

  const mimeType = getBestMimeType(); 
  mediaRecorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : {});
  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    stopCanvasDraw(); 
    importedVideo.pause(); 
    importedVideo.muted = true;
    teardownAudioMix(); 

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' }); 
    setDownload(blob, `teleprompter-final-${Date.now()}.${ext}`, '⬇️ Télécharger la vidéo finale'); 
    setStatus('Enregistrement terminé. Téléchargement prêt.', 'success'); 

    stopStream(micStream);
    micStream = null;
    mediaRecorder = null;
    recordingMode = null;
  };

  mediaRecorder.start(100);
  return true;
}

async function startRecordingLiveMode() {
  if (!cameraStream) await startCamera(); 
  if (!cameraStream) throw new Error('Flux caméra indisponible.');

  const mimeType = getBestMimeType(); 
  mediaRecorder = new MediaRecorder(cameraStream, mimeType ? { mimeType } : {});
  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' }); 
    setDownload(blob, `teleprompter-live-${Date.now()}.${ext}`, '⬇️ Télécharger la vidéo'); 
    setStatus('Enregistrement terminé. Téléchargement prêt.', 'success'); 
    mediaRecorder = null;
    recordingMode = null;
  };

  mediaRecorder.start(100);
}

async function startRecording() {
  if (isRecording) return;

  try {
    resetDownload(); 
    recordedChunks = [];
    recordingMode = activeMode;

    if (recordingMode === 'video') {
      const ok = await startRecordingVideoMode(); 
      if (!ok) { recordingMode = null; return; }
    } else {
      await startRecordingLiveMode(); 
    }

    setRecordingState(true); 
    startTimer(); 
    setStatus('Enregistrement en cours...', 'info'); 
  } catch (err) {
    console.error(err);
    setRecordingState(false);
    recordingMode = null;
    alert('Impossible de démarrer : ' + (err.message || 'erreur inconnue'));
  }
}

function stopRecording() {
  if (!mediaRecorder || !isRecording) return;
  stopTimer(); 
  setRecordingState(false); 
  mediaRecorder.stop(); 
}

function startTimer() {
  recordingStart = Date.now(); 
  recordTimer.textContent = '00:00';
  timerInterval = setInterval(() => {
    recordTimer.textContent = formatTime(Math.floor((Date.now() - recordingStart) / 1000)); 
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function normalizeTeleprompterOffset() {
  const h = teleprompterContainer?.clientHeight || 0;
  if (!h) return;
  const max = Math.floor(h * 0.45);
  baseOffset = Math.max(-max, Math.min(max, baseOffset));
  save('teleprompter_base_offset', baseOffset);
}

function updateTeleprompterText() {
  const raw = scriptInput.value || '';
  const text = raw.trim() || 'Colle ton texte ici...';
  teleprompterText.textContent = text;
  teleprompterText.style.fontSize = `${sizeRange.value}px`;
  const h = teleprompterContainer?.clientHeight || 300;
  const y = h * 0.2 + baseOffset - scrollY;
  teleprompterText.style.transform = `translateX(-50%) translateY(${y}px)`;
  save('teleprompter_script', raw);
}

function animateTeleprompter(timestamp) {
  if (!scrolling) return;
  if (!lastTimestamp) lastTimestamp = timestamp;
  const delta = timestamp - lastTimestamp;
  lastTimestamp = timestamp;
  scrollY += (scrollSpeed * delta) / 30;
  updateTeleprompterText();
  animationFrame = requestAnimationFrame(animateTeleprompter);
}

function startScroll() {
  if (scrolling) return;
  scrolling = true;
  lastTimestamp = 0;
  scrollSpeed = Number(speedRange.value);
  animationFrame = requestAnimationFrame(animateTeleprompter);
}

function stopScroll() {
  scrolling = false;
  if (animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = null; }
  lastTimestamp = 0;
}

function toggleScroll() { scrolling ? stopScroll() : startScroll(); }

function moveText(delta) {
  baseOffset += delta;
  save('teleprompter_base_offset', baseOffset);
  updateTeleprompterText();
}

modeLiveBtn.addEventListener('click', startCamera);
modeVideoBtn.addEventListener('click', openVideoPicker);
cameraBtn.addEventListener('click', startCamera);
flipBtn.addEventListener('click', flipCamera);
mirrorLiveBtn.addEventListener('click', () => cameraPreview.classList.toggle('mirrored'));
mirrorVideoBtn.addEventListener('click', () => importedVideo.classList.toggle('mirrored'));
videoInput.addEventListener('change', (e) => loadVideo(e.target.files[0]));
playBtn.addEventListener('click', () => importedVideo.play());
pauseBtn.addEventListener('click', () => importedVideo.pause());
stopVideoBtn.addEventListener('click', () => { importedVideo.pause(); importedVideo.currentTime = 0; });
recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
applyTextBtn.addEventListener('click', toggleScroll);
upBtn.addEventListener('click', () => moveText(-20));
downBtn.addEventListener('click', () => moveText(20));
scriptInput.addEventListener('input', updateTeleprompterText);
sizeRange.addEventListener('input', updateTeleprompterText);
speedRange.addEventListener('input', () => { scrollSpeed = Number(speedRange.value); }); 
window.addEventListener('resize', () => { normalizeTeleprompterOffset(); updateTeleprompterText(); }); 

(function init() {
  scriptInput.value = localStorage.getItem('teleprompter_script') || scriptInput.value;
  resetDownload(); 
  setRecordingState(false); 
  scrollY = 0;
  scrolling = false;
  stopScroll(); 
  setMode('live'); 

  requestAnimationFrame(() => { normalizeTeleprompterOffset(); updateTeleprompterText(); }); 
  setTimeout(() => { normalizeTeleprompterOffset(); updateTeleprompterText(); }, 120);

  window.addEventListener('load', () => { normalizeTeleprompterOffset(); updateTeleprompterText(); }); 
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { normalizeTeleprompterOffset(); updateTeleprompterText(); }
  }); 
  window.addEventListener('beforeunload', () => {
    stopStream(cameraStream);
    stopStream(micStream);
    if (importedVideoUrl) { URL.revokeObjectURL(importedVideoUrl); importedVideoUrl = null; }
    resetDownload(); 
  }); 
})();
