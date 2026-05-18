const $ = (id) => document.getElementById(id);

// Éléments
const modeLiveBtn = $('modeLiveBtn');
const modeVideoBtn = $('modeVideoBtn');
const cameraPreview = $('cameraPreview');
const importedVideo = $('importedVideo');
const cameraBtn = $('cameraBtn');
const flipBtn = $('flipBtn');
const mirrorLiveBtn = $('mirrorLiveBtn');
const mirrorVideoBtn = $('mirrorVideoBtn');
const videoInput = $('videoInput');
const playBtn = $('playBtn');
const pauseBtn = $('pauseBtn');
const stopVideoBtn = $('stopVideoBtn');
const recordBtn = $('recordBtn');
const stopBtn = $('stopBtn');
const recordTimer = $('recordTimer');
const downloadLink = $('downloadLink');
const speedRange = $('speedRange');
const sizeRange = $('sizeRange');
const scriptInput = $('scriptInput');
const applyTextBtn = $('applyTextBtn');
const upBtn = $('upBtn');
const downBtn = $('downBtn');
const teleprompterContainer = $('teleprompterContainer');
const teleprompterText = $('teleprompterText');
const livePanel = $('livePanel');
const videoPanel = $('videoPanel');

// Variables
let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let activeVideoUrl = null;
let mediaRecorder = null;
let recordedChunks = [];
let scrollInterval = null;
let scrollPosition = 0;
let baseOffset = Number(localStorage.getItem('teleprompter_base_offset') || 0);
let recordSeconds = 0;
let recordInterval = null;

function save(key, value) {
  localStorage.setItem(key, String(value));
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function applyMirror(video) {
  video.classList.toggle('mirrored');
}

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (cameraPreview) {
    cameraPreview.srcObject = null;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Caméra non disponible sur ce navigateur.');
    return;
  }

  try {
    stopCameraStream(); 

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: true
    });

    setMode('live');
    cameraPreview.srcObject = cameraStream;
    cameraPreview.muted = true;
    cameraPreview.playsInline = true;
    await cameraPreview.play(); 
  } catch (error) {
    console.error(error);
    alert('Impossible d\'accéder à la caméra. Vérifie les permissions Android.');
  }
}

function flipCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera(); 
}

function setMode(mode) {
  activeMode = mode;
  const isLive = mode === 'live';

  modeLiveBtn?.classList.toggle('active', isLive);
  modeVideoBtn?.classList.toggle('active', !isLive);

  cameraPreview.hidden = !isLive;
  importedVideo.hidden = isLive;

  if (livePanel) livePanel.hidden = !isLive;
  if (videoPanel) videoPanel.hidden = isLive;

  if (!isLive) {
    stopCameraStream(); 
  }
}

function openVideoPicker() {
  setMode('video');
  try {
    if (typeof videoInput.showPicker === 'function') {
      videoInput.showPicker(); 
    } else {
      videoInput.click(); 
    }
  } catch {
    videoInput.click(); 
  }
}

function loadVideo(file) {
  if (!file) return;

  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
  }

  activeVideoUrl = URL.createObjectURL(file);
  setMode('video');

  importedVideo.pause(); 
  importedVideo.src = activeVideoUrl;
  importedVideo.load(); 
  importedVideo.currentTime = 0;

  importedVideo.onloadeddata = () => {
    importedVideo.currentTime = 0;
  };

  importedVideo.onerror = () => {
    alert('Impossible de charger cette vidéo.');
  };

  videoInput.value = '';
}

function extractScriptText(rawText) {
  const text = (rawText || '').trim(); 
  if (!text) return 'Colle ton texte ici...';

  try {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim(); 

    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'string') return parsed;
    if (typeof parsed.script === 'string') return parsed.script;
    if (typeof parsed.text === 'string') return parsed.text;
  } catch {}

  return text;
}

function updateTeleprompterText() {
  const raw = scriptInput?.value || '';
  const finalText = extractScriptText(raw);
  teleprompterText.textContent = finalText;
  teleprompterText.style.fontSize = `${sizeRange.value}px`;
  teleprompterText.style.transform = `translateY(${baseOffset - scrollPosition}px)`;
  save('teleprompter_script', raw);
}

function startScroll() {
  stopScroll();
  scrollInterval = setInterval(() => {
    scrollPosition += Number(speedRange.value) * 0.6;
    updateTeleprompterText();
  }, 50);
}

function stopScroll() {
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
}

function toggleScroll() {
  if (scrollInterval) {
    stopScroll(); 
  } else {
    startScroll(); 
  }
}

function moveText(delta) {
  baseOffset += delta;
  save('teleprompter_base_offset', baseOffset);
  updateTeleprompterText(); 
}

function startRecording() {
  if (!cameraStream) {
    alert('Active la caméra avant d\'enregistrer.');
    return;
  }

  try {
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(cameraStream, {
      mimeType: 'video/webm'
    }); 

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' }); 
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = `teleprompter-${Date.now()}.webm`;
      downloadLink.hidden = false;
      downloadLink.textContent = 'Télécharger la vidéo';
    };

    mediaRecorder.start(1000);
    recordSeconds = 0;
    recordTimer.textContent = '00:00';

    clearInterval(recordInterval);
    recordInterval = setInterval(() => {
      recordSeconds++;
      recordTimer.textContent = formatTime(recordSeconds);
    }, 1000);
  } catch (error) {
    console.error(error);
    alert('Enregistrement non supporté sur ce navigateur.');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); 
  }
  clearInterval(recordInterval);
}

// Événements
modeLiveBtn?.addEventListener('click', startCamera);
modeVideoBtn?.addEventListener('click', openVideoPicker);
cameraBtn?.addEventListener('click', startCamera);
flipBtn?.addEventListener('click', flipCamera);
mirrorLiveBtn?.addEventListener('click', () => applyMirror(cameraPreview));
mirrorVideoBtn?.addEventListener('click', () => applyMirror(importedVideo));
videoInput?.addEventListener('change', (e) => loadVideo(e.target.files?.[0]));
playBtn?.addEventListener('click', () => importedVideo.play()); 
pauseBtn?.addEventListener('click', () => importedVideo.pause()); 
stopVideoBtn?.addEventListener('click', () => {
  importedVideo.pause(); 
  importedVideo.currentTime = 0;
}); 
recordBtn?.addEventListener('click', startRecording);
stopBtn?.addEventListener('click', stopRecording);
applyTextBtn?.addEventListener('click', toggleScroll);
upBtn?.addEventListener('click', () => moveText(-20)); 
downBtn?.addEventListener('click', () => moveText(20)); 
scriptInput?.addEventListener('input', updateTeleprompterText);
sizeRange?.addEventListener('input', updateTeleprompterText);

// Initialisation
(function init() {
  if (scriptInput) {
    scriptInput.value = localStorage.getItem('teleprompter_script') || scriptInput.value;
  }
  setMode('live');
  updateTeleprompterText(); 
})(); 
