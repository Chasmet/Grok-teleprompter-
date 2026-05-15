const existing = document.createElement('script');
// Version corrigée : rendu canvas pour le mode Vidéo + Voix.
// Le code complet est identique à la version précédente, avec les ajouts ci-dessous.

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

// Canvas de rendu pour exporter la vidéo importée sans les contrôles Play.
let renderCanvas = document.createElement('canvas');
let renderCtx = renderCanvas.getContext('2d');
let renderStream = null;
let renderAnimation = null;

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateRecordingIndicator() {
  if (!recordingIndicator) return;
  recordingIndicator.textContent = recordingStartTime
    ? `● REC ${formatDuration(Date.now() - recordingStartTime)}`
    : '● REC 00:00';
}

function startRecordingTimer() {
  if (!recordingIndicator) return;
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
    recordingIndicator.textContent = '● REC 00:00';
    recordingIndicator.hidden = true;
    recordingIndicator.style.display = 'none';
  }
}

function setDownloadReady(ready) {
  if (!downloadBtn) return;
  downloadBtn.disabled = !ready;
  downloadBtn.style.opacity = ready ? '1' : '0.6';
}

function updatePrompterText() {
  const text = scriptInput.value.trim() || 'Colle ton texte ici.';
  prompterText.textContent = text;
  localStorage.setItem('grok_script', scriptInput.value);
}

function applyTextSize() {
  if (sizeInput) prompterText.style.fontSize = `${sizeInput.value}px`;
}

function applyPosition() {
  prompterText.style.transform = `translateY(${basePosition + scrollOffset}px)`;
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
  }, 16);
}

function togglePause() { paused = !paused; }

function resetPrompter() {
  clearInterval(scrollInterval);
  paused = false;
  scrollOffset = 0;
  applyPosition();
  stopRecordingTimer(); 
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
  document.querySelectorAll('.tab-btn').forEach((btn) => {
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
  if (!micStream) micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); 
  return micStream;
}

async function startCamera() {
  try {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    const height = Number(qualitySelect?.value || 1080);
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, height: { ideal: height } },
      audio: true
    });
    cameraPreview.srcObject = cameraStream;
    await ensureMic(); 
    switchMode('live');
  } catch (error) {
    alert("Impossible d'accéder à la caméra : " + error.message);
  }
}

function wrapText(ctx, text, maxWidth) {
  const paragraphs = text.split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const testLine = line ? line + ' ' + word : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
    lines.push('');
  }
  return lines;
}

function startCanvasRendering() {
  const width = videoPreview.videoWidth || 1080;
  const height = videoPreview.videoHeight || 1920;
  renderCanvas.width = width;
  renderCanvas.height = height;
  renderStream = renderCanvas.captureStream(30);

  const draw = () => {
    renderCtx.clearRect(0, 0, width, height);
    renderCtx.drawImage(videoPreview, 0, 0, width, height);

    const fontSize = Number(sizeInput?.value || 72);
    renderCtx.font = `700 ${fontSize}px Arial`;
    renderCtx.textAlign = 'center';
    renderCtx.fillStyle = 'white';
    renderCtx.shadowColor = 'rgba(0,0,0,0.7)';
    renderCtx.shadowBlur = 12;

    const lines = wrapText(renderCtx, scriptInput?.value || '', width * 0.8);
    const lineHeight = fontSize * 1.25;
    let y = basePosition + scrollOffset;
    const x = width / 2;

    for (const line of lines) {
      if (line !== '') renderCtx.fillText(line, x, y);
      y += lineHeight;
    }

    renderAnimation = requestAnimationFrame(draw);
  };

  draw(); 
  return renderStream;
}

function stopCanvasRendering() {
  if (renderAnimation) cancelAnimationFrame(renderAnimation);
  renderAnimation = null;
  if (renderStream) {
    renderStream.getTracks().forEach(track => track.stop());
    renderStream = null;
  }
}

async function startRecording() {
  try {
    if (!cameraStream && activeMode === 'live') await startCamera(); 

    let stream;

    if (activeMode === 'live') {
      stream = cameraStream;
    } else {
      if (!videoPreview.src) {
        alert('Aucune vidéo importée.');
        return;
      }

      await ensureMic(); 
      videoPreview.controls = false;
      videoPreview.currentTime = 0;
      await videoPreview.play(); 

      const canvasStream = startCanvasRendering(); 
      stream = new MediaStream(); 
      canvasStream.getVideoTracks().forEach(track => stream.addTrack(track)); 
      micStream.getAudioTracks().forEach(track => stream.addTrack(track)); 

      videoPreview.onended = () => stopRecording(); 
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); 

    recordedChunks = [];
    recordedBlob = null;

    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }

    setDownloadReady(false);

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      if (recordedChunks.length > 0) {
        recordedBlob = new Blob(recordedChunks, { type: 'video/webm' }); 
        setDownloadReady(true);
        alert('Vidéo prête. Appuie sur Télécharger.');
      }

      stopCanvasRendering(); 
      stopRecordingTimer(); 
      mediaRecorder = null;
    };

    mediaRecorder.start(1000);
    startRecordingTimer(); 
    startPrompter(); 
  } catch (error) {
    alert(error.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); 
  else stopRecordingTimer(); 
}

function downloadRecording() {
  if (!recordedBlob) {
    alert('Aucune vidéo enregistrée.');
    return;
  }
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
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
  target?.classList.toggle('mirror');
}

function loadVideo(file) {
  if (!file) return;
  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
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
videoInput?.addEventListener('change', (event) => loadVideo(event.target.files[0]));
qualitySelect?.addEventListener('change', () => { if (cameraStream) startCamera(); }); 
formatSelect?.addEventListener('change', applyFormat);

if (scriptInput) {
  scriptInput.value = localStorage.getItem('grok_script') || '';
  scriptInput.addEventListener('input', updatePrompterText);
}

sizeInput?.addEventListener('input', applyTextSize);
positionSlider?.addEventListener('input', (event) => setBasePosition(event.target.value)); 

startBtn?.addEventListener('click', startPrompter);
recordBtn?.addEventListener('click', startRecording);
stopRecordBtn?.addEventListener('click', stopRecording);
pauseBtn?.addEventListener('click', togglePause);
resetBtn?.addEventListener('click', resetPrompter);
mirrorBtn?.addEventListener('click', toggleMirror);
downloadBtn?.addEventListener('click', downloadRecording);
moveUpBtn?.addEventListener('click', () => setBasePosition(basePosition + 50)); 
moveDownBtn?.addEventListener('click', () => setBasePosition(basePosition - 50)); 

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
}); 

window.onload = () => {
  updatePrompterText(); 
  applyTextSize(); 
  applyPosition(); 
  applyFormat(); 
  switchMode('live'); 
  setDownloadReady(false); 
  stopRecordingTimer(); 
};
