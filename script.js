const $ = (id) => document.getElementById(id);

// ===== ÉLÉMENTS DOM =====
const modeBadge = $('modeBadge');
const stageTitle = $('stageTitle');
const stageContainer = $('stageContainer');
const cameraPreview = $('cameraPreview');
const videoPreview = $('videoPreview');
const exportVideo = $('exportVideo'); // vidéo cachée pour l'export propre
const livePanel = $('livePanel');
const videoPanel = $('videoPanel');
const qualitySelect = $('qualitySelect');
const formatSelect = $('formatSelect');
const cameraBtn = $('cameraBtn');
const flipCameraBtn = $('flipCameraBtn');
const videoInput = $('videoInput');
const scriptInput = $('scriptInput');
const prompter = $('prompter');
const prompterText = $('prompterText');
const speedInput = $('speed');
const sizeInput = $('size');
const positionSlider = $('positionSlider');
const recordBtn = $('recordBtn');
const stopRecordBtn = $('stopRecordBtn');
const downloadBtn = $('downloadBtn');
const startBtn = $('startBtn');
const pauseBtn = $('pauseBtn');
const resetBtn = $('resetBtn');
const mirrorBtn = $('mirrorBtn');
const moveUpBtn = $('moveUpBtn');
const moveDownBtn = $('moveDownBtn');
const recordingIndicator = $('recordingIndicator');

// ===== VARIABLES =====
let activeMode = 'live';
let facingMode = 'user';

let cameraStream = null;
let micStream = null;
let mediaRecorder = null;

let recordedChunks = [];
let recordedBlob = null;
let lastDownloadUrl = null;
let activeVideoUrl = null;

let scrollInterval = null;
let paused = false;
let basePosition = parseInt(localStorage.getItem('textPosition') || '100', 10);
let scrollOffset = 0;

let recordingStartTime = null;
let recordingTimer = null;
let canvasAnimId = null;

// ===== OUTILS =====
function getSupportedMimeType() {
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  for (const mime of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }

  return 'video/webm';
}

function getFileExtension(mimeType) {
  return mimeType && mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
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
  recordingIndicator.textContent =
    `● REC ${formatDuration(Date.now() - recordingStartTime)}`;
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

function setRecordingState(isRecording) {
  if (recordBtn) recordBtn.disabled = isRecording;
  if (stopRecordBtn) stopRecordBtn.disabled = !isRecording;
}

// ===== TÉLÉPROMPTEUR =====
function updatePrompterText() {
  const text = scriptInput?.value.trim() || 'Colle ton texte ici.';
  if (prompterText) prompterText.textContent = text;
  if (scriptInput) localStorage.setItem('grok_script', scriptInput.value);
}

function applyTextSize() {
  if (prompterText && sizeInput) {
    prompterText.style.fontSize = `${sizeInput.value}px`;
  }
}

function applyPosition() {
  if (prompterText) {
    prompterText.style.transform =
      `translateY(${basePosition + scrollOffset}px)`;
  }
}

function setBasePosition(value) {
  basePosition = parseInt(value, 10) || 0;
  localStorage.setItem('textPosition', String(basePosition));

  if (positionSlider) {
    positionSlider.value = basePosition;
  }

  applyPosition();
}

function applyFormat() {
  if (!stageContainer || !formatSelect) return;

  stageContainer.classList.remove(
    'format-16-9',
    'format-1-1',
    'format-9-16'
  );

  if (formatSelect.value === '1:1') {
    stageContainer.classList.add('format-1-1');
  } else if (formatSelect.value === '9:16') {
    stageContainer.classList.add('format-9-16');
  } else {
    stageContainer.classList.add('format-16-9');
  }
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
}

function resetPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollOffset = 0;
  applyPosition();
}

// ===== MODES =====
function switchMode(mode) {
  activeMode = mode;
  const live = mode === 'live';

  if (livePanel) livePanel.hidden = !live;
  if (videoPanel) videoPanel.hidden = live;

  if (cameraPreview) {
    cameraPreview.hidden = !live;
    cameraPreview.style.display = live ? 'block' : 'none';
  }

  if (videoPreview) {
    videoPreview.hidden = live;
    videoPreview.style.display = live ? 'none' : 'block';
    videoPreview.style.visibility = live ? 'hidden' : 'visible';
    videoPreview.style.opacity = live ? '0' : '1';
    videoPreview.style.background = '#000';
  }

  // Toujours cachée
  if (exportVideo) {
    exportVideo.hidden = true;
    exportVideo.style.display = 'none';
  }

  if (modeBadge) {
    modeBadge.textContent = live
      ? 'Mode Live'
      : 'Mode Vidéo + Voix';
  }

  if (stageTitle) {
    stageTitle.textContent = live
      ? 'Aperçu caméra'
      : 'Vidéo importée';
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle(
      'active',
      btn.dataset.mode === mode
    );
  });
}

// ===== CAMÉRA =====
async function startCamera() {
  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }

    const height = Number(qualitySelect?.value || 1080);

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        height: { ideal: height }
      },
      audio: true
    });

    if (cameraPreview) {
      cameraPreview.srcObject = cameraStream;
      await cameraPreview.play().catch(() => {});
    }

    switchMode('live');
  } catch (error) {
    console.error(error);
    showMessage('Caméra refusée');
  }
}

// ===== MICRO =====
async function ensureMic() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });
  }
}

// ===== CANVAS EXPORT =====
function buildCanvasStream(videoEl) {
  const width = videoEl.videoWidth || 1080;
  const height = videoEl.videoHeight || 1920;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  function drawLoop() {
    if (!videoEl.paused && !videoEl.ended) {
      ctx.drawImage(videoEl, 0, 0, width, height);
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

// ===== IMPORT VIDÉO =====
function loadVideo(file) {
  if (!file || !videoPreview || !exportVideo) return;

  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
  }

  activeVideoUrl = URL.createObjectURL(file);

  // Prévisualisation visible
  videoPreview.src = activeVideoUrl;
  videoPreview.muted = true;
  videoPreview.preload = 'auto';
  videoPreview.playsInline = true;

  // Vidéo cachée pour export
  exportVideo.src = activeVideoUrl;
  exportVideo.muted = true;
  exportVideo.preload = 'auto';
  exportVideo.playsInline = true;

  if (videoInput) {
    videoInput.value = '';
  }

  switchMode('video');
  showMessage('Vidéo importée');

  const startPreview = async () => {
    try {
      await videoPreview.play();

      setTimeout(() => {
        videoPreview.pause();
        videoPreview.currentTime = 0.1;
      }, 300);
    } catch (e) {
      console.log('Prévisualisation bloquée', e);
    }
  };

  videoPreview.addEventListener(
    'loadeddata',
    startPreview,
    { once: true }
  );

  videoPreview.load();
  exportVideo.load();
}

// ===== ENREGISTREMENT =====
async function startRecording() {
  try {
    stopCanvasLoop();

    recordedChunks = [];
    recordedBlob = null;
    setDownloadReady(false);

    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }

    let stream;

    if (activeMode === 'live') {
      if (!cameraStream) {
        await startCamera();
      }

      if (!cameraStream) return;

      stream = cameraStream;
    } else {
      if (!videoPreview?.src || !exportVideo) {
        showMessage('Importe une vidéo');
        return;
      }

      await ensureMic();

      exportVideo.currentTime = 0;
      await exportVideo.play();

      const canvasStream =
        buildCanvasStream(exportVideo);

      stream = new MediaStream();

      canvasStream
        .getVideoTracks()
        .forEach((track) => stream.addTrack(track));

      micStream
        .getAudioTracks()
        .forEach((track) => stream.addTrack(track));

      exportVideo.onended = () => stopRecording();
    }

    // Cache le prompter pendant l'export
    const wasVisible =
      prompter &&
      getComputedStyle(prompter).display !== 'none';

    if (wasVisible && prompter) {
      prompter.style.display = 'none';
    }

    const mimeType = getSupportedMimeType();

    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 6000000,
      audioBitsPerSecond: 128000
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      stopCanvasLoop();

      if (recordedChunks.length > 0) {
        recordedBlob = new Blob(recordedChunks, {
          type: mimeType
        });

        setDownloadReady(true);
        showMessage('Vidéo prête');
      }

      if (wasVisible && prompter) {
        prompter.style.display = '';
      }

      if (
        activeMode !== 'live' &&
        exportVideo &&
        !exportVideo.paused
      ) {
        exportVideo.pause();
      }

      stopRecordingTimer();
      setRecordingState(false);
      mediaRecorder = null;
    };

    mediaRecorder.start(1000);

    startRecordingTimer();
    setRecordingState(true);
    startPrompter();
  } catch (error) {
    console.error(error);
    showMessage('Erreur enregistrement');
    stopCanvasLoop();
    setRecordingState(false);
  }
}

function stopRecording() {
  if (
    mediaRecorder &&
    mediaRecorder.state !== 'inactive'
  ) {
    mediaRecorder.stop();
  }
}

// ===== TÉLÉCHARGEMENT =====
function downloadRecording() {
  if (!recordedBlob) {
    showMessage('Aucune vidéo');
    return;
  }

  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
  }

  lastDownloadUrl = URL.createObjectURL(recordedBlob);

  const extension = getFileExtension(
    recordedBlob.type
  );

  const a = document.createElement('a');
  a.href = lastDownloadUrl;
  a.download =
    `grok-video-${Date.now()}.${extension}`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showMessage('Téléchargement lancé');
}

// ===== OUTILS =====
function toggleMirror() {
  const target =
    activeMode === 'live'
      ? cameraPreview
      : videoPreview;

  if (target) {
    target.classList.toggle('mirror');
  }
}

// ===== ÉVÉNEMENTS =====
cameraBtn?.addEventListener('click', startCamera);

flipCameraBtn?.addEventListener('click', () => {
  facingMode =
    facingMode === 'user'
      ? 'environment'
      : 'user';

  startCamera();
});

videoInput?.addEventListener('click', () => {
  if (videoInput) {
    videoInput.value = '';
  }
});

videoInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) loadVideo(file);
});

videoInput?.addEventListener('input', (e) => {
  const file = e.target.files?.[0];
  if (file) loadVideo(file);
});

qualitySelect?.addEventListener('change', () => {
  if (cameraStream) startCamera();
});

formatSelect?.addEventListener('change', applyFormat);

if (scriptInput) {
  scriptInput.value =
    localStorage.getItem('grok_script') || '';

  scriptInput.addEventListener(
    'input',
    updatePrompterText
  );
}

sizeInput?.addEventListener('input', applyTextSize);

positionSlider?.addEventListener('input', (e) => {
  setBasePosition(e.target.value);
});

startBtn?.addEventListener('click', startPrompter);
recordBtn?.addEventListener('click', startRecording);
stopRecordBtn?.addEventListener('click', stopRecording);
pauseBtn?.addEventListener('click', togglePause);
resetBtn?.addEventListener('click', resetPrompter);
mirrorBtn?.addEventListener('click', toggleMirror);
downloadBtn?.addEventListener(
  'click',
  downloadRecording
);

moveUpBtn?.addEventListener('click', () => {
  setBasePosition(basePosition + 50);
});

moveDownBtn?.addEventListener('click', () => {
  setBasePosition(basePosition - 50);
});

document
  .querySelectorAll('.tab-btn')
  .forEach((btn) => {
    btn.addEventListener('click', () => {
      switchMode(btn.dataset.mode);
    });
  });

// ===== INITIALISATION =====
window.onload = () => {
  updatePrompterText();
  applyTextSize();
  applyPosition();
  applyFormat();

  switchMode('live');

  setDownloadReady(false);
  setRecordingState(false);
  stopRecordingTimer();
};
