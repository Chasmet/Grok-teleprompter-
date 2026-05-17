const $ = id => document.getElementById(id);

const cameraPreview = $('cameraPreview');
const importedVideo = $('importedVideo');
const teleprompterText = $('teleprompterText');
const scriptInput = $('scriptInput');
const videoInput = $('videoInput');
const downloadLink = $('downloadLink');
const recordTimer = $('recordTimer');

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let activeVideoUrl = null;
let scrollInterval = null;
let textY = 100;
let recordInterval = null;
let recordSeconds = 0;

function updateText() {
  teleprompterText.textContent = scriptInput.value || 'Colle ton texte ici...';
}

function updatePosition() {
  teleprompterText.style.top = textY + '%';
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function startRecordTimer() {
  stopRecordTimer(); 
  recordSeconds = 0;
  recordTimer.textContent = '00:00';
  recordInterval = setInterval(() => {
    recordSeconds++;
    recordTimer.textContent = formatTime(recordSeconds);
  }, 1000);
}

function stopRecordTimer() {
  clearInterval(recordInterval);
  recordInterval = null;
  recordTimer.textContent = '00:00';
}

function loadVideo(file) {
  if (!file) return;

  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);

  activeVideoUrl = URL.createObjectURL(file);
  importedVideo.src = activeVideoUrl;
  importedVideo.hidden = false;
  cameraPreview.hidden = true;
  activeMode = 'video';
}

async function startCamera() {
  try {
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());

    cameraStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode },
      audio: true 
    });

    cameraPreview.srcObject = cameraStream;
    cameraPreview.hidden = false;
    importedVideo.hidden = true;
    activeMode = 'live';
  } catch {
    alert('Impossible d\'accéder à la caméra.');
  }
}

function flipCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera(); 
}

function startPrompter() {
  clearInterval(scrollInterval);
  scrollInterval = setInterval(() => {
    textY -= Number($('speedRange').value) * 0.1;
    updatePosition(); 
  }, 30);
}

function pausePrompter() {
  clearInterval(scrollInterval);
}

function resetPrompter() {
  clearInterval(scrollInterval);
  textY = 100;
  updatePosition(); 
}

function moveUp() {
  textY -= 5;
  updatePosition(); 
}

function moveDown() {
  textY += 5;
  updatePosition(); 
}

async function startRecording() {
  try {
    recordedChunks = [];
    let stream;

    if (activeMode === 'live') {
      if (!cameraStream) await startCamera(); 
      stream = cameraStream;
    } else {
      if (!importedVideo.src) {
        alert('Importe une vidéo d\'abord.');
        return;
      }

      await importedVideo.play(); 
      stream = importedVideo.captureStream(30);
      importedVideo.onended = stopRecording;
    }

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm'
    }); 

    mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' }); 
      const url = URL.createObjectURL(blob);

      downloadLink.href = url;
      downloadLink.download = 'teleprompter-video.webm';
      downloadLink.hidden = false;
      downloadLink.textContent = 'Télécharger la vidéo';

      stopRecordTimer(); 
    };

    mediaRecorder.start(); 
    startPrompter(); 
    startRecordTimer(); 
  } catch {
    alert('Erreur lors de l\'enregistrement.');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); 
  }

  if (activeMode === 'video') {
    importedVideo.pause(); 
  }
}

function toggleMirror() {
  const target = activeMode === 'live' ? cameraPreview : importedVideo;
  if (target) target.classList.toggle('mirror'); 
}

$('cameraBtn').addEventListener('click', startCamera);
$('flipBtn').addEventListener('click', flipCamera);
$('playBtn').addEventListener('click', startPrompter);
$('pauseBtn').addEventListener('click', pausePrompter);
$('mirrorBtn').addEventListener('click', toggleMirror);
$('recordBtn').addEventListener('click', startRecording);
$('applyTextBtn').addEventListener('click', updateText);
$('upBtn').addEventListener('click', moveUp);
$('downBtn').addEventListener('click', moveDown);

videoInput.addEventListener('change', event => {
  loadVideo(event.target.files[0]);
}); 

scriptInput.addEventListener('input', updateText);

window.addEventListener('load', () => {
  updateText(); 
  updatePosition(); 
  startCamera(); 
});