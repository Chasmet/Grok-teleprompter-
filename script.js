const modeBadge = document.getElementById('modeBadge');
const stageTitle = document.getElementById('stageTitle');
const cameraPreview = document.getElementById('cameraPreview');
const videoPreview = document.getElementById('videoPreview');
const livePanel = document.getElementById('livePanel');
const videoPanel = document.getElementById('videoPanel');
const tabButtons = document.querySelectorAll('.tab-btn');
const qualitySelect = document.getElementById('qualitySelect');
const cameraBtn = document.getElementById('cameraBtn');
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
let cameraStream = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let scrollInterval = null;
let paused = false;
let position = 0;

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

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: Math.round(height * 9 / 16) },
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
  position = window.innerHeight;
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
      videoPreview.play();
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
  a.download =
    activeMode === 'video'
      ? 'video-avec-voix.webm'
      : 'grok-teleprompter.webm';

  a.click();
  URL.revokeObjectURL(url);
}

function loadVideo(file) {
  if (!file) return;

  const url = URL.createObjectURL(file);
  videoPreview.src = url;
  switchMode('video');
}

function toggleMirror() {
  const target = activeMode === 'live'
    ? cameraPreview
    : videoPreview;

  target.style.transform =
    target.style.transform === 'scaleX(-1)'
      ? 'none'
      : 'scaleX(-1)';
}

cameraBtn.addEventListener('click', startCamera);

qualitySelect.addEventListener('change', () => {
  if (cameraStream && activeMode === 'live') {
    startCamera();
  }
});

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
updatePrompterText();
switchMode('live');
