const $ = id => document.getElementById(id);

const modeLiveBtn = $('modeLiveBtn');
const modeVideoBtn = $('modeVideoBtn');
const livePanel = $('livePanel');
const videoPanel = $('videoPanel');
const cameraPreview = $('cameraPreview');
const importedVideo = $('importedVideo');
const cameraBtn = $('cameraBtn');
const flipBtn = $('flipBtn');
const mirrorLiveBtn = $('mirrorLiveBtn');
const mirrorVideoBtn = $('mirrorVideoBtn');
const playBtn = $('playBtn');
const pauseBtn = $('pauseBtn');
const stopVideoBtn = $('stopVideoBtn');
const recordBtn = $('recordBtn');
const stopBtn = $('stopBtn');
const recordTimer = $('recordTimer');
const downloadLink = $('downloadLink');
const videoInput = $('videoInput');
const scriptInput = $('scriptInput');
const applyTextBtn = $('applyTextBtn');
const upBtn = $('upBtn');
const downBtn = $('downBtn');
const teleprompterText = $('teleprompterText');
const speedRange = $('speedRange');
const sizeRange = $('sizeRange');

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let activeVideoUrl = null;
let scrollInterval = null;
let isPaused = false;
let baseOffset = 0;
let scrollOffset = 0;
let recordInterval = null;
let recordSeconds = 0;

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (cameraPreview.srcObject) {
    cameraPreview.srcObject = null;
  }
}

function setMode(mode) {
  activeMode = mode;
  const live = mode === 'live';

  modeLiveBtn.classList.toggle('active', live);
  modeVideoBtn.classList.toggle('active', !live);

  livePanel.hidden = !live;
  videoPanel.hidden = live;

  if (live) {
    cameraPreview.hidden = false;
    importedVideo.hidden = true;
  } else {
    stopCameraStream(); 
    cameraPreview.hidden = true;
    importedVideo.hidden = false;
  }
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function startRecordTimer() {
  stopRecordTimer(); 
  recordSeconds = 0;
  recordTimer.textContent = '00:00';
  recordInterval = setInterval(() => {
    recordSeconds++;
    recordTimer.textContent = formatTime(recordSeconds);
  }, 1000);
}

function stopRecordTimer() {
  clearInterval(recordInterval);
  recordInterval = null;
  recordSeconds = 0;
  recordTimer.textContent = '00:00';
}

function updateTeleprompterText() {
  const text = scriptInput.value.trim() || 'Colle ton texte ici...';
  teleprompterText.textContent = text;
  localStorage.setItem('teleprompter_script', scriptInput.value);
}

function applyTextSize() {
  teleprompterText.style.fontSize = `${sizeRange.value}px`;
  localStorage.setItem('teleprompter_size', sizeRange.value);
}

function applyPosition() {
  teleprompterText.style.transform = `translateX(-50%) translateY(${baseOffset + scrollOffset}px)`;
  localStorage.setItem('teleprompter_base_offset', String(baseOffset));
}

function moveUp() { baseOffset -= 20; applyPosition(); }
function moveDown() { baseOffset += 20; applyPosition(); }

function startPrompter() {
  if (scrollInterval) {
    isPaused = false;
    return;
  }
  isPaused = false;
  scrollInterval = setInterval(() => {
    if (isPaused) return;
    scrollOffset -= Number(speedRange.value || 3) * 1.2;
    applyPosition();
  }, 30);
}

function pausePrompter() {
  isPaused = true;
}

function stopPrompter() {
  clearInterval(scrollInterval);
  scrollInterval = null;
  isPaused = false;
  scrollOffset = 0;
  applyPosition();
}

async function startCamera() {
  try {
    stopCameraStream(); 

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: true
    }); 

    cameraPreview.srcObject = cameraStream;
    await cameraPreview.play().catch(() => {});
    setMode('live');
  } catch {
    alert("Impossible d'accéder à la caméra.");
  }
}

function flipCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera(); 
}

function openVideoPicker() {
  setMode('video'); 

  setTimeout(() => {
    try {
      if (typeof videoInput.showPicker === 'function') {
        videoInput.showPicker(); 
      } else {
        videoInput.click(); 
      }
    } catch {
      videoInput.click(); 
    }
  }, 50);
}

function loadVideo(file) {
  if (!file) return;

  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
  }

  activeVideoUrl = URL.createObjectURL(file);

  importedVideo.pause(); 
  importedVideo.src = activeVideoUrl;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.preload = 'auto';
  importedVideo.currentTime = 0;

  setMode('video'); 
  importedVideo.load(); 

  importedVideo.onloadedmetadata = () => {
    importedVideo.currentTime = 0;
  };
}

function stopImportedVideo() {
  importedVideo.pause(); 
  importedVideo.currentTime = 0;
  pausePrompter(); 
}

function toggleMirrorFor(target) {
  if (target) target.classList.toggle('mirror'); 
}

function getSupportedMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]; 

  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return ''; 
}

async function startRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') return;

    recordedChunks = [];
    downloadLink.hidden = true;

    let streamToRecord;

    if (activeMode === 'live') {
      if (!cameraStream) await startCamera(); 
      streamToRecord = cameraStream;
    } else {
      if (!importedVideo.src) {
        alert('Importe une vidéo d’abord.');
        return;
      }

      await importedVideo.play().catch(() => {});

      const capture = importedVideo.captureStream || importedVideo.mozCaptureStream;
      if (!capture) {
        alert('Capture vidéo non supportée.');
        return;
      }

      streamToRecord = capture.call(importedVideo, 30);
      importedVideo.onended = stopRecording;
    }

    const mimeType = getSupportedMimeType(); 
    mediaRecorder = new MediaRecorder(streamToRecord, mimeType ? { mimeType } : undefined);

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' }); 
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = `teleprompteur-${Date.now()}.webm`;
      downloadLink.textContent = 'Télécharger la vidéo';
      downloadLink.hidden = false;

      stopRecordTimer(); 
      recordBtn.disabled = false;
      stopBtn.disabled = true;
      mediaRecorder = null;
    };

    mediaRecorder.start(1000); 
    startPrompter(); 
    startRecordTimer(); 

    recordBtn.disabled = true;
    stopBtn.disabled = false;
  } catch {
    alert("Erreur lors de l'enregistrement.");
    stopRecordTimer(); 
    recordBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); 
  }

  if (activeMode === 'video') {
    importedVideo.pause(); 
  }

  stopPrompter(); 
  stopRecordTimer(); 
  recordBtn.disabled = false;
  stopBtn.disabled = true;
}

function applyTextToTeleprompter() {
  updateTeleprompterText(); 
  scrollOffset = 0;
  applyPosition(); 
}

modeLiveBtn.addEventListener('click', startCamera);
modeVideoBtn.addEventListener('click', openVideoPicker);
cameraBtn.addEventListener('click', startCamera);
flipBtn.addEventListener('click', flipCamera);
mirrorLiveBtn.addEventListener('click', () => toggleMirrorFor(cameraPreview));
mirrorVideoBtn.addEventListener('click', () => toggleMirrorFor(importedVideo));
videoPanel.querySelector('.file-btn')?.addEventListener('click', event => {
  event.preventDefault(); 
  openVideoPicker(); 
}); 
playBtn.addEventListener('click', () => {
  if (activeMode === 'video' && importedVideo.src) {
    importedVideo.play().catch(() => {});
  }
  startPrompter(); 
}); 
pauseBtn.addEventListener('click', () => {
  pausePrompter(); 
  if (activeMode === 'video') importedVideo.pause(); 
}); 
stopVideoBtn?.addEventListener('click', stopImportedVideo);
recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
applyTextBtn.addEventListener('click', applyTextToTeleprompter);
upBtn.addEventListener('click', moveUp);
downBtn.addEventListener('click', moveDown);
videoInput.addEventListener('change', event => {
  const file = event.target.files && event.target.files[0]; 
  if (file) loadVideo(file);
  videoInput.value = ''; 
}); 
scriptInput.addEventListener('input', updateTeleprompterText);
sizeRange.addEventListener('input', applyTextSize);

window.addEventListener('load', () => {
  const savedScript = localStorage.getItem('teleprompter_script');
  const savedSize = localStorage.getItem('teleprompter_size');
  const savedOffset = localStorage.getItem('teleprompter_base_offset');

  if (savedScript !== null) scriptInput.value = savedScript;
  if (savedSize !== null) sizeRange.value = savedSize;
  if (savedOffset !== null) baseOffset = parseInt(savedOffset, 10) || 0;

  updateTeleprompterText(); 
  applyTextSize(); 
  applyPosition(); 
  stopBtn.disabled = true;

  startCamera(); 
});