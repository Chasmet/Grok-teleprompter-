/**
 * GROK TELEPROMPTER — script.js (v3 — fix durée + ratio)
 *
 * ⚠️  OBLIGATOIRE : ajouter dans le HTML, AVANT ce script :
 * <script src="https://cdn.jsdelivr.net/npm/fix-webm-duration@1.0.4/fix-webm-duration.min.js"></script>
 *
 * Fix 1 — Durée WebM : sans cette lib, Android affiche 7s au lieu de 30s.
 * Fix 2 — Ratio vidéo : capture via canvas offscreen aux vraies dimensions.
 */

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

let activeMode        = 'live';
let facingMode        = 'user';
let cameraStream      = null;
let micStream         = null;
let mediaRecorder     = null;
let recordedChunks    = [];
let recordedBlob      = null;
let scrollInterval    = null;
let paused            = false;
let basePosition      = parseInt(localStorage.getItem('textPosition') || '100', 10);
let scrollOffset      = 0;
let recordingStartTime = null;
let recordingTimer    = null;
let recordingStartMs  = null;  // durée réelle pour fix métadonnées
let canvasAnimId      = null;  // draw loop canvas offscreen
let lastDownloadUrl   = null;
let activeVideoUrl    = null;

// ── Format MIME ───────────────────────────────────────────────────────────────
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

// ── Utilitaires ───────────────────────────────────────────────────────────────
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
  recordingIndicator.hidden = false;
  recordingIndicator.style.display = 'inline-flex';
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

function setDownloadReady(ready) {
  if (!downloadBtn) return;
  downloadBtn.disabled = !ready;
  downloadBtn.style.opacity = ready ? '1' : '0.6';
}

// ── Téléprompter ──────────────────────────────────────────────────────────────
function updatePrompterText() {
  const text = scriptInput?.value.trim() || 'Colle ton texte ici.';
  if (prompterText) prompterText.textContent = text;
  if (scriptInput) localStorage.setItem('grok_script', scriptInput.value);
}

function applyTextSize() {
  if (prompterText && sizeInput) prompterText.style.fontSize = `${sizeInput.value}px`;
}

function applyPosition() {
  if (prompterText) prompterText.style.transform = `translateY(${basePosition + scrollOffset}px)`;
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

function togglePause() { paused = !paused; }

function resetPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollOffset = 0;
  applyPosition();
}

// ── Modes ─────────────────────────────────────────────────────────────────────
function switchMode(mode) {
  activeMode = mode;
  const live = mode === 'live';
  if (livePanel) livePanel.hidden = !live;
  if (videoPanel) videoPanel.hidden = live;
  if (cameraPreview) cameraPreview.hidden = !live;
  if (videoPreview) videoPreview.hidden = live;
  if (modeBadge) modeBadge.textContent = live ? 'Mode Live' : 'Mode Vidéo + Voix';
  if (stageTitle) stageTitle.textContent = live ? 'Aperçu caméra' : 'Vidéo importée';
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );
}

function applyFormat() {
  if (!stageContainer || !formatSelect) return;
  stageContainer.classList.remove('format-16-9', 'format-1-1');
  if (formatSelect.value === '16:9') stageContainer.classList.add('format-16-9');
  if (formatSelect.value === '1:1') stageContainer.classList.add('format-1-1');
}

// ── Caméra ────────────────────────────────────────────────────────────────────
async function ensureMic() {
  if (!micStream) micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
  } catch (e) { showMessage('Caméra refusée'); }
}

// ── FIX RATIO : Canvas offscreen aux vraies dimensions ────────────────────────
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

// ── FIX DURÉE : Patch métadonnées WebM ───────────────────────────────────────
function fixAndFinalizeBlob(chunks, mimeType, durationMs, callback) {
  const raw = new Blob(chunks, { type: mimeType });

  // ysFixWebmDuration disponible + format WebM → patch la durée
  if (typeof ysFixWebmDuration === 'function' && !mimeType.startsWith('video/mp4')) {
    ysFixWebmDuration(raw, durationMs, (fixed) => callback(fixed));
  } else {
    // MP4 natif ou lib absente : durée déjà correcte, ou pas de fix possible
    callback(raw);
  }
}

// ── Enregistrement ────────────────────────────────────────────────────────────
async function startRecording() {
  try {
    // Reset complet avant chaque enregistrement
    recordedChunks = [];
    recordedBlob   = null;
    setDownloadReady(false);

    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }

    // Stopper un draw loop canvas précédent
    if (canvasAnimId) {
      cancelAnimationFrame(canvasAnimId);
      canvasAnimId = null;
    }

    let stream;

    if (activeMode === 'live') {
      if (!cameraStream) await startCamera();
      stream = cameraStream;

    } else {
      if (!videoPreview || !videoPreview.src) {
        showMessage('Importe une vidéo');
        return;
      }
      await ensureMic();
      videoPreview.currentTime = 0;

      // Attendre les métadonnées pour avoir videoWidth/videoHeight
      await new Promise((resolve) => {
        if (videoPreview.readyState >= 1) { resolve(); return; }
        videoPreview.addEventListener('loadedmetadata', resolve, { once: true });
      });

      await videoPreview.play();

      // Canvas offscreen = vraies dimensions, pas celles du CSS
      const canvasStream = buildCanvasStream(videoPreview);

      stream = new MediaStream();
      canvasStream.getVideoTracks().forEach(t => stream.addTrack(t));
      micStream.getAudioTracks().forEach(t  => stream.addTrack(t));

      videoPreview.onended = () => stopRecording();
    }

    // Anti-incrustation téléprompter
    const prompter = document.getElementById('prompter');
    const wasVisible = prompter && prompter.style.display !== 'none';
    if (wasVisible) prompter.style.display = 'none';

    const mimeType = getSupportedMimeType();
    const recorderOptions = { videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 };
    if (mimeType) recorderOptions.mimeType = mimeType;

    mediaRecorder = new MediaRecorder(stream, recorderOptions);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      // Stopper le draw loop
      if (canvasAnimId) {
        cancelAnimationFrame(canvasAnimId);
        canvasAnimId = null;
      }

      // Durée capturée AVANT stopRecordingTimer (qui remet à null)
      const durationMs = recordingStartMs ? Date.now() - recordingStartMs : 0;
      recordingStartMs = null;

      if (recordedChunks.length > 0) {
        const finalMime = mimeType || 'video/webm';
        fixAndFinalizeBlob(recordedChunks, finalMime, durationMs, (fixedBlob) => {
          recordedBlob = fixedBlob;
          setDownloadReady(true);
          showMessage('✅ Vidéo prête');
        });
      }

      if (wasVisible && prompter) prompter.style.display = 'flex';
      stopRecordingTimer();
      mediaRecorder = null;
    };

    recordingStartMs = Date.now();  // ← Pour calcul durée réelle
    mediaRecorder.start(1000);
    startRecordingTimer();
    startPrompter();

  } catch (e) {
    showMessage('Erreur enregistrement');
    console.error(e);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

// ── Téléchargement ────────────────────────────────────────────────────────────
function downloadRecording() {
  if (!recordedBlob) {
    showMessage('Aucune vidéo');
    return;
  }

  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
  }

  const ext = getFileExtension(recordedBlob.type);
  lastDownloadUrl = URL.createObjectURL(recordedBlob);

  const a = document.createElement('a');
  a.href = lastDownloadUrl;
  a.download = `grok-video-${Date.now()}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showMessage('✅ Vidéo téléchargée');

  // Nettoyage URL uniquement (pas du blob — startRecording() gère le reset)
  setTimeout(() => {
    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }
  }, 5000);
}

// ── Autres ────────────────────────────────────────────────────────────────────
function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : videoPreview;
  if (target) target.classList.toggle('mirror');
}

function loadVideo(file) {
  if (!file || !videoPreview) return;
  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
  activeVideoUrl = URL.createObjectURL(file);
  videoPreview.src = activeVideoUrl;
  videoPreview.controls = false;
  switchMode('video');
}

// ── Événements ────────────────────────────────────────────────────────────────
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
recordBtn?.addEventListener('click', startRecording);
stopRecordBtn?.addEventListener('click', stopRecording);
pauseBtn?.addEventListener('click', togglePause);
resetBtn?.addEventListener('click', resetPrompter);
mirrorBtn?.addEventListener('click', toggleMirror);
downloadBtn?.addEventListener('click', downloadRecording);

moveUpBtn?.addEventListener('click', () => setBasePosition(basePosition + 50));
moveDownBtn?.addEventListener('click', () => setBasePosition(basePosition - 50));

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

window.onload = () => {
  updatePrompterText();
  applyTextSize();
  applyPosition();
  applyFormat();
  switchMode('live');
  setDownloadReady(false);
};
