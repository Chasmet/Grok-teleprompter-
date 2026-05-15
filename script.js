const modeBadge = document.getElementById('modeBadge');
const stageTitle = document.getElementById('stageTitle');
const stageContainer = document.getElementById('stageContainer');
const cameraPreview = document.getElementById('cameraPreview');
const videoPreview = document.getElementById('videoPreview');
const livePanel = document.getElementById('livePanel');
const videoPanel = document.getElementById('videoPanel');
const tabButtons = document.querySelectorAll('.tab-btn');
const qualitySelect = document.getElementById('qualitySelect');
const formatSelect = document.getElementById('formatSelect');
const cameraBtn = document.getElementById('cameraBtn');
const flipCameraBtn = document.getElementById('flipCameraBtn');
const videoInput = document.getElementById('videoInput');
const scriptInput = document.getElementById('scriptInput');
const prompterText = document.getElementById('prompterText');
const speedInput = document.getElementById('speed');
const sizeInput = document.getElementById('size');
const positionSlider = document.getElementById('positionSlider');
const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const downloadBtn = document.getElementById('downloadBtn');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const moveUpBtn = document.getElementById('moveUpBtn');
const moveDownBtn = document.getElementById('moveDownBtn');
const recordingIndicator = document.getElementById('recordingIndicator');

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let scrollInterval = null;
let paused = false;
let activeVideoUrl = null;
let recordingStartTime = null;
let recordingTimer = null;
let lastDownloadUrl = null;

let basePosition = parseInt(localStorage.getItem('textPosition') || '100', 10);
let scrollOffset = 0;

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function updateRecordingIndicator() {
  if (!recordingIndicator) return;
  if (!recordingStartTime) {
    recordingIndicator.textContent = '● REC';
    return;
  }
  recordingIndicator.textContent = `● REC ${formatDuration(Date.now() - recordingStartTime)}`;
}

function startRecordingTimer() {
  recordingStartTime = Date.now(); 
  recordingIndicator.hidden = false;
  updateRecordingIndicator(); 
  clearInterval(recordingTimer);
  recordingTimer = setInterval(updateRecordingIndicator, 1000);
}

function stopRecordingTimer() {
  clearInterval(recordingTimer);
  recordingTimer = null;
  recordingStartTime = null;
  updateRecordingIndicator(); 
  recordingIndicator.hidden = true;
}

function setDownloadReady(ready) {
  if (!downloadBtn) return;
  downloadBtn.disabled = !ready;
  downloadBtn.style.opacity = ready ? '1' : '0.6';
}

function applyPosition() {
  prompterText.style.transform = `translateY(${basePosition + scrollOffset}px)`;
}

function savePosition() {
  localStorage.setItem('textPosition', String(basePosition));
}

function updatePositionSlider() {
  if (positionSlider) positionSlider.value = basePosition;
}

function setBasePosition(value) {
  basePosition = parseInt(value, 10) || 0;
  updatePositionSlider();
  savePosition();
  applyPosition();
}

function switchMode(mode) {
  activeMode = mode;
  const isLive = mode === 'live';
  livePanel.hidden = !isLive;
  videoPanel.hidden = isLive;
  cameraPreview.hidden = !isLive;
  videoPreview.hidden = isLive;
  modeBadge.textContent = isLive ? 'Mode Live' : 'Mode Vidéo + Voix';
  stageTitle.textContent = isLive ? 'Aperçu caméra' : 'Vidéo importée';
  tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
}

function applyFormat() {
  const value = formatSelect.value;
  stageContainer.classList.remove('format-16-9', 'format-1-1');
  if (value === '16:9') stageContainer.classList.add('format-16-9');
  else if (value === '1:1') stageContainer.classList.add('format-1-1');
}

tabButtons.forEach((btn) => btn.addEventListener('click', () => switchMode(btn.dataset.mode)));

async function ensureMic() {
  if (!micStream) micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); 
  return micStream;
}

async function startCamera() {
  try {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop()); 
    const height = Number(qualitySelect.value);
    const width = facingMode === 'environment' ? 1280 : Math.round(height * 9 / 16);
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: width }, height: { ideal: height } },
      audio: true
    }); 
    cameraPreview.srcObject = cameraStream;
    await ensureMic(); 
    switchMode('live');
  } catch (error) {
    alert("Impossible d'accéder à la caméra : " + error.message);
  }
}

function updatePrompterText() {
  const text = scriptInput.value.trim() || 'Colle ton texte ici.';
  prompterText.textContent = text;
  localStorage.setItem('grok_script', scriptInput.value);
}

function startPrompter() {
  updatePrompterText(); 
  clearInterval(scrollInterval);
  paused = false;
  scrollOffset = 0;
  applyPosition(); 
  scrollInterval = setInterval(() => {
    if (paused) return;
    scrollOffset -= Number(speedInput.value) * 2;
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
}

function moveTextUp() {
  setBasePosition(basePosition - 50);
}

function moveTextDown() {
  setBasePosition(basePosition + 50);
}

async function buildRecordingStream() {
  if (activeMode === 'video' && videoPreview.src) {
    await ensureMic(); 
    const videoStream = videoPreview.captureStream(); 
    const combined = new MediaStream(); 
    videoStream.getVideoTracks().forEach((track) => combined.addTrack(track)); 
    micStream.getAudioTracks().forEach((track) => combined.addTrack(track)); 
    return combined;
  }
  if (!cameraStream) throw new Error("Active d'abord la caméra.");
  return cameraStream;
}

async function startRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      alert('Un enregistrement est déjà en cours.');
      return;
    }

    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }

    recordedChunks = [];
    recordedBlob = null;
    setDownloadReady(false);

    const stream = await buildRecordingStream(); 
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' }); 

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      if (recordedChunks.length === 0) {
        stopRecordingTimer(); 
        alert('Aucune donnée vidéo enregistrée.');
        return;
      }

      recordedBlob = new Blob(recordedChunks, { type: 'video/webm' }); 
      stopRecordingTimer(); 
      setDownloadReady(true);

      const sizeMB = (recordedBlob.size / 1024 / 1024).toFixed(2);
      alert(`Vidéo prête. Taille : ${sizeMB} MB. Appuie sur Télécharger.`);
    };

    mediaRecorder.start(1000);
    startRecordingTimer(); 
    startPrompter(); 

    if (activeMode === 'video') {
      videoPreview.currentTime = 0;
      videoPreview.play().catch(() => {});
      videoPreview.onended = stopRecording;
    }
  } catch (error) {
    alert(error.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); 
}

function downloadRecording() {
  if (!recordedBlob) {
    alert('Aucune vidéo enregistrée.');
    return;
  }

  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  lastDownloadUrl = URL.createObjectURL(recordedBlob);

  const now = new Date(); 
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

  const a = document.createElement('a');
  a.href = lastDownloadUrl;
  a.download = `grok-teleprompter-${stamp}.webm`;
  document.body.appendChild(a);
  a.click(); 
  document.body.removeChild(a);
}

function loadVideo(file) {
  if (!file) return;
  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
  activeVideoUrl = URL.createObjectURL(file);
  videoPreview.src = activeVideoUrl;
  switchMode('video');
}

function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : videoPreview;
  target.classList.toggle('mirror');
}

cameraBtn.addEventListener('click', startCamera);
flipCameraBtn.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
}); 
qualitySelect.addEventListener('change', () => {
  if (cameraStream && activeMode === 'live') startCamera(); 
}); 
formatSelect.addEventListener('change', applyFormat);
videoInput.addEventListener('change', (event) => loadVideo(event.target.files[0]));

scriptInput.value = localStorage.getItem('grok_script') || '';
scriptInput.addEventListener('input', updatePrompterText);
sizeInput.addEventListener('input', () => {
  prompterText.style.fontSize = sizeInput.value + 'px';
}); 
if (positionSlider) {
  positionSlider.addEventListener('input', (event) => setBasePosition(event.target.value)); 
}

recordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
downloadBtn.addEventListener('click', downloadRecording);
startBtn.addEventListener('click', startPrompter);
pauseBtn.addEventListener('click', togglePause);
resetBtn.addEventListener('click', resetPrompter);
mirrorBtn.addEventListener('click', toggleMirror);
if (moveUpBtn) moveUpBtn.addEventListener('click', moveTextUp);
if (moveDownBtn) moveDownBtn.addEventListener('click', moveTextDown);

prompterText.style.fontSize = sizeInput.value + 'px';
applyFormat();
updatePrompterText(); 
switchMode('live');
updatePositionSlider();
applyPosition(); 
setDownloadReady(false);
updateRecordingIndicator();