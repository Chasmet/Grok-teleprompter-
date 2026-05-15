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

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateRecordingIndicator() {
  if (!recordingIndicator) return;
  const text = recordingStartTime
    ? `● REC ${formatDuration(Date.now() - recordingStartTime)}`
    : '● REC 00:00';
  recordingIndicator.textContent = text;
}

function startRecordingTimer() {
  clearInterval(recordingTimer);
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
  updateRecordingIndicator(); 
  recordingIndicator.hidden = true;
  recordingIndicator.style.display = 'none';
}

function setDownloadReady(ready) {
  if (!downloadBtn) return;
  downloadBtn.disabled = !ready;
  downloadBtn.style.opacity = ready ? '1' : '0.6';
}

function updatePrompterText() {
  const text = scriptInput.value.trim() || 'Colle ton texte ici.';
  prompterText.textContent = text;
  localStorage.setItem('grok_script', scriptInput.value);
}

function applyTextSize() {
  prompterText.style.fontSize = `${sizeInput.value}px`;
}

function applyPosition() {
  prompterText.style.transform = `translateY(${basePosition + scrollOffset}px)`;
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
  if (!recordingStartTime) startRecordingTimer(); // chronomètre visible aussi avec Play
  scrollInterval = setInterval(() => {
    if (paused) return;
    scrollOffset -= Number(speedInput.value || 1.8) * 2;
    applyPosition(); 
  }, 16);
}

function togglePause() {
  paused = !paused;
}

function resetPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollOffset = 0;
  applyPosition(); 
  stopRecordingTimer(); 
}

function switchMode(mode) {
  activeMode = mode;
  const live = mode === 'live';
  if (livePanel) livePanel.hidden = !live;
  if (videoPanel) videoPanel.hidden = live;
  cameraPreview.hidden = !live;
  videoPreview.hidden = live;
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

async function startCamera() {
  try {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    const height = Number(qualitySelect?.value || 1080);
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, height: { ideal: height } },
      audio: true
    });
    cameraPreview.srcObject = cameraStream;
    switchMode('live');
  } catch (e) {
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
}

async function startRecording() {
  try {
    if (!cameraStream && activeMode === 'live') {
      await startCamera(); 
    }
    const stream = activeMode === 'live' ? cameraStream : videoPreview.captureStream(); 
    recordedChunks = [];
    recordedBlob = null;
    setDownloadReady(false);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' }); 
    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      if (!recordedChunks.length) return;
      recordedBlob = new Blob(recordedChunks, { type: 'video/webm' }); 
      setDownloadReady(true);
      stopRecordingTimer(); 
    };
    mediaRecorder.start(1000);
    startRecordingTimer(); 
    startPrompter(); 
  } catch (e) {
    alert(e.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); 
  } else {
    stopRecordingTimer(); 
  }
}

function downloadRecording() {
  if (!recordedBlob) {
    alert('Aucune vidéo enregistrée.');
    return;
  }
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  lastDownloadUrl = URL.createObjectURL(recordedBlob);
  const a = document.createElement('a');
  a.href = lastDownloadUrl;
  a.download = `grok-teleprompter-${Date.now()}.webm`;
  a.click(); 
}

function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : videoPreview;
  target.classList.toggle('mirror');
}

function loadVideo(file) {
  if (!file) return;
  videoPreview.src = URL.createObjectURL(file);
  switchMode('video');
}

cameraBtn?.addEventListener('click', startCamera);
flipCameraBtn?.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera(); 
}); 
videoInput?.addEventListener('change', e => loadVideo(e.target.files[0]));
qualitySelect?.addEventListener('change', () => {
  if (cameraStream) startCamera(); 
}); 
formatSelect?.addEventListener('change', applyFormat);

scriptInput.value = localStorage.getItem('grok_script') || '';
scriptInput.addEventListener('input', updatePrompterText);
sizeInput?.addEventListener('input', applyTextSize);
positionSlider?.addEventListener('input', e => setBasePosition(e.target.value));

recordBtn?.addEventListener('click', startRecording);
stopRecordBtn?.addEventListener('click', stopRecording);
downloadBtn?.addEventListener('click', downloadRecording);
startBtn?.addEventListener('click', startPrompter);
pauseBtn?.addEventListener('click', togglePause);
resetBtn?.addEventListener('click', resetPrompter);
mirrorBtn?.addEventListener('click', toggleMirror);
moveUpBtn?.addEventListener('click', () => setBasePosition(basePosition - 50));
moveDownBtn?.addEventListener('click', () => setBasePosition(basePosition + 50));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
}); 

updatePrompterText(); 
applyTextSize();
applyFormat(); 
switchMode('live');
setBasePosition(basePosition);
setDownloadReady(false);
stopRecordingTimer();