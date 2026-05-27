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
const videoPanelEl        = $('videoPanel');

// ─── État de l'application ──────────────────────────────────────────────────
let activeMode = 'live'; // 'live' ou 'video'
let facingMode = 'user'; 
let cameraStream = null;
let audioStream = null;  // Flux micro dédié pour le mode vidéo importée (voix off)
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let timerInterval = null;
let startTime = 0;

// ─── État du Téléprompteur ──────────────────────────────────────────────────
let scrollY = 0;
let scrollSpeed = parseInt(speedRange.value) || 3;
let scrolling = false;
let animationFrame = null;
let lastTimestamp = 0;

// Timer de nettoyage pour le message de statut
let statusTimeout = null;

// ─── Initialisation ─────────────────────────────────────────────────────────
function init() {
  updateTextDisplay();
  setupEventListeners();
}

// ─── Gestion du Texte & Défilement ──────────────────────────────────────────
function updateTextDisplay() {
  teleprompterText.textContent = scriptInput.value;
  teleprompterText.style.fontSize = `${sizeRange.value}px`;
  resetScroll();
}

function resetScroll() {
  scrolling = false;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  // Aligné sur le nouveau CSS (commence au milieu du conteneur haut de l'écran)
  scrollY = teleprompterContainer.clientHeight / 2; 
  teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`;
}

function startScroll() {
  if (scrolling) return;
  scrolling = true;
  lastTimestamp = performance.now();
  animationFrame = requestAnimationFrame(scrollLoop);
}

function scrollLoop(timestamp) {
  if (!scrolling) return;
  const delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  scrollY -= scrollSpeed * 15 * delta; 

  if (scrollY < -teleprompterText.clientHeight) {
    scrolling = false;
    setStatus("Fin du texte", "success");
    return;
  }

  teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`;
  animationFrame = requestAnimationFrame(scrollLoop);
}

// ─── Gestion Caméra (Mode Live) ─────────────────────────────────────────────
async function startCamera() {
  if (cameraStream) stopCamera();
  
  const constraints = {
    video: { 
      facingMode: facingMode,
      width: { ideal: 1280 }, 
      height: { ideal: 720 }
    },
    audio: true
  };

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraPreview.srcObject = cameraStream;
    setStatus("Caméra prête", "success");
  } catch (err) {
    console.error("Erreur d'accès caméra :", err);
    setStatus("Impossible d'accéder à la caméra", "error");
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => {
      track.stop();
      track.enabled = false;
    });
    cameraPreview.srcObject = null;
    cameraStream = null;
  }
}

// ─── Enregistrement Intelligent (Vidéo Live vs Audio Micro seul) ───────────
async function startRecording() {
  recordedChunks = [];
  let streamToRecord = null;
  let options = {};

  if (activeMode === 'live') {
    // MODE LIVE : Enregistrement Caméra + Micro
    if (!cameraStream) {
      setStatus("Activez d'abord la caméra !", "error");
      return;
    }
    streamToRecord = cameraStream;
    // Format MP4 h264 standardisé pour les mobiles, sinon repli webm
    options = MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac') ? { mimeType: 'video/mp4;codecs=h264,aac' } : { mimeType: 'video/webm' };
  } else {
    // MODE VIDÉO IMPORTÉE : Enregistrement Micro seul (Voix off)
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamToRecord = audioStream;
      // Enregistrement au format audio seul (.m4a / .mp4) ou webm si non géré
      options = MediaRecorder.isTypeSupported('audio/mp4') ? { mimeType: 'audio/mp4' } : { mimeType: 'audio/webm' };
    } catch (err) {
      console.error("Accès micro refusé :", err);
      setStatus("Accès au microphone refusé", "error");
      return;
    }
  }

  try {
    mediaRecorder = new MediaRecorder(streamToRecord, options);
  } catch (e) {
    console.warn("Repli sur le MediaRecorder natif", e);
    mediaRecorder = new MediaRecorder(streamToRecord);
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = () => {
    const isVideo = (activeMode === 'live');
    const defaultMime = isVideo ? 'video/mp4' : 'audio/mp4';
    const extension = mediaRecorder.mimeType.includes('mp4') ? (isVideo ? 'mp4' : 'm4a') : (isVideo ? 'webm' : 'webm');
    
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || defaultMime });
    const url = URL.createObjectURL(blob);
    
    downloadLink.href = url;
    downloadLink.download = `Grok_Prompter_${Date.now()}.${extension}`;
    downloadLink.style.display = 'inline-flex';
    downloadLink.removeAttribute('hidden');
    
    const labelLabel = isVideo ? "vidéo" : "voix off (audio)";
    setStatus(`Enregistrement sauvegardé ! Téléchargez votre ${labelLabel}.`, "success");

    // Coupe proprement le micro de la voix off à la fin de l'enregistrement
    if (!isVideo && audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }
  };

  // Découpage en paquets de 1s pour garantir la synchronisation audio/vidéo sur mobile
  mediaRecorder.start(1000);
  
  isRecording = true;
  recordBtn.disabled = true;
  stopBtn.disabled = false;
  
  // Synchro du Chronomètre
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
  
  // En mode vidéo, lance la lecture automatique en même temps que le défilement
  if (activeMode === 'video' && importedVideo.src) {
    importedVideo.play();
  }
  startScroll(); 
}

function stopRecording() {
  if (!isRecording) return;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  clearInterval(timerInterval);
  recordTimer.textContent = "00:00";
  scrolling = false;
  
  if (activeMode === 'video') {
    importedVideo.pause();
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  recordTimer.textContent = `${mins}:${secs}`;
}

// ─── Écouteurs d'Événements ─────────────────────────────────────────────────
function setupEventListeners() {
  // Onglet Mode Live
  modeLiveBtn.addEventListener('click', () => {
    activeMode = 'live';
    modeLiveBtn.classList.add('active');
    modeVideoBtn.classList.remove('active');
    livePanel.style.display = 'grid';
    videoPanelEl.style.display = 'none';
    cameraPreview.style.display = 'block';
    importedVideo.style.display = 'none';
    stopCamera();
    resetScroll();
  });

  // Onglet Mode Vidéo Importée
  modeVideoBtn.addEventListener('click', () => {
    activeMode = 'video';
    modeVideoBtn.classList.add('active');
    modeLiveBtn.classList.remove('active');
    livePanel.style.display = 'none';
    videoPanelEl.style.display = 'grid';
    cameraPreview.style.display = 'none';
    importedVideo.style.display = 'block';
    stopCamera();
    resetScroll();
  });

  // Contrôles Médias
  cameraBtn.addEventListener('click', startCamera);
  
  flipBtn.addEventListener('click', () => {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    if (cameraStream) startCamera();
  });
  
  mirrorLiveBtn.addEventListener('click', () => { cameraPreview.classList.toggle('mirrored'); });

  // Importation vidéo locale
  videoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (importedVideo.src) {
        URL.revokeObjectURL(importedVideo.src); // Nettoyage de la RAM
      }
      importedVideo.src = URL.createObjectURL(file);
      setStatus("Vidéo importée prête", "success");
    }
  });

  playBtn.addEventListener('click', () => { importedVideo.play(); startScroll(); });
  pauseBtn.addEventListener('click', () => { importedVideo.pause(); scrolling = false; });
  
  stopVideoBtn.addEventListener('click', () => {
    importedVideo.pause();
    importedVideo.currentTime = 0;
    resetScroll();
  });
  
  mirrorVideoBtn.addEventListener('click', () => { importedVideo.classList.toggle('mirrored'); });

  // Contrôles Globaux Enregistrement
  recordBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);

  // Sliders de réglages
  speedRange.addEventListener('input', (e) => { scrollSpeed = parseInt(e.target.value); });
  sizeRange.addEventListener('input', (e) => { teleprompterText.style.fontSize = `${e.target.value}px`; });
  applyTextBtn.addEventListener('click', updateTextDisplay);
  
  // Ajustements manuels
  upBtn.addEventListener('click', () => { scrollY -= 50; teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`; });
  downBtn.addEventListener('click', () => { scrollY += 50; teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`; });
}

// Gestion saine des statuts (sans chevauchement)
function setStatus(msg, type) {
  if (statusTimeout) clearTimeout(statusTimeout);
  
  statusMessage.textContent = msg;
  statusMessage.style.display = 'block';
  statusMessage.style.color = type === 'error' ? '#ef4444' : '#10b981';
  
  statusTimeout = setTimeout(() => { statusMessage.style.display = 'none'; }, 4000);
}

window.addEventListener('DOMContentLoaded', init);
