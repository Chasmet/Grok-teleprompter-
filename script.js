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

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let micStream = null;
let importedVideoFile = null;
let importedVideoUrl = null;
let isRecording = false;
let downloadUrl = null;
let recordingMode = null;

let mediaRecorder = null;
let recordedChunks = [];
let recordingStart = null;
let timerInterval = null;

let offscreenCanvas = null;
let offscreenCtx = null;
let drawFrameId = null;

let audioCtx = null;
let audioDestNode = null;
let videoAudioSource = null;
let micAudioSource = null;

let scrollY = 0;
let baseOffset = Number(localStorage.getItem('teleprompter_base_offset') || 0);
let scrollSpeed = 3;
let scrolling = false;
let animationFrame = null;
let lastTimestamp = 0;

function save(key, value) { localStorage.setItem(key, String(value)); }
function formatTime(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

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
  if (!downloadLink) return;

  if (downloadUrl) URL.revokeObjectURL(downloadUrl);

  downloadUrl = URL.createObjectURL(blob);
  downloadLink.href = downloadUrl;
  downloadLink.download = filename;
  downloadLink.textContent = label;

  // Forcer l'affichage sur mobile Android
  downloadLink.hidden = false;
  downloadLink.removeAttribute('hidden');
  downloadLink.style.display = 'block';
  downloadLink.style.visibility = 'visible';
  downloadLink.style.opacity = '1';
  downloadLink.style.pointerEvents = 'auto';

  // Défilement vers le bouton si nécessaire
  setTimeout(() => {
    try {
      downloadLink.scrollIntoView({ behavior: 'smooth', block: 'end' }); 
    } catch (_) {}
  }, 50);

  // Déclenche automatiquement le téléchargement sur Android/Chrome
  setTimeout(() => {
    try {
      downloadLink.click(); 
    } catch (_) {}
  }, 300);
}

function resetDownload() {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }

  if (!downloadLink) return;

  downloadLink.removeAttribute('href');
  downloadLink.removeAttribute('download');
  downloadLink.hidden = true;
  downloadLink.setAttribute('hidden', '');
}

// (le reste du script demeure inchangé dans le dépôt)
