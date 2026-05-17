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
let recordedBlob = null;
let activeVideoUrl = null;

let scrollInterval = null;
let isPaused = false;
let baseOffset = 0;
let scrollOffset = 0;

let recordInterval = null;
let recordSeconds = 0;

function setMode(mode) {
  activeMode = mode;

  const live = mode === 'live';

  modeLiveBtn.classList.toggle('active', live);
  modeVideoBtn.classList.toggle('active', !live);

  livePanel.hidden = !live;
  videoPanel.hidden = live;

  cameraPreview.hidden = !live;
  importedVideo.hidden = live;
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
    recordSeconds += 1;
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

function moveUp() {
  baseOffset -= 20;
  applyPosition();
}

function moveDown() {
  baseOffset += 20;
  applyPosition();
}

function startPrompter() {
  if (scrollInterval) {
    isPaused = false;
    return;
  }

  isPaused = false;
  scrollInterval = setInterval(() => {
    if (isPaused) return;
    const speed = Number(speedRange.value || 3);
    scrollOffset -= speed * 1.2;
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
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: true
    });

    cameraPreview.srcObject = cameraStream;
    cameraPreview.hidden = false;
    importedVideo.hidden = true;

    setMode('live');
  } catch (error) {
    alert("Impossible d'accéder à la caméra.");
  }
}

function flipCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
}

function loadVideo(file) {
  if (!file) return;

  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
  }

  activeVideoUrl = URL.createObjectURL(file);
  importedVideo.src = activeVideoUrl;
  importedVideo.loop = false;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.preload = 'auto';
  importedVideo.hidden = false;
  cameraPreview.hidden = true;

  importedVideo.load();
  setMode('video');
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
    recordedBlob = null;
    downloadLink.hidden = true;

    let streamToRecord;

    if (activeMode === 'live') {
      if (!cameraStream) await startCamera();
      streamToRecord = cameraStream;

      if (!streamToRecord) {
        alert('Caméra indisponible.');
        return;
      }
    } else {
      if (!importedVideo.src) {
        alert('Importe une vidéo d’abord.');
        return;
      }

      if (importedVideo.paused) {
        await importedVideo.play().catch(() => {});
      }

      const capture = importedVideo.captureStream || importedVideo.mozCaptureStream;
      if (!capture) {
        alert('La capture vidéo n’est pas supportée sur ce navigateur.');
        return;
      }

      streamToRecord = capture.call(importedVideo, 30);
    }

    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : undefined;

    mediaRecorder = new MediaRecorder(streamToRecord, options);

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, {
        type: mimeType || 'video/webm'
      });

      recordedBlob = blob;

      const url = URL.createObjectURL(blob);
      const ext = (mimeType && mimeType.includes('mp4')) ? 'mp4' : 'webm';

      downloadLink.href = url;
      downloadLink.download = `teleprompteur-${Date.now()}.${ext}`;
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
  } catch (error) {
    alert("Erreur lors de l'enregistrement.");
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    stopRecordTimer();
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

function toggleRecordingOrStop() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    stopRecording();
  } else {
    startRecording();
  }
}

function applyTextToTeleprompter() {
  updateTeleprompterText();
  scrollOffset = 0;
  applyPosition();
}

modeLiveBtn.addEventListener('click', () => setMode('live'));
modeVideoBtn.addEventListener('click', () => setMode('video'));

cameraBtn.addEventListener('click', startCamera);
flipBtn.addEventListener('click', flipCamera);

mirrorLiveBtn.addEventListener('click', () => toggleMirrorFor(cameraPreview));
mirrorVideoBtn.addEventListener('click', () => toggleMirrorFor(importedVideo));

videoInput.addEventListener('change', event => {
  const file = event.target.files && event.target.files[0];
  loadVideo(file);
  videoInput.value = '';
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

recordBtn.addEventListener('click', toggleRecordingOrStop);
stopBtn.addEventListener('click', stopRecording);

applyTextBtn.addEventListener('click', applyTextToTeleprompter);
upBtn.addEventListener('click', moveUp);
downBtn.addEventListener('click', moveDown);

scriptInput.addEventListener('input', updateTeleprompterText);
speedRange.addEventListener('input', () => {
  localStorage.setItem('teleprompter_speed', speedRange.value);
});
sizeRange.addEventListener('input', applyTextSize);

window.addEventListener('load', () => {
  const savedScript = localStorage.getItem('teleprompter_script');
  const savedSize = localStorage.getItem('teleprompter_size');
  const savedOffset = localStorage.getItem('teleprompter_base_offset');
  const savedSpeed = localStorage.getItem('teleprompter_speed');

  if (savedScript !== null) scriptInput.value = savedScript;
  if (savedSize !== null) sizeRange.value = savedSize;
  if (savedOffset !== null) baseOffset = parseInt(savedOffset, 10) || 0;
  if (savedSpeed !== null) speedRange.value = savedSpeed;

  updateTeleprompterText();
  applyTextSize();
  applyPosition();
  stopBtn.disabled = true;
  setMode('live');

  startCamera().catch(() => {});
});
