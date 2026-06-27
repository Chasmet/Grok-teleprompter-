const $ = (id) => document.getElementById(id);

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
const videoPanelEl = $('videoPanel');

let activeMode = 'live';
let facingMode = 'user';
let cameraStream = null;
let audioStream = null;
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];
let timerInterval = null;
let startTime = 0;
let scrollY = 0;
let scrollSpeed = parseInt(speedRange.value, 10) || 3;
let scrolling = false;
let animationFrame = null;
let lastTimestamp = 0;
let statusTimeout = null;

function init() {
  updateTextDisplay();
  setupEventListeners();
}

function updateTextDisplay() {
  teleprompterText.textContent = scriptInput.value;
  teleprompterText.style.fontSize = `${sizeRange.value}px`;
  resetScroll();
}

function resetScroll() {
  scrolling = false;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  scrollY = teleprompterContainer.clientHeight / 2;
  teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`;
}

function startScroll() {
  if (scrolling) return;
  scrolling = true;
  lastTimestamp = performance.now();
  animationFrame = requestAnimationFrame(scrollLoop);
}

function scrollLoop(timestamp) {
  if (!scrolling) return;
  const delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  scrollY -= scrollSpeed * 15 * delta;

  if (scrollY < -teleprompterText.clientHeight) {
    scrolling = false;
    setStatus('Fin du texte', 'success');
    return;
  }

  teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`;
  animationFrame = requestAnimationFrame(scrollLoop);
}

async function startCamera() {
  if (cameraStream) stopCamera();

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true
    });
    cameraPreview.srcObject = cameraStream;
    setStatus('Caméra prête', 'success');
  } catch (err) {
    console.error(err);
    setStatus("Impossible d'accéder à la caméra", 'error');
  }
}

function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach((track) => track.stop());
  cameraPreview.srcObject = null;
  cameraStream = null;
}

function pickVideoMime() {
  const types = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  for (const type of types) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }

  return '';
}

function captureVideoElement(videoElement) {
  if (videoElement.captureStream) return videoElement.captureStream();
  if (videoElement.mozCaptureStream) return videoElement.mozCaptureStream();
  return null;
}

async function startRecording() {
  recordedChunks = [];
  let streamToRecord = null;
  const mimeType = pickVideoMime();
  const options = mimeType ? { mimeType } : undefined;

  if (activeMode === 'live') {
    if (!cameraStream) {
      setStatus("Activez d'abord la caméra !", 'error');
      return;
    }
    streamToRecord = cameraStream;
  } else {
    if (!importedVideo.src) {
      setStatus("Importez d'abord une vidéo", 'error');
      return;
    }

    const importedStream = captureVideoElement(importedVideo);
    if (!importedStream || importedStream.getVideoTracks().length === 0) {
      setStatus('Capture vidéo non compatible sur ce navigateur', 'error');
      return;
    }

    streamToRecord = new MediaStream();
    importedStream.getVideoTracks().forEach((track) => streamToRecord.addTrack(track));

    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStream.getAudioTracks().forEach((track) => streamToRecord.addTrack(track));
    } catch (err) {
      console.warn(err);
      setStatus('Micro refusé', 'error');
    }
  }

  try {
    mediaRecorder = options ? new MediaRecorder(streamToRecord, options) : new MediaRecorder(streamToRecord);
  } catch (err) {
    console.warn(err);
    mediaRecorder = new MediaRecorder(streamToRecord);
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) recordedChunks.push(event.data);
  };

  mediaRecorder.onstop = () => {
    const finalMime = mediaRecorder.mimeType || 'video/webm';
    const extension = finalMime.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recordedChunks, { type: finalMime });
    const url = URL.createObjectURL(blob);

    downloadLink.href = url;
    downloadLink.download = `Grok_Prompter_${Date.now()}.${extension}`;
    downloadLink.style.display = 'inline-flex';
    downloadLink.removeAttribute('hidden');

    setStatus('Vidéo sauvegardée ! Appuie sur Télécharger.', 'success');

    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
      audioStream = null;
    }
  };

  mediaRecorder.start(1000);
  isRecording = true;
  recordBtn.disabled = true;
  stopBtn.disabled = false;
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 1000);

  if (activeMode === 'video') {
    try {
      await importedVideo.play();
    } catch (err) {
      console.warn(err);
    }
  }

  startScroll();
}

function stopRecording() {
  if (!isRecording) return;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  isRecording = false;
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  clearInterval(timerInterval);
  recordTimer.textContent = '00:00';
  scrolling = false;

  if (activeMode === 'video') importedVideo.pause();
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  recordTimer.textContent = `${mins}:${secs}`;
}

function setupEventListeners() {
  modeLiveBtn.addEventListener('click', () => {
    activeMode = 'live';
    modeLiveBtn.classList.add('active');
    modeVideoBtn.classList.remove('active');
    livePanel.style.display = 'grid';
    videoPanelEl.style.display = 'none';
    cameraPreview.style.display = 'block';
    importedVideo.style.display = 'none';
    stopCamera();
    resetScroll();
  });

  modeVideoBtn.addEventListener('click', () => {
    activeMode = 'video';
    modeVideoBtn.classList.add('active');
    modeLiveBtn.classList.remove('active');
    livePanel.style.display = 'none';
    videoPanelEl.style.display = 'grid';
    cameraPreview.style.display = 'none';
    importedVideo.style.display = 'block';
    stopCamera();
    resetScroll();
  });

  cameraBtn.addEventListener('click', startCamera);

  flipBtn.addEventListener('click', () => {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    if (cameraStream) startCamera();
  });

  mirrorLiveBtn.addEventListener('click', () => cameraPreview.classList.toggle('mirrored'));
  mirrorVideoBtn.addEventListener('click', () => importedVideo.classList.toggle('mirrored'));

  videoInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (importedVideo.src) URL.revokeObjectURL(importedVideo.src);
    importedVideo.src = URL.createObjectURL(file);
    importedVideo.load();
    setStatus('Vidéo importée prête', 'success');
  });

  playBtn.addEventListener('click', () => { importedVideo.play(); startScroll(); });
  pauseBtn.addEventListener('click', () => { importedVideo.pause(); scrolling = false; });

  stopVideoBtn.addEventListener('click', () => {
    importedVideo.pause();
    importedVideo.currentTime = 0;
    resetScroll();
  });

  recordBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
  speedRange.addEventListener('input', (event) => { scrollSpeed = parseInt(event.target.value, 10); });
  sizeRange.addEventListener('input', (event) => { teleprompterText.style.fontSize = `${event.target.value}px`; });
  applyTextBtn.addEventListener('click', updateTextDisplay);
  upBtn.addEventListener('click', () => { scrollY -= 50; teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`; });
  downBtn.addEventListener('click', () => { scrollY += 50; teleprompterText.style.transform = `translate(-50%, ${scrollY}px)`; });
}

function setStatus(msg, type) {
  if (statusTimeout) clearTimeout(statusTimeout);
  statusMessage.textContent = msg;
  statusMessage.style.display = 'block';
  statusMessage.style.color = type === 'error' ? '#ef4444' : '#10b981';
  statusTimeout = setTimeout(() => { statusMessage.style.display = 'none'; }, 4000);
}

window.addEventListener('DOMContentLoaded', init);
