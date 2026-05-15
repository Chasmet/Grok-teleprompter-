const scriptInput = document.getElementById('scriptInput');
const teleprompter = document.getElementById('teleprompter');
const container = document.getElementById('teleprompterContainer');
const speedInput = document.getElementById('speed');
const fontSizeInput = document.getElementById('fontSize');
const qualitySelect = document.getElementById('qualitySelect');
const videoInput = document.getElementById('videoInput');
const backgroundVideo = document.getElementById('backgroundVideo');
const cameraPreview = document.getElementById('cameraPreview');
const cameraBtn = document.getElementById('cameraBtn');
const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const downloadBtn = document.getElementById('downloadBtn');
const recordingIndicator = document.getElementById('recordingIndicator');
const countdownIndicator = document.getElementById('countdownIndicator');

let position = container.clientHeight;
let interval = null;
let paused = false;
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let micStream = null;
let activeMode = 'live';

scriptInput.value = localStorage.getItem('grok_script') || '';

scriptInput.addEventListener('input', () => {
  localStorage.setItem('grok_script', scriptInput.value);
}); 

function renderText() {
  teleprompter.innerText = scriptInput.value || 'Colle ton texte ici.';
  teleprompter.style.fontSize = fontSizeInput.value + 'px';
}

function getSelectedHeight() {
  return Number(qualitySelect.value);
}

function startPrompter() {
  renderText(); 
  clearInterval(interval);
  position = container.clientHeight;
  teleprompter.style.top = position + 'px';
  paused = false;

  if (backgroundVideo.src && activeMode === 'video') {
    backgroundVideo.currentTime = 0;
    backgroundVideo.play().catch(() => {});
  }

  interval = setInterval(() => {
    if (paused) return;
    position -= Number(speedInput.value);
    teleprompter.style.top = position + 'px';
  }, 50);
}

function resetPrompter() {
  clearInterval(interval);
  position = container.clientHeight;
  teleprompter.style.top = position + 'px';

  if (backgroundVideo.src) {
    backgroundVideo.pause(); 
    backgroundVideo.currentTime = 0;
  }
}

async function ensureMic() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); 
  }
  return micStream;
}

async function startCamera() {
  try {
    activeMode = 'live';

    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    const height = getSelectedHeight(); 

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
  } catch (error) {
    alert('Impossible d\'accéder à la caméra : ' + error.message);
  }
}

async function buildRecordingStream() {
  if (activeMode === 'video' && backgroundVideo.src) {
    await ensureMic(); 

    const videoStream = backgroundVideo.captureStream(); 
    const combined = new MediaStream(); 

    videoStream.getVideoTracks().forEach(track => combined.addTrack(track));
    micStream.getAudioTracks().forEach(track => combined.addTrack(track)); 

    return combined;
  }

  if (!cameraStream) {
    throw new Error('Active d\'abord la caméra.');
  }

  return cameraStream;
}

async function performRecording() {
  try {
    const streamToRecord = await buildRecordingStream(); 

    recordedChunks = [];
    recordedBlob = null;

    mediaRecorder = new MediaRecorder(streamToRecord, {
      mimeType: 'video/webm'
    }); 

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(recordedChunks, { type: 'video/webm' }); 
      recordingIndicator.style.display = 'none';
      alert('✅ Vidéo finale prête. Appuie sur Télécharger.');
    };

    mediaRecorder.start(); 
    recordingIndicator.style.display = 'block';
    startPrompter(); 

    if (activeMode === 'video') {
      backgroundVideo.onended = () => {
        stopRecording(); 
      };
    }
  } catch (error) {
    alert(error.message);
  }
}

function startRecording() {
  let count = 3;
  countdownIndicator.style.display = 'block';
  countdownIndicator.textContent = count;

  const countdown = setInterval(() => {
    count--;

    if (count > 0) {
      countdownIndicator.textContent = count;
    } else {
      clearInterval(countdown);
      countdownIndicator.style.display = 'none';
      performRecording(); 
    }
  }, 1000);
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

cameraBtn.addEventListener('click', startCamera);
recordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
downloadBtn.addEventListener('click', downloadRecording);

qualitySelect.addEventListener('change', () => {
  if (cameraStream && activeMode === 'live') {
    startCamera(); 
  }
}); 

document.getElementById('startBtn').addEventListener('click', startPrompter);

document.getElementById('pauseBtn').addEventListener('click', () => {
  paused = !paused;

  if (backgroundVideo.src && activeMode === 'video') {
    if (paused) {
      backgroundVideo.pause(); 
    } else {
      backgroundVideo.play().catch(() => {});
    }
  }
}); 

document.getElementById('resetBtn').addEventListener('click', resetPrompter);

document.getElementById('mirrorBtn').addEventListener('click', () => {
  teleprompter.classList.toggle('mirror');
  cameraPreview.classList.toggle('mirror');
}); 

fontSizeInput.addEventListener('input', renderText);

videoInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  activeMode = 'video';
  await ensureMic(); 

  const url = URL.createObjectURL(file);
  backgroundVideo.src = url;
  backgroundVideo.style.display = 'block';
  backgroundVideo.load(); 

  alert('🎬 Mode Vidéo + Voix activé. Appuie sur REC pour enregistrer ton audio sur la vidéo.'); 
}); 

renderText(); 
resetPrompter(); 
