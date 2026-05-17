const $ = (id) => document.getElementById(id);

const modeBadge = $('modeBadge');
const stageTitle = $('stageTitle');
const stageContainer = $('stageContainer');
const cameraPreview = $('cameraPreview');
const videoPreview = $('videoPreview');
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
let lastDownloadUrl = null;
let activeVideoUrl = null;

// Utilitaires
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `\( {String(Math.floor(s / 60)).padStart(2, '0')}: \){String(s % 60).padStart(2, '0')}`;
}

function showMessage(message) {
  if (!recordingIndicator) return;
  recordingIndicator.hidden = false;
  recordingIndicator.style.display = 'inline-flex';
  recordingIndicator.textContent = message;
  setTimeout(() => {
    if (!recordingStartTime) recordingIndicator.style.display = 'none';
  }, 1800);
}

// Téléprompter
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

// Modes
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
  }

  if (modeBadge) modeBadge.textContent = live ? 'Mode Live' : 'Mode Vidéo + Voix';
  if (stageTitle) stageTitle.textContent = live ? 'Aperçu caméra' : 'Vidéo importée';

  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );
}

// Caméra
async function startCamera() {
  try {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode }, 
      audio: true 
    });
    cameraPreview.srcObject = cameraStream;
    switchMode('live');
  } catch (e) {
    showMessage("Caméra refusée");
  }
}

// Import Vidéo (fix principal)
function loadVideo(file) {
  if (!file) return;
  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);

  activeVideoUrl = URL.createObjectURL(file);
  videoPreview.src = activeVideoUrl;
  videoPreview.hidden = false;
  videoPreview.style.display = 'block';
  cameraPreview.hidden = true;
  cameraPreview.style.display = 'none';

  switchMode('video');
  showMessage('✅ Vidéo importée et affichée');
}

// Enregistrement (simplifié et stable)
async function startRecording() {
  try {
    recordedChunks = [];
    recordedBlob = null;

    let stream;
    if (activeMode === 'live') {
      if (!cameraStream) await startCamera();
      stream = cameraStream;
    } else {
      if (!videoPreview.src) {
        showMessage('Importe une vidéo');
        return;
      }
      await videoPreview.play();
      const videoStream = videoPreview.captureStream(30);
      stream = new MediaStream([...videoStream.getVideoTracks()]);
    }

    // Anti-incrustation
    const prompter = document.getElementById('prompter');
    const wasVisible = prompter && prompter.style.display !== 'none';
    if (wasVisible) prompter.style.display = 'none';

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(recordedChunks, { type: 'video/webm' });
      setDownloadReady(true);
      if (wasVisible && prompter) prompter.style.display = 'flex';
    };

    mediaRecorder.start();
    startRecordingTimer();
    startPrompter();
  } catch (e) {
    showMessage('Erreur enregistrement');
  }
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
}

function downloadRecording() {
  if (!recordedBlob) return showMessage('Aucune vidéo');
  const url = URL.createObjectURL(recordedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `grok-video-${Date.now()}.mp4`;
  a.click();
  URL.revokeObjectURL(url);
  showMessage('✅ Vidéo téléchargée');
}

function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : videoPreview;
  if (target) target.classList.toggle('mirror');
}

function setDownloadReady(ready) {
  if (downloadBtn) {
    downloadBtn.disabled = !ready;
    downloadBtn.style.opacity = ready ? '1' : '0.6';
  }
}

// Événements
videoInput?.addEventListener('change', (e) => {
  if (e.target.files[0]) loadVideo(e.target.files[0]);
});

cameraBtn?.addEventListener('click', startCamera);
flipCameraBtn?.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

recordBtn?.addEventListener('click', startRecording);
stopRecordBtn?.addEventListener('click', stopRecording);
downloadBtn?.addEventListener('click', downloadRecording);

sizeInput?.addEventListener('input', applyTextSize);
positionSlider?.addEventListener('input', e => setBasePosition(e.target.value));
startBtn?.addEventListener('click', startPrompter);
pauseBtn?.addEventListener('click', togglePause);
resetBtn?.addEventListener('click', resetPrompter);
mirrorBtn?.addEventListener('click', toggleMirror);

if (scriptInput) {
  scriptInput.value = localStorage.getItem('grok_script') || '';
  scriptInput.addEventListener('input', updatePrompterText);
}

window.onload = () => {
  updatePrompterText();
  applyTextSize();
  applyPosition();
  switchMode('live');
  setDownloadReady(false);
};
