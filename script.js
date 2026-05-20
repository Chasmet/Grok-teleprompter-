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

// ─── État de l'application ──────────────────────────────────────────────────
let activeMode = 'live';
let facingMode = 'user'; // 'user' = caméra avant, 'environment' = arrière
let cameraStream = null;
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
  scrollY = teleprompterContainer.clientHeight / 2; // Commence au milieu
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

  // Plus la vitesse est haute, plus ça monte vite
  scrollY -= scrollSpeed * 15 * delta; 

  // Si le texte est complètement sorti par le haut, on l'arrête
  if (scrollY < -teleprompterText.clientHeight) {
    scrolling = false;
    return;
  }

  teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`;
  animationFrame = requestAnimationFrame(scrollLoop);
}

// ─── Gestion Caméra & Modes ─────────────────────────────────────────────────
async function startCamera() {
  if (cameraStream) stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facingMode },
      audio: true
    });
    cameraPreview.srcObject = cameraStream;
    setStatus("Caméra activée avec succès", "success");
  } catch (err) {
    console.error(err);
    setStatus("Erreur caméra (vérifiez les autorisations HTTPS)", "error");
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    cameraPreview.srcObject = null;
  }
}

// ─── Enregistrement Vidéo ───────────────────────────────────────────────────
function startRecording() {
  if (!cameraStream) {
    setStatus("Activez d'abord la caméra !", "error");
    return;
  }
  
  recordedChunks = [];
  // Essaye le format le plus standard sur mobile
  let options = { mimeType: 'video/webm;codecs=vp9,opus' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/mp4' };
  }

  try {
    mediaRecorder = new MediaRecorder(cameraStream, options);
  } catch (e) {
    mediaRecorder = new MediaRecorder(cameraStream);
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    
    // Configurer le bouton de téléchargement
    downloadLink.href = url;
    downloadLink.download = `teleprompter_${Date.now()}.webm`;
    downloadLink.style.display = 'block';
    downloadLink.removeAttribute('hidden');
    setStatus("Enregistrement sauvegardé ! Cliquez sur le bouton vert en bas.", "success");
  };

  mediaRecorder.start();
  isRecording = true;
  recordBtn.disabled = true;
  stopBtn.disabled = false;
  
  // Lancer le timer et le texte en même temps !
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);
  startScroll(); 
}

function stopRecording() {
  if (!isRecording) return;
  mediaRecorder.stop();
  isRecording = false;
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  clearInterval(timerInterval);
  recordTimer.textContent = "00:00";
  scrolling = false;
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  recordTimer.textContent = `${mins}:${secs}`;
}

// ─── Écouteurs d'Événements ─────────────────────────────────────────────────
function setupEventListeners() {
  // Onglets de Mode
  modeLiveBtn.addEventListener('click', () => {
    activeMode = 'live';
    modeLiveBtn.classList.add('active');
    modeVideoBtn.classList.remove('active');
    livePanel.style.display = 'grid';
    videoPanel.style.display = 'none';
    cameraPreview.style.display = 'block';
    importedVideo.style.display = 'none';
    stopCamera();
  });

  modeVideoBtn.addEventListener('click', () => {
    activeMode = 'video';
    modeVideoBtn.classList.add('active');
    modeLiveBtn.classList.remove('active');
    livePanel.style.display = 'none';
    videoPanel.style.display = 'grid';
    cameraPreview.style.display = 'none';
    importedVideo.style.display = 'block';
    stopCamera();
  });

  // Contrôles Live
  cameraBtn.addEventListener('click', startCamera);
  flipBtn.addEventListener('click', () => {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    if (cameraStream) startCamera();
  });
  mirrorLiveBtn.addEventListener('click', () => {
    cameraPreview.classList.toggle('mirrored');
  });

  // Contrôles Vidéo Importée
  videoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importedVideo.src = URL.createObjectURL(file);
      setStatus("Vidéo importée prête", "success");
    }
  });
  playBtn.addEventListener('click', () => { 
    importedVideo.play(); 
    startScroll();
  });
  pauseBtn.addEventListener('click', () => { 
    importedVideo.pause(); 
    scrolling = false;
  });
  stopVideoBtn.addEventListener('click', () => {
    importedVideo.pause();
    importedVideo.currentTime = 0;
    resetScroll();
  });
  mirrorVideoBtn.addEventListener('click', () => {
    importedVideo.classList.toggle('mirrored');
  });

  // Enregistrement
  recordBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);

  // Réglages Téléprompteur
  speedRange.addEventListener('input', (e) => { scrollSpeed = parseInt(e.target.value); });
  sizeRange.addEventListener('input', (e) => { teleprompterText.style.fontSize = `${e.target.value}px`; });
  applyTextBtn.addEventListener('click', updateTextDisplay);
  
  upBtn.addEventListener('click', () => { scrollY -= 40; teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`; });
  downBtn.addEventListener('click', () => { scrollY += 40; teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`; });
}

function setStatus(msg, type) {
  statusMessage.textContent = msg;
  statusMessage.style.display = 'block';
  statusMessage.style.color = type === 'error' ? '#ef4444' : '#10b981';
  setTimeout(() => { statusMessage.style.display = 'none'; }, 4000);
}

// Lancement
window.addEventListener('DOMContentLoaded', init);
