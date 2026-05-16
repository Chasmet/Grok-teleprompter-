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

let renderCanvas = document.createElement('canvas');
let renderCtx = renderCanvas.getContext('2d');
let renderStream = null;
let renderAnimation = null;

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
  positionSlider.value = basePosition;
  applyPosition(); 
}

function startPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollInterval = setInterval(() => {
    if (paused) return;
    scrollOffset -= Number(speedInput.value || 1.8) * 2;
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
  livePanel.hidden = !live;
  videoPanel.hidden = live;
  cameraPreview.hidden = !live;
  videoPreview.hidden = live;
  modeBadge.textContent = live ? 'Mode Live' : 'Mode Vidéo + Voix';
  stageTitle.textContent = live ? 'Aperçu caméra' : 'Vidéo importée';
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode)); 
}

function applyFormat() {
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
    cameraPreview.srcObject = cameraStream;
    switchMode('live');
  } catch (e) {
    showMessage('Caméra refusée'); 
  }
}

function startCanvasRendering() {
  const width = videoPreview.videoWidth || 1080;
  const height = videoPreview.videoHeight || 1920;
  renderCanvas.width = width;
  renderCanvas.height = height;
  renderStream = renderCanvas.captureStream(30);

  const draw = () => {
    renderCtx.clearRect(0, 0, width, height);

    // IMPORTANT : seule la vidéo est dessinée.
    // Le texte du téléprompteur reste visible à l'écran,
    // mais n'est plus intégré dans le fichier exporté.
    renderCtx.drawImage(videoPreview, 0, 0, width, height);

    renderAnimation = requestAnimationFrame(draw);
  };

  draw(); 
  return renderStream;
}

function stopCanvasRendering() {
  if (renderAnimation) cancelAnimationFrame(renderAnimation);
  renderAnimation = null;
  if (renderStream) renderStream.getTracks().forEach(t => t.stop()); 
  renderStream = null;
}

async function startRecording() {
  try {
    let stream;

    if (activeMode === 'live') {
      if (!cameraStream) await startCamera(); 
      stream = cameraStream;
    } else {
      if (!videoPreview.src) return showMessage('Importe une vidéo'); 
      await ensureMic(); 
      videoPreview.controls = false;
      videoPreview.currentTime = 0;
      await videoPreview.play(); 

      const canvasStream = startCanvasRendering(); 
      stream = new MediaStream(); 
      canvasStream.getVideoTracks().forEach(t => stream.addTrack(t)); 
      micStream.getAudioTracks().forEach(t => stream.addTrack(t)); 
      videoPreview.onended = () => stopRecording(); 
    }

    recordedChunks = [];
    recordedBlob = null;
    setDownloadReady(false);

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' }); 

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      if (recordedChunks.length) {
        recordedBlob = new Blob(recordedChunks, { type: 'video/webm' }); 
        setDownloadReady(true);
        showMessage('Vidéo prête'); 
      }
      stopCanvasRendering(); 
      stopRecordingTimer(); 
      mediaRecorder = null;
    };

    mediaRecorder.start(); 
    startRecordingTimer(); 
    startPrompter(); 
  } catch (e) {
    showMessage('Erreur enregistrement'); 
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); 
}

function downloadRecording() {
  if (!recordedBlob) return showMessage('Aucune vidéo'); 
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  lastDownloadUrl = URL.createObjectURL(recordedBlob);
  const a = document.createElement('a');
  a.href = lastDownloadUrl;
  a.download = `grok-teleprompter-${Date.now()}.webm`;
  a.click(); 
}

function toggleMirror() {
  (activeMode === 'live' ? cameraPreview : videoPreview).classList.toggle('mirror'); 
}

function loadVideo(file) {
  if (!file) return;
  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
  activeVideoUrl = URL.createObjectURL(file);
  videoPreview.src = activeVideoUrl;
  videoPreview.controls = false;
  switchMode('video'); 
}

cameraBtn.addEventListener('click', startCamera);
flipCameraBtn.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera(); 
}); 
videoInput.addEventListener('change', e => loadVideo(e.target.files[0]));
qualitySelect.addEventListener('change', () => { if (cameraStream) startCamera(); }); 
formatSelect.addEventListener('change', applyFormat);
scriptInput.value = localStorage.getItem('grok_script') || '';
scriptInput.addEventListener('input', updatePrompterText);
sizeInput.addEventListener('input', applyTextSize);
positionSlider.addEventListener('input', e => setBasePosition(e.target.value)); 
startBtn.addEventListener('click', startPrompter);
recordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
pauseBtn.addEventListener('click', togglePause);
resetBtn.addEventListener('click', resetPrompter);
mirrorBtn.addEventListener('click', toggleMirror);
downloadBtn.addEventListener('click', downloadRecording);
moveUpBtn.addEventListener('click', () => setBasePosition(basePosition + 50)); 
moveDownBtn.addEventListener('click', () => setBasePosition(basePosition - 50)); 
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchMode(btn.dataset.mode)));

window.onload = () => {
  updatePrompterText(); 
  applyTextSize(); 
  applyPosition(); 
  applyFormat(); 
  switchMode('live'); 
  setDownloadReady(false); 
};
