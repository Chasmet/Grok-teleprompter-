/**
 * GROK TELEPROMPTER STUDIO — script.js v3
 * ─────────────────────────────────────────
 * Corrections appliquées :
 *  1. Template literals cassés → corrigés
 *  2. ID #prompter manquant dans HTML → corrigé (HTML aligné)
 *  3. Ratio vidéo : captureStream CSS → canvas offscreen aux vraies dimensions
 *  4. Durée WebM : ysFixWebmDuration patch les métadonnées (lib CDN dans HTML)
 *  5. Race condition téléchargement multiple → supprimé setTimeout sur blob
 *  6. Memory leak draw loop canvas → cancelAnimationFrame propre
 *  7. Cleanup streams à chaque enregistrement
 *  8. Bouton REC désactivé pendant l'enregistrement, STOP activé
 *  9. Gestion d'erreur améliorée
 */

// ── Raccourci DOM ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const modeBadge          = $('modeBadge');
const stageTitle         = $('stageTitle');
const stageContainer     = $('stageContainer');
const cameraPreview      = $('cameraPreview');
const videoPreview       = $('videoPreview');
const livePanel          = $('livePanel');
const videoPanel         = $('videoPanel');
const qualitySelect      = $('qualitySelect');
const formatSelect       = $('formatSelect');
const cameraBtn          = $('cameraBtn');
const flipCameraBtn      = $('flipCameraBtn');
const videoInput         = $('videoInput');
const scriptInput        = $('scriptInput');
const prompterText       = $('prompterText');
const speedInput         = $('speed');
const sizeInput          = $('size');
const positionSlider     = $('positionSlider');
const recordBtn          = $('recordBtn');
const stopRecordBtn      = $('stopRecordBtn');
const downloadBtn        = $('downloadBtn');
const startBtn           = $('startBtn');
const pauseBtn           = $('pauseBtn');
const resetBtn           = $('resetBtn');
const mirrorBtn          = $('mirrorBtn');
const moveUpBtn          = $('moveUpBtn');
const moveDownBtn        = $('moveDownBtn');
const recordingIndicator = $('recordingIndicator');

// ── État global ────────────────────────────────────────────────────────────
let activeMode         = 'live';
let facingMode         = 'user';
let cameraStream       = null;
let micStream          = null;
let mediaRecorder      = null;
let recordedChunks     = [];
let recordedBlob       = null;
let scrollInterval     = null;
let paused             = false;
let basePosition       = parseInt(localStorage.getItem('textPosition') || '100', 10);
let scrollOffset       = 0;
let recordingStartTime = null;   // Pour le timer d'affichage
let recordingTimer     = null;
let recordingStartMs   = null;   // Pour le calcul durée réelle (fix métadonnées)
let canvasAnimId       = null;   // Draw loop canvas offscreen
let lastDownloadUrl    = null;
let activeVideoUrl     = null;

// ══════════════════════════════════════════════════════════════════════════
// FORMAT MIME
// ══════════════════════════════════════════════════════════════════════════

/**
 * Retourne le meilleur format vidéo supporté par le navigateur.
 * Priorité : MP4 natif (Galerie Android OK) → WebM VP9 → WebM VP8.
 */
function getSupportedMimeType() {
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function getFileExtension(mimeType) {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

// ══════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════════════════════════════════

/** FIX : template literal corrigé (était cassé → \( ... \)) */
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
  if (recordingIndicator) {
    recordingIndicator.hidden = false;
    recordingIndicator.style.display = 'inline-flex';
  }
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

/** Active ou désactive le bouton Télécharger */
function setDownloadReady(ready) {
  if (!downloadBtn) return;
  downloadBtn.disabled = !ready;
}

/** Passe les boutons en état "en cours d'enregistrement" */
function setRecordingState(isRecording) {
  if (recordBtn) {
    recordBtn.disabled = isRecording;
    recordBtn.classList.toggle('is-recording', isRecording);
  }
  if (stopRecordBtn) stopRecordBtn.disabled = !isRecording;
}

// ══════════════════════════════════════════════════════════════════════════
// TÉLÉPROMPTER
// ══════════════════════════════════════════════════════════════════════════

function updatePrompterText() {
  const text = scriptInput?.value.trim() || 'Colle ton texte ici.';
  if (prompterText) prompterText.textContent = text;
  if (scriptInput) localStorage.setItem('grok_script', scriptInput.value);
}

function applyTextSize() {
  if (prompterText && sizeInput) prompterText.style.fontSize = `${sizeInput.value}px`;
}

function applyPosition() {
  if (prompterText) {
    prompterText.style.transform = `translateY(${basePosition + scrollOffset}px)`;
  }
}

function setBasePosition(value) {
  basePosition = parseInt(value, 10) || 0;
  localStorage.setItem('textPosition', String(basePosition));
  if (positionSlider) positionSlider.value = basePosition;
  applyPosition();
}

function startPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollInterval = setInterval(() => {
    if (paused) return;
    scrollOffset -= Number(speedInput?.value || 1.8) * 2;
    applyPosition();
  }, 33);
}

function togglePause() {
  paused = !paused;
  if (pauseBtn) pauseBtn.textContent = paused ? '▶ Reprendre' : '⏸ Pause';
}

function resetPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollOffset = 0;
  applyPosition();
  if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
}

// ══════════════════════════════════════════════════════════════════════════
// MODES
// ══════════════════════════════════════════════════════════════════════════

function switchMode(mode) {
  activeMode = mode;
  const live = mode === 'live';

  if (livePanel)    livePanel.hidden  = !live;
  if (videoPanel)   videoPanel.hidden = live;
  if (cameraPreview) cameraPreview.hidden = !live;
  if (videoPreview)  videoPreview.hidden  = live;

  if (modeBadge)  modeBadge.textContent  = live ? 'Mode Live' : 'Mode Vidéo + Voix';
  if (stageTitle) stageTitle.textContent = live ? 'Aperçu caméra' : 'Vidéo importée';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function applyFormat() {
  if (!stageContainer || !formatSelect) return;
  stageContainer.classList.remove('format-16-9', 'format-1-1');
  if (formatSelect.value === '16:9') stageContainer.classList.add('format-16-9');
  if (formatSelect.value === '1:1')  stageContainer.classList.add('format-1-1');
}

// ══════════════════════════════════════════════════════════════════════════
// CAMÉRA
// ══════════════════════════════════════════════════════════════════════════

async function ensureMic() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

async function startCamera() {
  try {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());

    const height = Number(qualitySelect?.value || 1080);
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, height: { ideal: height } },
      audio: true
    });

    if (cameraPreview) cameraPreview.srcObject = cameraStream;
    switchMode('live');
  } catch (e) {
    console.error('startCamera:', e);
    showMessage('Caméra refusée');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FIX RATIO : CANVAS OFFSCREEN
// Capture la vidéo aux VRAIES dimensions (videoWidth × videoHeight)
// et non aux dimensions CSS affichées → ratio correct dans le fichier final.
// ══════════════════════════════════════════════════════════════════════════

function buildCanvasStream(videoEl) {
  const w = videoEl.videoWidth  || 1080;
  const h = videoEl.videoHeight || 1920;

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  function drawLoop() {
    if (!videoEl.paused && !videoEl.ended) {
      ctx.drawImage(videoEl, 0, 0, w, h);
    }
    canvasAnimId = requestAnimationFrame(drawLoop);
  }
  drawLoop();

  return canvas.captureStream(30);
}

function stopCanvasLoop() {
  if (canvasAnimId !== null) {
    cancelAnimationFrame(canvasAnimId);
    canvasAnimId = null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FIX DURÉE : PATCH MÉTADONNÉES WEBM
// ysFixWebmDuration (chargé via CDN dans index.html) réinjecte la durée
// dans le header du fichier → Android affiche 30s au lieu de 7s.
// ══════════════════════════════════════════════════════════════════════════

function fixAndFinalizeBlob(chunks, mimeType, durationMs, callback) {
  const raw = new Blob(chunks, { type: mimeType });

  if (
    typeof ysFixWebmDuration === 'function' &&
    !mimeType.startsWith('video/mp4') &&
    durationMs > 0
  ) {
    // WebM → patch durée
    ysFixWebmDuration(raw, durationMs, (fixed) => callback(fixed));
  } else {
    // MP4 natif ou lib absente → pas de patch nécessaire
    callback(raw);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ENREGISTREMENT
// ══════════════════════════════════════════════════════════════════════════

async function startRecording() {
  try {
    // ── Reset complet avant chaque enregistrement ──
    stopCanvasLoop();
    recordedChunks = [];
    recordedBlob   = null;
    recordingStartMs = null;
    setDownloadReady(false);

    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }

    let stream;

    if (activeMode === 'live') {
      // ── Mode Live ──────────────────────────────
      if (!cameraStream) await startCamera();
      if (!cameraStream) return; // echec caméra
      stream = cameraStream;

    } else {
      // ── Mode Vidéo importée ────────────────────
      if (!videoPreview || !videoPreview.src) {
        showMessage('Importe une vidéo');
        return;
      }

      await ensureMic();
      videoPreview.currentTime = 0;

      // Attendre les métadonnées pour avoir videoWidth / videoHeight
      if (videoPreview.readyState < 1) {
        await new Promise((resolve, reject) => {
          const onMeta = () => { cleanup(); resolve(); };
          const onErr  = () => { cleanup(); reject(new Error('loadedmetadata failed')); };
          const cleanup = () => {
            videoPreview.removeEventListener('loadedmetadata', onMeta);
            videoPreview.removeEventListener('error', onErr);
          };
          videoPreview.addEventListener('loadedmetadata', onMeta, { once: true });
          videoPreview.addEventListener('error', onErr, { once: true });
        });
      }

      await videoPreview.play();

      // Canvas offscreen → vraies dimensions, pas les dimensions CSS
      const canvasStream = buildCanvasStream(videoPreview);

      stream = new MediaStream();
      canvasStream.getVideoTracks().forEach(t => stream.addTrack(t));
      micStream.getAudioTracks().forEach(t   => stream.addTrack(t));

      // Stopper dès la fin de la vidéo
      videoPreview.onended = () => stopRecording();
    }

    // ── Fix anti-incrustation téléprompter ──────
    // FIX : l'ID dans le HTML était "prompterOverlay" → renommé "prompter"
    const prompter   = $('prompter');
    const wasVisible = prompter && getComputedStyle(prompter).display !== 'none';
    if (wasVisible && prompter) prompter.style.display = 'none';

    // ── MediaRecorder ───────────────────────────
    const mimeType = getSupportedMimeType();
    const options  = { videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 };
    if (mimeType) options.mimeType = mimeType;

    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stopCanvasLoop();

      // Durée réelle capturée AVANT stopRecordingTimer (qui remet à null)
      const durationMs = recordingStartMs ? Date.now() - recordingStartMs : 0;
      recordingStartMs = null;

      if (recordedChunks.length > 0) {
        const finalMime = mimeType || 'video/webm';
        fixAndFinalizeBlob(recordedChunks, finalMime, durationMs, (fixedBlob) => {
          recordedBlob = fixedBlob;
          setDownloadReady(true);
          showMessage('✅ Vidéo prête — appuie sur Télécharger');
        });
      } else {
        showMessage('⚠️ Aucune donnée enregistrée');
      }

      // Restaurer le téléprompter
      if (wasVisible && prompter) prompter.style.display = '';

      stopRecordingTimer();
      setRecordingState(false);
      mediaRecorder = null;
    };

    // ── Démarrage ───────────────────────────────
    recordingStartMs = Date.now();
    mediaRecorder.start(1000);
    startRecordingTimer();
    setRecordingState(true);
    startPrompter();

  } catch (e) {
    console.error('startRecording:', e);
    showMessage('❌ Erreur : ' + e.message);
    setRecordingState(false);
    stopCanvasLoop();
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  // Stopper la vidéo importée si en cours
  if (activeMode !== 'live' && videoPreview && !videoPreview.paused) {
    videoPreview.pause();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// TÉLÉCHARGEMENT
// FIX race condition : PLUS de setTimeout qui efface le blob.
// Le reset se fait uniquement dans startRecording().
// ══════════════════════════════════════════════════════════════════════════

function downloadRecording() {
  if (!recordedBlob) {
    showMessage('Aucune vidéo à télécharger');
    return;
  }

  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
  }

  const ext = getFileExtension(recordedBlob.type);
  lastDownloadUrl = URL.createObjectURL(recordedBlob);

  const a = document.createElement('a');
  a.href     = lastDownloadUrl;
  // FIX : template literal corrigé (était cassé → \( {Date.now()}. \){ext})
  a.download = `grok-video-${Date.now()}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showMessage('✅ Téléchargement lancé');

  // Révoquer l'URL proprement après téléchargement
  // ⚠️ PAS de reset du blob ici → startRecording() s'en charge
  setTimeout(() => {
    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }
  }, 5000);
}

// ══════════════════════════════════════════════════════════════════════════
// AUTRES
// ══════════════════════════════════════════════════════════════════════════

function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : videoPreview;
  if (target) target.classList.toggle('mirror');
}

function loadVideo(file) {
  if (!file || !videoPreview) return;
  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
  activeVideoUrl    = URL.createObjectURL(file);
  videoPreview.src  = activeVideoUrl;
  videoPreview.load();
  switchMode('video');
}

// ══════════════════════════════════════════════════════════════════════════
// ÉVÉNEMENTS
// ══════════════════════════════════════════════════════════════════════════

cameraBtn?.addEventListener('click', startCamera);

flipCameraBtn?.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
});

videoInput?.addEventListener('change', (e) => loadVideo(e.target.files[0]));
qualitySelect?.addEventListener('change', () => { if (cameraStream) startCamera(); });
formatSelect?.addEventListener('change', applyFormat);

if (scriptInput) {
  scriptInput.value = localStorage.getItem('grok_script') || '';
  scriptInput.addEventListener('input', updatePrompterText);
}

sizeInput?.addEventListener('input', applyTextSize);
positionSlider?.addEventListener('input', (e) => setBasePosition(e.target.value));

startBtn?.addEventListener('click', startPrompter);
pauseBtn?.addEventListener('click', togglePause);
resetBtn?.addEventListener('click', resetPrompter);

recordBtn?.addEventListener('click', startRecording);
stopRecordBtn?.addEventListener('click', stopRecording);
downloadBtn?.addEventListener('click', downloadRecording);
mirrorBtn?.addEventListener('click', toggleMirror);

moveUpBtn?.addEventListener('click',   () => setBasePosition(basePosition + 50));
moveDownBtn?.addEventListener('click', () => setBasePosition(basePosition - 50));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

window.onload = () => {
  updatePrompterText();
  applyTextSize();
  applyPosition();
  applyFormat();
  switchMode('live');
  setDownloadReady(false);
  setRecordingState(false);
};
