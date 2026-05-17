/**
 * GROK TELEPROMPTER STUDIO — script.js v4
 * Utilise exportVideo cachée pour enregistrer sans incruster le téléprompteur.
 */

const $ = (id) => document.getElementById(id);

const modeBadge = $('modeBadge');
const stageTitle = $('stageTitle');
const stageContainer = $('stageContainer');
const cameraPreview = $('cameraPreview');
const videoPreview = $('videoPreview');
const exportVideo = $('exportVideo');
const livePanel = $('livePanel');
const videoPanel = $('videoPanel');
const qualitySelect = $('qualitySelect');
const formatSelect = $('formatSelect');
const cameraBtn = $('cameraBtn');
const flipCameraBtn = $('flipCameraBtn');
const videoInput = $('videoInput');
const scriptInput = $('scriptInput');
const prompterText = $('prompterText');
const speedInput = $('speed');
const sizeInput = $('size');
const positionSlider = $('positionSlider');
const recordBtn = $('recordBtn');
const stopRecordBtn = $('stopRecordBtn');
const downloadBtn = $('downloadBtn');
const startBtn = $('startBtn');
const pauseBtn = $('pauseBtn');
const resetBtn = $('resetBtn');
const mirrorBtn = $('mirrorBtn');
const moveUpBtn = $('moveUpBtn');
const moveDownBtn = $('moveDownBtn');
const recordingIndicator = $('recordingIndicator');

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let scrollInterval = null;
let paused = false;
let basePosition = parseInt(localStorage.getItem('textPosition') || '100', 10);
let scrollOffset = 0;
let recordingStartTime = null;
let recordingTimer = null;
let canvasAnimId = null;
let lastDownloadUrl = null;
let activeVideoUrl = null;

function getSupportedMimeType() {
  const candidates = ['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'video/webm';
}

function getFileExtension(mimeType) {
  return mimeType && mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function showMessage(message) {
  if (!recordingIndicator) return;
  recordingIndicator.hidden = false;
  recordingIndicator.style.display = 'inline-flex';
  recordingIndicator.textContent = message;
  setTimeout(() => {
    if (!recordingStartTime) {
      recordingIndicator.hidden = true;
      recordingIndicator.style.display = 'none';
      recordingIndicator.textContent = '● REC 00:00';
    }
  }, 2500);
}

function updateRecordingIndicator() {
  if (!recordingIndicator || !recordingStartTime) return;
  recordingIndicator.textContent = `● REC ${formatDuration(Date.now() - recordingStartTime)}`;
}

function startRecordingTimer() {
  stopRecordingTimer();
  recordingStartTime = Date.now();
  recordingIndicator.hidden = false;
  recordingIndicator.style.display = 'inline-flex';
  updateRecordingIndicator();
  recordingTimer = setInterval(updateRecordingIndicator, 1000);
}

function stopRecordingTimer() {
  clearInterval(recordingTimer);
  recordingTimer = null;
  recordingStartTime = null;
  if (recordingIndicator) {
    recordingIndicator.hidden = true;
    recordingIndicator.style.display = 'none';
    recordingIndicator.textContent = '● REC 00:00';
  }
}

function setDownloadReady(ready) {
  if (downloadBtn) downloadBtn.disabled = !ready;
}

function setRecordingState(isRecording) {
  if (recordBtn) recordBtn.disabled = isRecording;
  if (stopRecordBtn) stopRecordBtn.disabled = !isRecording;
}

function updatePrompterText() {
  const text = scriptInput?.value.trim() || 'Colle ton texte ici.';
  if (prompterText) prompterText.textContent = text;
  if (scriptInput) localStorage.setItem('grok_script', scriptInput.value);
}

function applyTextSize() {
  if (prompterText && sizeInput) prompterText.style.fontSize = `${sizeInput.value}px`;
}

function applyPosition() {
  if (prompterText) prompterText.style.transform = `translateY(${basePosition + scrollOffset}px)`;
}

function setBasePosition(value) {
  basePosition = parseInt(value, 10) || 0;
  localStorage.setItem('textPosition', String(basePosition));
  if (positionSlider) positionSlider.value = basePosition;
  applyPosition();
}

function startPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollInterval = setInterval(() => {
    if (paused) return;
    scrollOffset -= Number(speedInput?.value || 1.8) * 2;
    applyPosition();
  }, 33);
}

function togglePause() { paused = !paused; }

function resetPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollOffset = 0;
  applyPosition();
}

function switchMode(mode) {
  activeMode = mode;
  const live = mode === 'live';

  if (livePanel) livePanel.hidden = !live;
  if (videoPanel) videoPanel.hidden = live;

  if (cameraPreview) {
    cameraPreview.hidden = !live;
    cameraPreview.style.display = live ? 'block' : 'none';
  }

  if (videoPreview) {
    videoPreview.hidden = live;
    videoPreview.style.display = live ? 'none' : 'block';
    videoPreview.style.visibility = live ? 'hidden' : 'visible';
    videoPreview.style.opacity = live ? '0' : '1';
    videoPreview.style.backgroundColor = '#000';
  }

  if (modeBadge) modeBadge.textContent = live ? 'Mode Live' : 'Mode Vidéo + Voix';
  if (stageTitle) stageTitle.textContent = live ? 'Aperçu caméra' : 'Vidéo importée';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function applyFormat() {
  if (!stageContainer || !formatSelect) return;
  stageContainer.classList.remove('format-16-9', 'format-1-1');
  if (formatSelect.value === '16:9') stageContainer.classList.add('format-16-9');
  if (formatSelect.value === '1:1') stageContainer.classList.add('format-1-1');
}

async function ensureMic() {
  if (!micStream) micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
}

async function startCamera() {
  try {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
    if (cameraPreview) cameraPreview.srcObject = cameraStream;
    switchMode('live');
  } catch {
    showMessage('Caméra refusée');
  }
}

function buildCanvasStream(videoEl) {
  const w = videoEl.videoWidth || 1080;
  const h = videoEl.videoHeight || 1920;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  function drawLoop() {
    if (!videoEl.paused && !videoEl.ended) ctx.drawImage(videoEl, 0, 0, w, h);
    canvasAnimId = requestAnimationFrame(drawLoop);
  }

  drawLoop(); 
  return canvas.captureStream(30);
}

function stopCanvasLoop() {
  if (canvasAnimId !== null) {
    cancelAnimationFrame(canvasAnimId);
    canvasAnimId = null;
  }
}

async function startRecording() {
  try {
    stopCanvasLoop(); recordedChunks = []; recordedBlob = null; setDownloadReady(false);
    if (lastDownloadUrl) { URL.revokeObjectURL(lastDownloadUrl); lastDownloadUrl = null; }

    let stream;
    if (activeMode === 'live') {
      if (!cameraStream) await startCamera(); if (!cameraStream) return;
      stream = cameraStream;
    } else {
      if (!videoPreview?.src || !exportVideo) { showMessage('Importe une vidéo'); return; }
      await ensureMic(); exportVideo.currentTime = 0;
      await exportVideo.play(); const canvasStream = buildCanvasStream(exportVideo);
      stream = new MediaStream(); canvasStream.getVideoTracks().forEach(t => stream.addTrack(t)); micStream.getAudioTracks().forEach(t => stream.addTrack(t));
      exportVideo.onended = () => stopRecording(); }

    const prompter = $('prompter');
    const wasVisible = prompter && getComputedStyle(prompter).display !== 'none';
    if (wasVisible && prompter) prompter.style.display = 'none';

    const mimeType = getSupportedMimeType(); mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000, audioBitsPerSecond: 128000 }); 
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stopCanvasLoop(); 
      if (recordedChunks.length > 0) { recordedBlob = new Blob(recordedChunks, { type: mimeType }); setDownloadReady(true); showMessage('Vidéo prête'); }
      if (wasVisible && prompter) prompter.style.display = ''; 
      stopRecordingTimer(); setRecordingState(false); mediaRecorder = null; };

    mediaRecorder.start(1000); startRecordingTimer(); setRecordingState(true); startPrompter(); 
  } catch (e) { showMessage('Erreur enregistrement'); setRecordingState(false); stopCanvasLoop(); console.error(e); }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); 
  if (activeMode !== 'live' && exportVideo && !exportVideo.paused) exportVideo.pause(); 
}

function downloadRecording() {
  if (!recordedBlob) { showMessage('Aucune vidéo'); return; }
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl); 
  lastDownloadUrl = URL.createObjectURL(recordedBlob);
  const ext = getFileExtension(recordedBlob.type); 
  const a = document.createElement('a'); 
  a.href = lastDownloadUrl; 
  a.download = `grok-video-${Date.now()}.${ext}`; 
  document.body.appendChild(a); a.click(); document.body.removeChild(a); 
  showMessage('Téléchargement lancé');
}

function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : videoPreview; 
  if (target) target.classList.toggle('mirror');
}

function loadVideo(file) {
  if (!file || !videoPreview || !exportVideo) return;

  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
  activeVideoUrl = URL.createObjectURL(file);

  videoPreview.src = activeVideoUrl;
  videoPreview.muted = true;
  videoPreview.preload = 'auto';
  videoPreview.playsInline = true;

  exportVideo.src = activeVideoUrl;
  exportVideo.muted = true;
  exportVideo.preload = 'auto';
  exportVideo.playsInline = true;

  if (videoInput) videoInput.value = '';

  switchMode('video');
  showMessage('Vidéo importée');

  const onLoaded = async () => {
    try {
      videoPreview.currentTime = 0.1;
      await videoPreview.play(); 
      setTimeout(() => {
        videoPreview.pause(); 
      }, 200);
    } catch (e) {
      console.log('Preview vidéo', e);
    }
  };

  videoPreview.onloadeddata = onLoaded;
  videoPreview.load(); 
  exportVideo.load(); 
}

cameraBtn?.addEventListener('click', startCamera);
flipCameraBtn?.addEventListener('click', () => { facingMode = facingMode === 'user' ? 'environment' : 'user'; startCamera(); });
videoInput?.addEventListener('click', () => { if (videoInput) videoInput.value = ''; });
videoInput?.addEventListener('change', e => loadVideo(e.target.files[0]));
videoInput?.addEventListener('input', e => loadVideo(e.target.files[0]));
qualitySelect?.addEventListener('change', () => { if (cameraStream) startCamera(); }); 
formatSelect?.addEventListener('change', applyFormat);

if (scriptInput) {
  scriptInput.value = localStorage.getItem('grok_script') || '';
  scriptInput.addEventListener('input', updatePrompterText);
}

sizeInput?.addEventListener('input', applyTextSize); 
positionSlider?.addEventListener('input', e => setBasePosition(e.target.value));
startBtn?.addEventListener('click', startPrompter); 
recordBtn?.addEventListener('click', startRecording); 
stopRecordBtn?.addEventListener('click', stopRecording); 
pauseBtn?.addEventListener('click', togglePause); 
resetBtn?.addEventListener('click', resetPrompter); 
mirrorBtn?.addEventListener('click', toggleMirror); 
downloadBtn?.addEventListener('click', downloadRecording); 
moveUpBtn?.addEventListener('click', () => setBasePosition(basePosition + 50)); 
moveDownBtn?.addEventListener('click', () => setBasePosition(basePosition - 50));
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchMode(btn.dataset.mode)));

window.onload = () => {
  updatePrompterText(); 
  applyTextSize(); 
  applyPosition(); 
  applyFormat(); 
  switchMode('live'); 
  setDownloadReady(false); 
  setRecordingState(false);
};