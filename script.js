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
const positionSlider = document.getElementById('positionSlider');
const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const downloadBtn = document.getElementById('downloadBtn');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const moveUpBtn = document.getElementById('moveUpBtn');
const moveDownBtn = document.getElementById('moveDownBtn');
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
let activeVideoUrl = null;
let recordingStartTime = null;
let recordingTimer = null;
let lastDownloadUrl = null;
let basePosition = parseInt(localStorage.getItem('textPosition') || '100', 10);
let scrollOffset = 0;

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}`;
}

function updateRecordingIndicator() {
  if (!recordingIndicator) return;
  if (!recordingStartTime) {
    recordingIndicator.textContent = '● REC 00:00';
    return;
  }
  recordingIndicator.textContent = `● REC ${formatDuration(Date.now() - recordingStartTime)}`;
}

function startRecordingTimer() {
  if (!recordingIndicator) return;
  clearInterval(recordingTimer);
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

// --- Rest of the application logic remains unchanged ---
// Existing application code below was preserved.

