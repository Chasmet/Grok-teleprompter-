const scriptInput = document.getElementById('scriptInput');
const teleprompter = document.getElementById('teleprompter');
const container = document.getElementById('teleprompterContainer');
const speedInput = document.getElementById('speed');
const fontSizeInput = document.getElementById('fontSize');
const videoInput = document.getElementById('videoInput');
const backgroundVideo = document.getElementById('backgroundVideo');
const cameraPreview = document.getElementById('cameraPreview');
const cameraBtn = document.getElementById('cameraBtn');
const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const downloadBtn = document.getElementById('downloadBtn');
const recordingIndicator = document.getElementById('recordingIndicator');

let position = container.clientHeight;
let interval = null;
let paused = false;
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;

scriptInput.value = localStorage.getItem('grok_script') || '';

scriptInput.addEventListener('input', () => {
  localStorage.setItem('grok_script', scriptInput.value);
}); 

function renderText() {
  teleprompter.innerText = scriptInput.value || 'Colle ton texte ici.';
  teleprompter.style.fontSize = fontSizeInput.value + 'px';
}

function startPrompter() {
  renderText();
  clearInterval(interval);
  position = container.clientHeight;
  teleprompter.style.top = position + 'px';
  paused = false;

  if (backgroundVideo.src) {
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

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: true
    }); 
    cameraPreview.srcObject = cameraStream;
  } catch (error) {
    alert('Impossible d\'accéder à la caméra : ' + error.message);
  }
}

function startRecording() {
  if (!cameraStream) {
    alert('Active d\'abord la caméra.');
    return;
  }

  recordedChunks = [];
  recordedBlob = null;

  mediaRecorder = new MediaRecorder(cameraStream);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(recordedChunks, { type: 'video/webm' }); 
  };

  mediaRecorder.start(); 
  recordingIndicator.style.display = 'block';
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); 
    recordingIndicator.style.display = 'none';
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
  a.download = 'grok-teleprompter.webm';
  a.click(); 
  URL.revokeObjectURL(url);
}

cameraBtn.addEventListener('click', startCamera);
recordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
downloadBtn.addEventListener('click', downloadRecording);

document.getElementById('startBtn').addEventListener('click', startPrompter);
document.getElementById('pauseBtn').addEventListener('click', () => {
  paused = !paused;

  if (backgroundVideo.src) {
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

videoInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  backgroundVideo.src = url;
  backgroundVideo.style.display = 'block';
  backgroundVideo.load(); 
}); 

renderText(); 
resetPrompter(); 
