const cameraPreview = document.getElementById('cameraPreview');
const importedVideo = document.getElementById('importedVideo');

const cameraBtn = document.getElementById('cameraBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const recordBtn = document.getElementById('recordBtn');

const videoInput = document.getElementById('videoInput');
const speedRange = document.getElementById('speedRange');
const scriptInput = document.getElementById('scriptInput');
const teleprompterContainer = document.getElementById('teleprompterContainer');
const teleprompterText = document.getElementById('teleprompterText');
const downloadLink = document.getElementById('downloadLink');

let cameraStream = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let teleprompterInterval = null;
let scrollY = 0;
let teleprompterPaused = false;
let currentMode = 'live';
let currentVideoUrl = null;
let downloadObjectUrl = null;
let recording = false;
let facingMode = 'user';

function getSupportedMimeType() {
  const types = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  for (const type of types) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return 'video/webm';
}

function getExtension(mimeType) {
  return mimeType && mimeType.includes('mp4') ? 'mp4' : 'webm';
}

function updateTeleprompter() {
  teleprompterText.textContent = scriptInput.value.trim() || 'Colle ton texte ici...';
  localStorage.setItem('grok_script', scriptInput.value);
}

function applyTeleprompterPosition() {
  teleprompterText.style.transform = `translate(-50%, calc(-50% + ${scrollY}px))`;
}

function resetTeleprompterPosition() {
  scrollY = 0;
  applyTeleprompterPosition();
}

function startTeleprompter() {
  if (!teleprompterInterval) {
    if (scrollY === 0) {
      scrollY = Math.round(teleprompterContainer.clientHeight * 0.65);
      applyTeleprompterPosition();
    }

    teleprompterInterval = setInterval(() => {
      if (teleprompterPaused) return;
      const speed = Number(speedRange.value || 3);
      scrollY -= speed * 1.5;
      applyTeleprompterPosition();
    }, 30);
  }

  teleprompterPaused = false;
}

function stopTeleprompter() {
  clearInterval(teleprompterInterval);
  teleprompterInterval = null;
  teleprompterPaused = false;
}

function setMode(mode) {
  currentMode = mode;
  cameraPreview.hidden = mode !== 'live';
  importedVideo.hidden = mode !== 'video';
}

function setRecordUi(isRecording) {
  recording = isRecording;
  recordBtn.textContent = isRecording ? '⏹ Stop' : '🔴 Enregistrer';
  recordBtn.disabled = false;
}

async function startCamera() {
  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode }
      },
      audio: true
    });

    cameraPreview.srcObject = cameraStream;
    cameraPreview.muted = true;
    cameraPreview.playsInline = true;
    await cameraPreview.play().catch(() => {});

    setMode('live');

    cameraBtn.textContent = facingMode === 'user'
      ? '📷 Caméra Avant'
      : '📷 Caméra Arrière';
  } catch (error) {
    console.error(error);
    alert("Impossible d'accéder à la caméra.");
  }
}

async function toggleCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  await startCamera();
}

async function ensureMicrophone() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

function importVideo(file) {
  if (!file) return;

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  if (currentVideoUrl) {
    URL.revokeObjectURL(currentVideoUrl);
  }

  currentVideoUrl = URL.createObjectURL(file);

  importedVideo.pause(); 
  importedVideo.removeAttribute('src'); 
  importedVideo.load(); 

  importedVideo.src = currentVideoUrl;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.preload = 'auto';
  importedVideo.loop = false;

  importedVideo.onloadedmetadata = async () => {
    try {
      setMode('video');
      await importedVideo.play(); 
      setTimeout(() => {
        importedVideo.pause(); 
        importedVideo.currentTime = 0;
      }, 300);
    } catch (error) {
      console.log('Prévisualisation vidéo bloquée', error);
      setMode('video');
    }
  };

  importedVideo.onerror = () => {
    alert('Impossible de charger cette vidéo.');
  };

  importedVideo.load(); 
  videoInput.value = '';
}

async function startRecording() {
  try {
    if (recording) return;

    recordedChunks = [];
    downloadLink.hidden = true;

    let streamToRecord;

    if (currentMode === 'live') {
      if (!cameraStream) {
        await startCamera(); 
      }
      if (!cameraStream) {
        alert('Caméra indisponible.');
        return;
      }
      streamToRecord = cameraStream;
    } else {
      if (!importedVideo.src) {
        alert('Importe une vidéo d’abord.');
        return;
      }

      await ensureMicrophone(); 
      importedVideo.currentTime = 0;
      await importedVideo.play().catch(() => {});

      const capture = importedVideo.captureStream || importedVideo.mozCaptureStream;
      if (!capture) {
        alert('Capture vidéo non supportée sur ce navigateur.');
        return;
      }

      const videoStream = capture.call(importedVideo);
      streamToRecord = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...micStream.getAudioTracks()
      ]);

      importedVideo.onended = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          stopRecording(); 
        }
      };
    }

    const mimeType = getSupportedMimeType(); 

    mediaRecorder = new MediaRecorder(streamToRecord, {
      mimeType,
      videoBitsPerSecond: 6000000,
      audioBitsPerSecond: 128000
    }); 

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mimeType }); 

      if (downloadObjectUrl) {
        URL.revokeObjectURL(downloadObjectUrl);
      }

      downloadObjectUrl = URL.createObjectURL(blob);
      downloadLink.href = downloadObjectUrl;
      downloadLink.download = `teleprompteur-${Date.now()}.${getExtension(mimeType)}`;
      downloadLink.textContent = '⬇️ Télécharger la vidéo'; 
      downloadLink.hidden = false;

      setRecordUi(false);
      stopTeleprompter(); 
      mediaRecorder = null;
    };

    mediaRecorder.start(1000);
    setRecordUi(true);
    startTeleprompter(); 
  } catch (error) {
    console.error(error);
    alert("Erreur lors de l'enregistrement."); 
    setRecordUi(false);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); 
  }

  if (currentMode === 'video') {
    importedVideo.pause(); 
  }

  setRecordUi(false);
  stopTeleprompter(); 
}

function toggleMirror() {
  const target = currentMode === 'live' ? cameraPreview : importedVideo;
  if (target) target.classList.toggle('mirror'); 
}

cameraBtn.addEventListener('click', async () => {
  if (!cameraStream || currentMode !== 'live') {
    await startCamera(); 
  } else {
    await toggleCamera(); 
  }
}); 

videoInput.addEventListener('change', event => {
  importVideo(event.target.files[0]); 
}); 

playBtn.addEventListener('click', startTeleprompter);

pauseBtn.addEventListener('click', () => {
  teleprompterPaused = !teleprompterPaused;
}); 

resetBtn.addEventListener('click', () => {
  stopTeleprompter(); 
  resetTeleprompterPosition(); 
}); 

mirrorBtn.addEventListener('click', toggleMirror);

recordBtn.addEventListener('click', () => {
  if (recording) {
    stopRecording(); 
  } else {
    startRecording(); 
  }
}); 

scriptInput.addEventListener('input', updateTeleprompter);

window.addEventListener('resize', () => {
  if (!teleprompterInterval) {
    resetTeleprompterPosition(); 
  }
}); 

window.onload = () => {
  scriptInput.value = localStorage.getItem('grok_script') || scriptInput.value;
  updateTeleprompter(); 
  resetTeleprompterPosition(); 
  setMode('live'); 
  setRecordUi(false); 
  startCamera().catch(() => {}); 
};
