const videoPreview = document.getElementById('videoPreview');
const importedVideo = document.getElementById('importedVideo');

const cameraBtn = document.getElementById('cameraBtn');
const uploadBtn = document.getElementById('uploadBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const recordBtn = document.getElementById('recordBtn');

const videoInput = document.getElementById('videoInput');
const speedRange = document.getElementById('speedRange');
const scriptInput = document.getElementById('scriptInput');
const teleprompterText = document.getElementById('teleprompterText');
const downloadLink = document.getElementById('downloadLink');

let cameraStream = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let scrollInterval = null;
let scrollY = 0;
let currentMode = 'camera';
let currentVideoUrl = null;

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
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

function updateTeleprompter() {
  teleprompterText.textContent = scriptInput.value || 'Colle ton texte ici...';
}

function showCamera() {
  videoPreview.hidden = false;
  importedVideo.hidden = true;
}

function showImportedVideo() {
  videoPreview.hidden = true;
  importedVideo.hidden = false;
}

async function startCamera() {
  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: true
    });

    videoPreview.srcObject = cameraStream;
    videoPreview.muted = true;
    await videoPreview.play(); 

    currentMode = 'camera';
    showCamera(); 
  } catch (error) {
    alert("Impossible d'accéder à la caméra.");
    console.error(error);
  }
}

async function ensureMicrophone() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

function importVideo(file) {
  if (!file) return;

  if (currentVideoUrl) {
    URL.revokeObjectURL(currentVideoUrl);
  }

  currentVideoUrl = URL.createObjectURL(file);

  importedVideo.src = currentVideoUrl;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.controls = true;
  importedVideo.load(); 

  importedVideo.onloadedmetadata = async () => {
    try {
      showImportedVideo(); 
      await importedVideo.play(); 
      importedVideo.pause(); 
      importedVideo.currentTime = 0;
      currentMode = 'imported';
    } catch (error) {
      console.error(error);
    }
  };

  videoInput.value = '';
}

function startTeleprompter() {
  stopTeleprompter(); 

  const container = document.getElementById('teleprompterContainer');
  scrollY = container.clientHeight;
  teleprompterText.style.transform = `translateY(${scrollY}px)`;

  scrollInterval = setInterval(() => {
    const speed = Number(speedRange.value);
    scrollY -= speed;
    teleprompterText.style.transform = `translateY(${scrollY}px)`;
  }, 30);
}

function stopTeleprompter() {
  clearInterval(scrollInterval);
  scrollInterval = null;
}

function getRecordingStream() {
  if (currentMode === 'camera') {
    return cameraStream;
  }

  return importedVideo.captureStream(30);
}

async function startRecording() {
  try {
    const baseStream = getRecordingStream(); 

    if (!baseStream) {
      alert('Aucune source vidéo disponible.');
      return;
    }

    if (currentMode === 'imported') {
      await ensureMicrophone(); 
      importedVideo.currentTime = 0;
      await importedVideo.play(); 
    }

    recordedChunks = [];

    const finalStream = new MediaStream(); 

    baseStream.getVideoTracks().forEach(track => finalStream.addTrack(track)); 

    if (currentMode === 'camera') {
      baseStream.getAudioTracks().forEach(track => finalStream.addTrack(track)); 
    } else {
      micStream.getAudioTracks().forEach(track => finalStream.addTrack(track));
    }

    const mimeType = getSupportedMimeType(); 

    mediaRecorder = new MediaRecorder(finalStream, {
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
      const url = URL.createObjectURL(blob);

      downloadLink.href = url;
      downloadLink.download = `teleprompter-${Date.now()}.${getExtension(mimeType)}`;
      downloadLink.hidden = false;
      downloadLink.textContent = '⬇️ Télécharger la vidéo';

      stopTeleprompter(); 
      recordBtn.textContent = '🔴 Enregistrer';
      mediaRecorder = null;
    };

    mediaRecorder.start(1000);

    if (currentMode === 'imported') {
      importedVideo.onended = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop(); 
        }
      };
    }

    startTeleprompter(); 
    recordBtn.textContent = '⏹ Stop';
  } catch (error) {
    console.error(error);
    alert("Erreur lors de l'enregistrement.");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  if (currentMode === 'imported') {
    importedVideo.pause(); 
  }

  stopTeleprompter(); 
  recordBtn.textContent = '🔴 Enregistrer';
}

cameraBtn.addEventListener('click', startCamera);
uploadBtn.addEventListener('click', () => videoInput.click());
videoInput.addEventListener('change', event => importVideo(event.target.files[0])); 
playBtn.addEventListener('click', startTeleprompter);
pauseBtn.addEventListener('click', stopTeleprompter);

recordBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    stopRecording(); 
  } else {
    startRecording(); 
  }
}); 

scriptInput.addEventListener('input', updateTeleprompter);

updateTeleprompter();
startCamera(); 
