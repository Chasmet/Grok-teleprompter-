const $ = (id) => document.getElementById(id);

// Éléments DOM
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
const statusMessage = $('statusMessage');
const speedRange = $('speedRange');
const sizeRange = $('sizeRange');
const scriptInput = $('scriptInput');
const applyTextBtn = $('applyTextBtn');
const upBtn = $('upBtn');
const downBtn = $('downBtn');
const teleprompterText = $('teleprompterText');
const teleprompterContainer = $('teleprompterContainer');
const livePanel = $('livePanel');
const videoPanel = $('videoPanel');

// État global
let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let micStream = null;
let importedVideoFile = null;
let importedVideoUrl = null;
let recorder = null;
let recordedBlob = null;
let recordingStart = null;
let timerInterval = null;
let isRecording = false;
let downloadUrl = null;
let importedVideoRecordingStartTime = 0;
let lastRecordingDuration = 0;
let recordingMode = null;

// Téléprompteur
let scrollY = 0;
let baseOffset = Number(localStorage.getItem('teleprompter_base_offset') || 0);
let scrollSpeed = 3;
let scrolling = false;
let animationFrame = null;
let lastTimestamp = 0;

// FFmpeg
let ffmpeg = null;

function save(key, value) {
  localStorage.setItem(key, String(value));
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

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
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
  }

  downloadUrl = URL.createObjectURL(blob);
  downloadLink.href = downloadUrl;
  downloadLink.download = filename;
  downloadLink.textContent = label;
  downloadLink.hidden = false;
}

function resetDownload() {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }

  downloadLink.removeAttribute('href');
  downloadLink.removeAttribute('download');
  downloadLink.hidden = true;
}

function applyMirror(video) {
  if (video) video.classList.toggle('mirrored');
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach((track) => track.stop());
}

function setRecordingState(recording) {
  isRecording = recording;
  recordBtn.disabled = recording;
  stopBtn.disabled = !recording;
}

function hasRecordRtc() {
  return typeof window.RecordRTC !== 'undefined';
}

function hasFfmpegSupport() {
  return Boolean(
    (window.FFmpegWASM?.FFmpeg || window.FFmpeg?.FFmpeg) &&
    (window.FFmpegUtil?.fetchFile || window.fetchFile)
  );
}

function refreshRecordingAvailability() {
  const needVideoMerge = activeMode === 'video';

  if (!hasRecordRtc()) {
    recordBtn.disabled = true;
    setStatus("Enregistrement indisponible : bibliothèque RecordRTC non chargée.", 'error');
    return;
  }

  if (needVideoMerge && !hasFfmpegSupport()) {
    recordBtn.disabled = true;
    setStatus('Mode vidéo importée indisponible : FFmpeg non chargé.', 'warning');
    return;
  }

  recordBtn.disabled = isRecording;
  if (!isRecording) setStatus('');
}

/**
 * Évite que le texte démarre hors zone (offset mémorisé trop extrême).
 */
function normalizeTeleprompterOffset() {
  const containerHeight = teleprompterContainer?.clientHeight || 0;
  if (!containerHeight) return;

  // on borne l'offset pour rester visible au chargement
  const maxAbs = Math.floor(containerHeight * 0.45);
  if (baseOffset > maxAbs) baseOffset = maxAbs;
  if (baseOffset < -maxAbs) baseOffset = -maxAbs;
  save('teleprompter_base_offset', baseOffset);
}

function setMode(mode) {
  activeMode = mode;
  const isLive = mode === 'live';

  modeLiveBtn.classList.toggle('active', isLive);
  modeVideoBtn.classList.toggle('active', !isLive);

  cameraPreview.hidden = !isLive;
  importedVideo.hidden = isLive;

  livePanel.hidden = !isLive;
  videoPanel.hidden = isLive;

  if (!isLive) {
    stopStream(cameraStream);
    cameraStream = null;
    cameraPreview.srcObject = null;
  }

  refreshRecordingAvailability();
}

async function startCamera() {
  try {
    stopStream(cameraStream);

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
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
    alert("Impossible d'accéder à la caméra.");
  }
}

function flipCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
}

function openVideoPicker() {
  setMode('video');
  videoInput.click();
}

function loadVideo(file) {
  if (!file) return;

  importedVideoFile = file;

  if (importedVideoUrl) URL.revokeObjectURL(importedVideoUrl);

  importedVideoUrl = URL.createObjectURL(file);

  setMode('video');
  importedVideo.src = importedVideoUrl;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.load();
}

async function getMicrophoneStream() {
  if (micStream && micStream.active) return micStream;

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false
  });

  return micStream;
}

function updateTeleprompterText() {
  const raw = scriptInput.value || '';
  const text = raw.trim() || 'Colle ton texte ici...';

  teleprompterText.textContent = text;
  teleprompterText.style.fontSize = `${sizeRange.value}px`;

  const containerHeight = teleprompterContainer?.clientHeight || 300;
  const y = containerHeight * 0.2 + baseOffset - scrollY;
  teleprompterText.style.transform = `translateX(-50%) translateY(${y}px)`;

  save('teleprompter_script', raw);
}

function animateTeleprompter(timestamp) {
  if (!scrolling) return;

  if (!lastTimestamp) lastTimestamp = timestamp;
  const delta = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  scrollY += (scrollSpeed * delta) / 30;
  updateTeleprompterText();

  animationFrame = requestAnimationFrame(animateTeleprompter);
}

function startScroll() {
  if (scrolling) return;

  scrolling = true;
  lastTimestamp = 0;
  scrollSpeed = Number(speedRange.value);
  animationFrame = requestAnimationFrame(animateTeleprompter);
}

function stopScroll() {
  scrolling = false;

  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  lastTimestamp = 0;
}

function toggleScroll() {
  if (scrolling) stopScroll();
  else startScroll();
}

function moveText(delta) {
  baseOffset += delta;
  save('teleprompter_base_offset', baseOffset);
  updateTeleprompterText();
}

function startTimer() {
  recordingStart = Date.now();
  recordTimer.textContent = '00:00';

  timerInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - recordingStart) / 1000);
    recordTimer.textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

async function startRecording() {
  if (isRecording) return;

  if (!hasRecordRtc()) {
    setStatus("La bibliothèque d'enregistrement n'est pas disponible. Vérifie ta connexion puis recharge la page.", 'error');
    alert("La bibliothèque d'enregistrement n'est pas disponible. Vérifie ta connexion puis recharge la page.");
    return;
  }

  if (activeMode === 'video' && !hasFfmpegSupport()) {
    setStatus('Mode vidéo importée indisponible : FFmpeg non chargé.', 'warning');
    alert("FFmpeg est requis pour fusionner la vidéo importée et l'audio.");
    return;
  }

  try {
    resetDownload();
    recordedBlob = null;
    lastRecordingDuration = 0;
    recordingMode = activeMode;

    if (recordingMode === 'live') {
      if (!cameraStream) await startCamera();
      if (!cameraStream) throw new Error('Flux caméra indisponible.');

      recorder = new window.RecordRTC(cameraStream, {
        type: 'video',
        mimeType: 'video/webm'
      });
    } else {
      if (!importedVideoFile) {
        recordingMode = null;
        alert("Importe une vidéo avant de lancer l'enregistrement.");
        return;
      }

      const mic = await getMicrophoneStream();
      importedVideoRecordingStartTime = importedVideo.currentTime || 0;

      if (importedVideo.paused) {
        await importedVideo.play().catch(() => {});
      }

      recorder = new window.RecordRTC(mic, {
        type: 'audio',
        mimeType: 'audio/webm'
      });
    }

    recorder.startRecording();
    setRecordingState(true);
    startTimer();
  } catch (error) {
    console.error(error);
    setRecordingState(false);
    recordingMode = null;
    alert("Impossible de démarrer l'enregistrement.");
  }
}

async function ensureFFmpeg() {
  if (ffmpeg) return ffmpeg;

  const FFmpegClass = window.FFmpegWASM?.FFmpeg || window.FFmpeg?.FFmpeg;
  const fetchFile = window.FFmpegUtil?.fetchFile || window.fetchFile;

  if (!FFmpegClass || !fetchFile) {
    throw new Error('FFmpeg.wasm non disponible.');
  }

  ffmpeg = new FFmpegClass();
  await ffmpeg.load();
  ffmpeg._fetchFile = fetchFile;
  return ffmpeg;
}

async function cleanupFfmpegFiles(ff, files) {
  for (const file of files) {
    try {
      await ff.deleteFile(file);
    } catch (_) {}
  }
}

async function mergeVideoAndAudio(videoFile, audioBlob, startTime = 0, duration = 0) {
  const ff = await ensureFFmpeg();
  const fetchFile = ff._fetchFile;

  const videoName = 'input-video.bin';
  const audioName = 'input-audio.webm';
  const outputName = 'output.mp4';

  await ff.writeFile(videoName, await fetchFile(videoFile));
  await ff.writeFile(audioName, await fetchFile(audioBlob));

  const common = [];
  if (startTime > 0) common.push('-ss', String(startTime));
  if (duration > 0) common.push('-t', String(duration));

  // 1) tentative rapide : copy vidéo + AAC audio
  const fastArgs = [
    ...common,
    '-i', videoName,
    '-i', audioName,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    '-shortest',
    outputName
  ];

  try {
    await ff.exec(fastArgs);
  } catch (e1) {
    // 2) fallback robuste : transcodage vidéo H264 + AAC
    try {
      await cleanupFfmpegFiles(ff, [outputName]);
      const safeArgs = [
        ...common,
        '-i', videoName,
        '-i', audioName,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-shortest',
        outputName
      ];
      await ff.exec(safeArgs);
    } catch (e2) {
      console.error('FFmpeg fast path error:', e1);
      console.error('FFmpeg fallback error:', e2);
      throw new Error('Fusion FFmpeg impossible (codec/format non supporté).');
    }
  }

  const data = await ff.readFile(outputName);
  const result = new Blob([data.buffer], { type: 'video/mp4' });

  await cleanupFfmpegFiles(ff, [videoName, audioName, outputName]);
  return result;
}

async function stopRecording() {
  if (!recorder || !isRecording) return;

  lastRecordingDuration = recordingStart ? (Date.now() - recordingStart) / 1000 : 0;
  stopTimer();
  setRecordingState(false);

  recorder.stopRecording(async () => {
    try {
      recordedBlob = recorder.getBlob();

      if (recordingMode === 'video' && importedVideoFile) {
        importedVideo.pause();
        setStatus('Fusion vidéo/audio en cours...', 'info');

        const finalBlob = await mergeVideoAndAudio(
          importedVideoFile,
          recordedBlob,
          importedVideoRecordingStartTime,
          lastRecordingDuration
        );

        setDownload(
          finalBlob,
          `teleprompter-final-${Date.now()}.mp4`,
          'Télécharger la vidéo finale'
        );
        setStatus('Fusion terminée. Téléchargement prêt.', 'success');
      } else {
        setDownload(
          recordedBlob,
          `teleprompter-live-${Date.now()}.webm`,
          'Télécharger la vidéo'
        );
        setStatus('Enregistrement terminé. Téléchargement prêt.', 'success');
      }
    } catch (error) {
      console.error(error);
      setStatus(`Erreur fusion: ${error.message || 'inconnue'}`, 'error');
      alert(`Erreur pendant la fusion vidéo/audio.\nDétail: ${error.message || 'inconnu'}`);
      resetDownload();
    } finally {
      if (recordingMode === 'video') {
        stopStream(micStream);
        micStream = null;
      }

      recorder = null;
      recordingMode = null;
    }
  });
}

// Events
modeLiveBtn.addEventListener('click', startCamera);
modeVideoBtn.addEventListener('click', openVideoPicker);
cameraBtn.addEventListener('click', startCamera);
flipBtn.addEventListener('click', flipCamera);
mirrorLiveBtn.addEventListener('click', () => applyMirror(cameraPreview));
mirrorVideoBtn.addEventListener('click', () => applyMirror(importedVideo));
videoInput.addEventListener('change', (e) => loadVideo(e.target.files[0]));
playBtn.addEventListener('click', () => importedVideo.play());
pauseBtn.addEventListener('click', () => importedVideo.pause());
stopVideoBtn.addEventListener('click', () => {
  importedVideo.pause();
  importedVideo.currentTime = 0;
});
recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
applyTextBtn.addEventListener('click', toggleScroll);
upBtn.addEventListener('click', () => moveText(-20));
downBtn.addEventListener('click', () => moveText(20));
scriptInput.addEventListener('input', updateTeleprompterText);
sizeRange.addEventListener('input', updateTeleprompterText);
speedRange.addEventListener('input', () => {
  scrollSpeed = Number(speedRange.value);
});

window.addEventListener('resize', () => {
  normalizeTeleprompterOffset();
  updateTeleprompterText();
});

(function init() {
  scriptInput.value = localStorage.getItem('teleprompter_script') || scriptInput.value;

  resetDownload();
  setRecordingState(false);

  scrollY = 0;
  scrolling = false;
  stopScroll();

  setMode('live');

  // Double passe pour corriger les dimensions non stables au tout début mobile
  requestAnimationFrame(() => {
    normalizeTeleprompterOffset();
    updateTeleprompterText();
  });
  setTimeout(() => {
    normalizeTeleprompterOffset();
    updateTeleprompterText();
  }, 120);

  refreshRecordingAvailability();

  window.addEventListener('beforeunload', () => {
    stopStream(cameraStream);
    stopStream(micStream);

    if (importedVideoUrl) {
      URL.revokeObjectURL(importedVideoUrl);
      importedVideoUrl = null;
    }

    resetDownload();
  });
})();
