const $ = (id) => document.getElementById(id);

const modeBadge = $('modeBadge');
const stageTitle = $('stageTitle');
const stageContainer = $('stageContainer');
const cameraPreview = $('cameraPreview');
const videoPreview = $('videoPreview');
const livePanel = $('livePanel');
const videoPanel = $('videoPanel');
const qualitySelect = $('qualitySelect');
const formatSelect = $('formatSelect');
const cameraBtn = $('cameraBtn');
const flipCameraBtn = $('flipCameraBtn');
const videoInput = $('videoInput');
const scriptInput = $('scriptInput');
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

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let scrollInterval = null;
let paused = false;
let basePosition = parseInt(localStorage.getItem('textPosition') || '100', 10);
let scrollOffset = 0;
let recordingStartTime = null;
let recordingTimer = null;
let lastDownloadUrl = null;
let activeVideoUrl = null;

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
}

function resetPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollOffset = 0;
  applyPosition(); 
}

function switchMode(mode) {
  activeMode = mode;
  const live = mode === 'live';

  if (livePanel) livePanel.hidden = !live;
  if (videoPanel) videoPanel.hidden = live;
  if (cameraPreview) cameraPreview.hidden = !live;
  if (videoPreview) videoPreview.hidden = live;
  if (modeBadge) modeBadge.textContent = live ? 'Mode Live' : 'Mode Vidéo + Voix';
  if (stageTitle) stageTitle.textContent = live ? 'Aperçu caméra' : 'Vidéo importée';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function applyFormat() {
  if (!stageContainer || !formatSelect) return;
  stageContainer.classList.remove('format-16-9', 'format-1-1');
  if (formatSelect.value === '16:9') stageContainer.classList.add('format-16-9');
  if (formatSelect.value === '1:1') stageContainer.classList.add('format-1-1');
}

async function ensureMic() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

async function startCamera() {
  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: true
    }); 

    if (cameraPreview) {
      cameraPreview.srcObject = cameraStream;
    }

    switchMode('live');
  } catch (e) {
    showMessage('Caméra refusée');
  }
}

async function startRecording() {
  try {
    let stream;

    recordedChunks = [];
    recordedBlob = null;
    setDownloadReady(false);

    if (activeMode === 'live') {
      if (!cameraStream) {
        await startCamera(); 
      }
      stream = cameraStream;
    } else {
      if (!videoPreview || !videoPreview.src) {
        showMessage('Importe une vidéo');
        return;
      }

      await ensureMic(); 

      // Le texte reste visible pour lecture.
      // captureStream() n'enregistre QUE la vidéo importée.
      videoPreview.currentTime = 0;
      await videoPreview.play(); 

      const videoStream = videoPreview.captureStream(30);
      stream = new MediaStream(); 

      videoStream.getVideoTracks().forEach(track => {
        stream.addTrack(track);
      }); 

      micStream.getAudioTracks().forEach(track => {
        stream.addTrack(track);
      }); 

      videoPreview.onended = () => stopRecording(); 
    }

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8,opus'
    }); 

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (recordedChunks.length > 0) {
        recordedBlob = new Blob(recordedChunks, {
          type: 'video/webm'
        }); 

        setDownloadReady(true);
        showMessage('Vidéo prête'); 
      }

      stopRecordingTimer(); 
      mediaRecorder = null;
    };

    mediaRecorder.start(1000); 
    startRecordingTimer(); 
    startPrompter(); 
  } catch (e) {
    showMessage('Erreur enregistrement'); 
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); 
  }
}

function downloadRecording() {
  if (!recordedBlob) {
    showMessage('Aucune vidéo'); 
    return;
  }

  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
  }

  lastDownloadUrl = URL.createObjectURL(recordedBlob);

  const a = document.createElement('a');
  a.href = lastDownloadUrl;
  a.download = `grok-teleprompter-${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click(); 
  document.body.removeChild(a);
}

function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : videoPreview;
  if (target) {
    target.classList.toggle('mirror'); 
  }
}

function loadVideo(file) {
  if (!file || !videoPreview) return;

  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
  }

  activeVideoUrl = URL.createObjectURL(file);
  videoPreview.src = activeVideoUrl;
  videoPreview.controls = false;

  switchMode('video'); 
}

cameraBtn?.addEventListener('click', startCamera);
flipCameraBtn?.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera(); 
}); 
videoInput?.addEventListener('change', e => loadVideo(e.target.files[0]));
qualitySelect?.addEventListener('change', () => {
  if (cameraStream) {
    startCamera(); 
  }
}); 
formatSelect?.addEventListener('change', applyFormat);

if (scriptInput) {
  scriptInput.value = localStorage.getItem('grok_script') || '';
  scriptInput.addEventListener('input', updatePrompterText);
}

sizeInput?.addEventListener('input', applyTextSize);
positionSlider?.addEventListener('input', e => setBasePosition(e.target.value)); 
startBtn?.addEventListener('click', startPrompter);
recordBtn?.addEventListener('click', startRecording);
stopRecordBtn?.addEventListener('click', stopRecording);
pauseBtn?.addEventListener('click', togglePause);
resetBtn?.addEventListener('click', resetPrompter);
mirrorBtn?.addEventListener('click', toggleMirror);
downloadBtn?.addEventListener('click', downloadRecording);
moveUpBtn?.addEventListener('click', () => setBasePosition(basePosition + 50)); 
moveDownBtn?.addEventListener('click', () => setBasePosition(basePosition - 50)); 

document.querySelectorAll('.tab-btn').forEach(btn => {
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
