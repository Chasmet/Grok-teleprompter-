const $ = (id) => document.getElementById(id);

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
const teleprompterText = $('teleprompterText');
const livePanel = $('livePanel');
const videoPanel = $('videoPanel');

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let micStream = null;
let activeVideoUrl = null;
let mediaRecorder = null;
let recordedChunks = [];
let scrollInterval = null;
let scrollPosition = 0;
let baseOffset = Number(localStorage.getItem('teleprompter_base_offset') || 0);
let recordSeconds = 0;
let recordInterval = null;
let currentRecordingMode = 'live';

function save(key, value) {
  localStorage.setItem(key, String(value));
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function applyMirror(video) {
  if (video) video.classList.toggle('mirrored');
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach(track => track.stop());
}

function stopCameraStream() {
  stopStream(cameraStream);
  cameraStream = null;
  if (cameraPreview) cameraPreview.srcObject = null;
}

async function getMicrophoneStream() {
  if (micStream && micStream.active) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); 
  return micStream;
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Caméra non disponible sur ce navigateur.');
    return;
  }

  try {
    stopCameraStream(); 

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true
    }); 

    setMode('live'); 

    cameraPreview.srcObject = cameraStream;
    cameraPreview.muted = true;
    cameraPreview.playsInline = true;
    cameraPreview.hidden = false;

    await cameraPreview.play(); 
  } catch (error) {
    console.error(error);
    alert('Impossible d\'accéder à la caméra. Vérifie les permissions caméra et micro.');
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

  if (cameraPreview) cameraPreview.hidden = !isLive;
  if (importedVideo) importedVideo.hidden = isLive;

  if (livePanel) livePanel.hidden = !isLive;
  if (videoPanel) videoPanel.hidden = isLive;

  if (!isLive) stopCameraStream(); 
}

function openVideoPicker() {
  setMode('video'); 

  setTimeout(() => {
    try {
      if (videoInput?.showPicker) videoInput.showPicker(); else videoInput?.click(); 
    } catch {
      videoInput?.click(); 
    }
  }, 100);
}

function loadVideo(file) {
  if (!file) return;

  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
  activeVideoUrl = URL.createObjectURL(file);

  setMode('video'); 

  importedVideo.pause(); 
  importedVideo.src = activeVideoUrl;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.controls = false;
  importedVideo.hidden = false;
  importedVideo.load(); 

  importedVideo.onloadeddata = () => {
    importedVideo.currentTime = 0;
  };

  videoInput.value = '';
}

function updateTeleprompterText() {
  const raw = scriptInput?.value || '';
  const finalText = raw.trim() || 'Colle ton texte ici...';

  if (teleprompterText) {
    teleprompterText.textContent = finalText;
    teleprompterText.style.fontSize = `${sizeRange.value}px`;
    teleprompterText.style.transform = `translateX(-50%) translateY(calc(100% + ${baseOffset - scrollPosition}px))`;
  }

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
  if (scrollInterval) stopScroll(); else startScroll(); 
}

function moveText(delta) {
  baseOffset += delta;
  save('teleprompter_base_offset', baseOffset);
  updateTeleprompterText(); 
}

async function startRecording() {
  try {
    // Détection fiable du mode actuel via la classe active.
    const isVideoMode = modeVideoBtn?.classList.contains('active');
    currentRecordingMode = isVideoMode ? 'video' : 'live';

    let streamToRecord;

    if (currentRecordingMode === 'live') {
      if (!cameraStream) {
        alert('Active la caméra avant d\'enregistrer.');
        return;
      }
      streamToRecord = cameraStream;
    } else {
      streamToRecord = await getMicrophoneStream(); 
      if (importedVideo && importedVideo.paused) {
        importedVideo.play().catch(() => {});
      }
    }

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(streamToRecord);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const isLive = currentRecordingMode === 'live';
      const blob = new Blob(recordedChunks, {
        type: isLive ? 'video/webm' : 'audio/webm'
      }); 

      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = `${isLive ? 'teleprompter-video' : 'teleprompter-audio'}-${Date.now()}.webm`;
      downloadLink.textContent = isLive ? 'Télécharger la vidéo' : 'Télécharger l\'audio';
      downloadLink.hidden = false;
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
    alert('Impossible d\'accéder au microphone. Vérifie les permissions micro.');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); 
  }
  clearInterval(recordInterval);
}

modeLiveBtn?.addEventListener('click', () => {
  setMode('live'); 
  startCamera(); 
}); 
modeVideoBtn?.addEventListener('click', openVideoPicker);
cameraBtn?.addEventListener('click', startCamera);
flipBtn?.addEventListener('click', flipCamera);
mirrorLiveBtn?.addEventListener('click', () => applyMirror(cameraPreview));
mirrorVideoBtn?.addEventListener('click', () => applyMirror(importedVideo));
videoInput?.addEventListener('change', (e) => loadVideo(e.target.files?.[0]));
playBtn?.addEventListener('click', () => importedVideo?.play()); 
pauseBtn?.addEventListener('click', () => importedVideo?.pause()); 
stopVideoBtn?.addEventListener('click', () => {
  if (importedVideo) {
    importedVideo.pause(); 
    importedVideo.currentTime = 0;
  }
}); 
recordBtn?.addEventListener('click', startRecording);
stopBtn?.addEventListener('click', stopRecording);
applyTextBtn?.addEventListener('click', toggleScroll);
upBtn?.addEventListener('click', () => moveText(-20)); 
downBtn?.addEventListener('click', () => moveText(20)); 
scriptInput?.addEventListener('input', updateTeleprompterText);
sizeRange?.addEventListener('input', updateTeleprompterText);

(function init() {
  if (scriptInput) {
    scriptInput.value = localStorage.getItem('teleprompter_script') || scriptInput.value;
  }

  if (downloadLink) downloadLink.hidden = true;

  setMode('live'); 
  updateTeleprompterText(); 

  setTimeout(() => {
    startCamera().catch(() => {});
  }, 500);
})(); 
