const modeBadge = document.getElementById('modeBadge');
const stageTitle = document.getElementById('stageTitle');
const stageContainer = document.getElementById('stageContainer');
const cameraPreview = document.getElementById('cameraPreview');
const videoPreview = document.getElementById('videoPreview');
const livePanel = document.getElementById('livePanel');
const videoPanel = document.getElementById('videoPanel');
const tabButtons = document.querySelectorAll('.tab-btn');
const qualitySelect = document.getElementById('qualitySelect');
const formatSelect = document.getElementById('formatSelect');
const cameraBtn = document.getElementById('cameraBtn');
const flipCameraBtn = document.getElementById('flipCameraBtn');
const videoInput = document.getElementById('videoInput');
const scriptInput = document.getElementById('scriptInput');
const prompterText = document.getElementById('prompterText');
const speedInput = document.getElementById('speed');
const sizeInput = document.getElementById('size');
const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const downloadBtn = document.getElementById('downloadBtn');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const recordingIndicator = document.getElementById('recordingIndicator');

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let scrollInterval = null;
let paused = false;
let position = 0;
let activeVideoUrl = null;

function switchMode(mode) {
  activeMode = mode;
  const isLive = mode === 'live';

  livePanel.hidden = !isLive;
  videoPanel.hidden = isLive;

  cameraPreview.hidden = !isLive;
  videoPreview.hidden = isLive;

  modeBadge.textContent = isLive ? 'Mode Live' : 'Mode Vidéo + Voix';
  stageTitle.textContent = isLive ? 'Aperçu caméra' : 'Vidéo importée';

  tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function applyFormat() {
  const value = formatSelect.value;
  stageContainer.classList.remove('format-16-9', 'format-1-1');

  if (value === '16:9') {
    stageContainer.classList.add('format-16-9');
  } else if (value === '1:1') {
    stageContainer.classList.add('format-1-1');
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

async function ensureMic() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  return micStream;
}

async function startCamera() {
  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }

    const height = Number(qualitySelect.value);
    const width = facingMode === 'environment' ? 1280 : Math.round(height * 9 / 16);

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        width: { ideal: width },
        height: { ideal: height }
      },
      audio: true
    });

    cameraPreview.srcObject = cameraStream;
    await ensureMic();
    switchMode('live');
  } catch (error) {
    alert("Impossible d'accéder à la caméra : " + error.message);
  }
}

function updatePrompterText() {
  const text = scriptInput.value.trim() || 'Colle ton texte ici.';
  prompterText.textContent = text;
  localStorage.setItem('grok_script', scriptInput.value);
}

function startPrompter() {
  updatePrompterText();
  clearInterval(scrollInterval);

  paused = false;
  position = stageContainer.clientHeight;
  prompterText.style.transform = `translateY(${position}px)`;

  scrollInterval = setInterval(() => {
    if (paused) return;

    const speed = Number(speedInput.value);
    position -= speed * 2;

    prompterText.style.transform = `translateY(${position}px)`;
  }, 16);
}

function togglePause() {
  paused = !paused;
}

function resetPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  prompterText.style.transform = 'translateY(0)';
}

async function buildRecordingStream() {
  if (activeMode === 'video' && videoPreview.src) {
    await ensureMic();

    const videoStream = videoPreview.captureStream();
    const combined = new MediaStream();

    videoStream.getVideoTracks().forEach((track) => combined.addTrack(track));
    micStream.getAudioTracks().forEach((track) => combined.addTrack(track));

    return combined;
  }

  if (!cameraStream) {
    throw new Error("Active d'abord la caméra.");
  }

  return cameraStream;
}

async function startRecording() {
  try {
    const stream = await buildRecordingStream();

    recordedChunks = [];
    recordedBlob = null;

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm'
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(recordedChunks, {
        type: 'video/webm'
      });

      recordingIndicator.hidden = true;
      alert('Vidéo prête. Appuie sur Télécharger.');
    };

    mediaRecorder.start();
    recordingIndicator.hidden = false;

    startPrompter();

    if (activeMode === 'video') {
      videoPreview.currentTime = 0;
      videoPreview.play().catch(() => {});
      videoPreview.onended = stopRecording;
    }
  } catch (error) {
    alert(error.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function downloadRecording() {
  if (!recordedBlob) {
    alert('Aucune vidéo enregistrée.');
    return;
  }

  const url = URL.createObjectURL(recordedBlob);
  const a = document.createElement('a');

  a.href = url;
  a.download = activeMode === 'video' ? 'video-avec-voix.webm' : 'grok-teleprompter.webm';
  a.click();

  URL.revokeObjectURL(url);
}

function loadVideo(file) {
  if (!file) return;

  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
  }

  activeVideoUrl = URL.createObjectURL(file);
  videoPreview.src = activeVideoUrl;
  switchMode('video');
}

function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : videoPreview;
  target.classList.toggle('mirror');
}

function toggleFormatAndResize() {
  applyFormat();
}

cameraBtn.addEventListener('click', startCamera);

flipCameraBtn.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
});

qualitySelect.addEventListener('change', () => {
  if (cameraStream && activeMode === 'live') {
    startCamera();
  }
});

formatSelect.addEventListener('change', toggleFormatAndResize);

videoInput.addEventListener('change', (event) => {
  loadVideo(event.target.files[0]);
});

scriptInput.value = localStorage.getItem('grok_script') || '';
scriptInput.addEventListener('input', updatePrompterText);

sizeInput.addEventListener('input', () => {
  prompterText.style.fontSize = sizeInput.value + 'px';
});

recordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
downloadBtn.addEventListener('click', downloadRecording);
startBtn.addEventListener('click', startPrompter);
pauseBtn.addEventListener('click', togglePause);
resetBtn.addEventListener('click', resetPrompter);
mirrorBtn.addEventListener('click', toggleMirror);

prompterText.style.fontSize = sizeInput.value + 'px';
applyFormat();
updatePrompterText();
switchMode('live');
