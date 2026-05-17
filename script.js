// Remplace ENTIEREMENT ton fichier script.js par ce code

const $ = id => document.getElementById(id);

// ===== ELEMENTS =====
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

// ===== VARIABLES =====
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

// ===== CAMERA =====
function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  cameraPreview.pause();

  if (cameraPreview.srcObject) {
    cameraPreview.srcObject = null;
  }

  cameraPreview.removeAttribute('src');
  cameraPreview.load();
}

async function startCamera() {
  try {
    stopCameraStream();

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode }
      },
      audio: true
    });

    setMode('live');

    cameraPreview.srcObject = cameraStream;
    await cameraPreview.play().catch(() => {});
  } catch (error) {
    alert("Impossible d'accéder à la caméra.");
  }
}

function flipCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
}

// ===== MODES =====
function setMode(mode) {
  activeMode = mode;
  const live = mode === 'live';

  modeLiveBtn.classList.toggle('active', live);
  modeVideoBtn.classList.toggle('active', !live);

  livePanel.hidden = !live;
  videoPanel.hidden = live;

  if (live) {
    cameraPreview.hidden = false;
    cameraPreview.style.display = 'block';

    importedVideo.pause();
    importedVideo.hidden = true;
    importedVideo.style.display = 'none';
  } else {
    stopCameraStream();

    cameraPreview.hidden = true;
    cameraPreview.style.display = 'none';

    importedVideo.hidden = false;
    importedVideo.style.display = 'block';
  }
}

// ===== IMPORT VIDEO =====
function openVideoPicker() {
  setMode('video');

  setTimeout(() => {
    try {
      if (typeof videoInput.showPicker === 'function') {
        videoInput.showPicker();
      } else {
        videoInput.click();
      }
    } catch (e) {
      videoInput.click();
    }
  }, 100);
}

function loadVideo(file) {
  if (!file) return;

  // Libérer ancienne URL
  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
    activeVideoUrl = null;
  }

  // Créer URL
  activeVideoUrl = URL.createObjectURL(file);

  // Arrêter caméra
  stopCameraStream();

  // Passer en mode vidéo
  setMode('video');

  // Réinitialiser le lecteur
  importedVideo.pause();
  importedVideo.removeAttribute('src');
  importedVideo.removeAttribute('poster');
  importedVideo.load();

  // Configurer la vidéo
  importedVideo.src = activeVideoUrl;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.preload = 'auto';
  importedVideo.controls = false;
  importedVideo.currentTime = 0;

  // Forcer affichage
  importedVideo.hidden = false;
  importedVideo.style.display = 'block';

  // Masquer totalement la caméra
  cameraPreview.hidden = true;
  cameraPreview.style.display = 'none';

  // Quand les données sont chargées
  importedVideo.onloadeddata = async () => {
    try {
      importedVideo.currentTime = 0;

      // Lecture ultra courte pour générer la miniature
      await importedVideo.play();

      setTimeout(() => {
        importedVideo.pause();
        importedVideo.currentTime = 0;
      }, 100);
    } catch (error) {
      // Android peut bloquer l'autoplay
      importedVideo.currentTime = 0;
    }
  };

  // Sécurité supplémentaire
  importedVideo.oncanplay = () => {
    importedVideo.currentTime = 0;
  };

  importedVideo.onerror = () => {
    alert('Impossible de charger cette vidéo.');
  };

  // Charger la vidéo
  importedVideo.load();
}

function stopImportedVideo() {
  importedVideo.pause();
  importedVideo.currentTime = 0;
  pausePrompter();
}

// ===== MIROIR =====
function toggleMirrorFor(target) {
  if (target) {
    target.classList.toggle('mirror');
  }
}

// ===== TELEPROMPTEUR =====
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
  teleprompterText.style.transform =
    `translateX(-50%) translateY(${baseOffset + scrollOffset}px)`;

  localStorage.setItem(
    'teleprompter_base_offset',
    String(baseOffset)
  );
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

function applyTextToTeleprompter() {
  updateTeleprompterText();
  scrollOffset = 0;
  applyPosition();
}

// ===== MINUTEUR =====
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

// ===== ENREGISTREMENT =====
function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  for (const type of types) {
    if (window.MediaRecorder &&
        MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return '';
}

// (Le reste de ton code d'enregistrement peut rester identique)
