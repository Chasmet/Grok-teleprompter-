 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/script.js b/script.js
index b9348acbe5cc2c592e4639b650be1052f0b90d16..667de371f12c3e0cb6b37fa1ca441e355a64e1f7 100644
--- a/script.js
+++ b/script.js
@@ -17,88 +17,114 @@ const recordBtn = $('recordBtn');
 const stopBtn = $('stopBtn');
 const recordTimer = $('recordTimer');
 const downloadLink = $('downloadLink');
 const speedRange = $('speedRange');
 const sizeRange = $('sizeRange');
 const scriptInput = $('scriptInput');
 const applyTextBtn = $('applyTextBtn');
 const upBtn = $('upBtn');
 const downBtn = $('downBtn');
 const teleprompterText = $('teleprompterText');
 const teleprompterContainer = $('teleprompterContainer');
 const livePanel = $('livePanel');
 const videoPanel = $('videoPanel');
 
 // État global
 let activeMode = 'live';
 let facingMode = 'user';
 let cameraStream = null;
 let micStream = null;
 let importedVideoFile = null;
 let importedVideoUrl = null;
 let recorder = null;
 let recordedBlob = null;
 let recordingStart = null;
 let timerInterval = null;
+let isRecording = false;
+let downloadUrl = null;
+let importedVideoRecordingStartTime = 0;
+let lastRecordingDuration = 0;
+let recordingMode = null;
 
 // Téléprompteur
 let scrollY = 0;
 let baseOffset = Number(localStorage.getItem('teleprompter_base_offset') || 0);
 let scrollSpeed = 3;
 let scrolling = false;
 let animationFrame = null;
 let lastTimestamp = 0;
 
 // FFmpeg
 let ffmpeg = null;
 
 function save(key, value) {
   localStorage.setItem(key, String(value));
 }
 
 function formatTime(seconds) {
   const m = String(Math.floor(seconds / 60)).padStart(2, '0');
   const s = String(seconds % 60).padStart(2, '0');
   return `${m}:${s}`;
 }
 
 function setDownload(blob, filename, label) {
-  const url = URL.createObjectURL(blob);
-  downloadLink.href = url;
+  if (downloadUrl) {
+    URL.revokeObjectURL(downloadUrl);
+  }
+
+  downloadUrl = URL.createObjectURL(blob);
+  downloadLink.href = downloadUrl;
   downloadLink.download = filename;
   downloadLink.textContent = label;
   downloadLink.hidden = false;
 }
 
 function applyMirror(video) {
   if (video) video.classList.toggle('mirrored');
 }
 
 function stopStream(stream) {
   if (stream) stream.getTracks().forEach(track => track.stop());
 }
 
+function setRecordingState(recording) {
+  isRecording = recording;
+  recordBtn.disabled = recording;
+  stopBtn.disabled = !recording;
+}
+
+function resetDownload() {
+  if (downloadUrl) {
+    URL.revokeObjectURL(downloadUrl);
+    downloadUrl = null;
+  }
+
+  downloadLink.removeAttribute('href');
+  downloadLink.removeAttribute('download');
+  downloadLink.hidden = true;
+}
+
 function setMode(mode) {
   activeMode = mode;
   const isLive = mode === 'live';
 
   modeLiveBtn.classList.toggle('active', isLive);
   modeVideoBtn.classList.toggle('active', !isLive);
 
   cameraPreview.hidden = !isLive;
   importedVideo.hidden = isLive;
 
   livePanel.hidden = !isLive;
   videoPanel.hidden = isLive;
 
   if (!isLive) {
     stopStream(cameraStream);
     cameraStream = null;
     cameraPreview.srcObject = null;
   }
 }
 
 async function startCamera() {
   try {
     stopStream(cameraStream);
 
     cameraStream = await navigator.mediaDevices.getUserMedia({
@@ -206,182 +232,231 @@ function stopScroll() {
 
   if (animationFrame) {
     cancelAnimationFrame(animationFrame);
     animationFrame = null;
   }
 
   lastTimestamp = 0;
 }
 
 function toggleScroll() {
   if (scrolling) {
     stopScroll();
   } else {
     startScroll();
   }
 }
 
 function moveText(delta) {
   baseOffset += delta;
   save('teleprompter_base_offset', baseOffset);
   updateTeleprompterText();
 }
 
 function startTimer() {
   recordingStart = Date.now();
+  recordTimer.textContent = '00:00';
 
   timerInterval = setInterval(() => {
     const seconds = Math.floor((Date.now() - recordingStart) / 1000);
     recordTimer.textContent = formatTime(seconds);
   }, 1000);
 }
 
 function stopTimer() {
   clearInterval(timerInterval);
+  timerInterval = null;
 }
 
 async function startRecording() {
+  if (isRecording) return;
+
+  if (typeof RecordRTC === 'undefined') {
+    alert("La bibliothèque d'enregistrement n'est pas disponible. Vérifie ta connexion puis recharge la page.");
+    return;
+  }
+
   try {
-    downloadLink.hidden = true;
+    resetDownload();
     recordedBlob = null;
+    lastRecordingDuration = 0;
+    recordingMode = activeMode;
 
-    if (activeMode === 'live') {
-      if (!cameraStream) await startCamera(); 
+    if (recordingMode === 'live') {
+      if (!cameraStream) await startCamera();
+
+      if (!cameraStream) {
+        throw new Error('Flux caméra indisponible.');
+      }
 
       recorder = new RecordRTC(cameraStream, {
         type: 'video',
         mimeType: 'video/webm'
       });
     } else {
-      const mic = await getMicrophoneStream(); 
+      if (!importedVideoFile) {
+        recordingMode = null;
+        alert("Importe une vidéo avant de lancer l'enregistrement.");
+        return;
+      }
+
+      const mic = await getMicrophoneStream();
+      importedVideoRecordingStartTime = importedVideo.currentTime || 0;
 
-      if (importedVideoFile && importedVideo.paused) {
+      if (importedVideo.paused) {
         await importedVideo.play().catch(() => {});
       }
 
       recorder = new RecordRTC(mic, {
         type: 'audio',
         mimeType: 'audio/webm'
       });
     }
 
-    recorder.startRecording(); 
-    startTimer(); 
+    recorder.startRecording();
+    setRecordingState(true);
+    startTimer();
   } catch (error) {
     console.error(error);
-    alert('Impossible de démarrer l\'enregistrement.');
+    setRecordingState(false);
+    recordingMode = null;
+    alert("Impossible de démarrer l'enregistrement.");
   }
 }
 
 async function ensureFFmpeg() {
   if (ffmpeg) return ffmpeg;
 
   const FFmpegClass = window.FFmpegWASM?.FFmpeg || window.FFmpeg?.FFmpeg;
   const fetchFile = window.FFmpegUtil?.fetchFile || window.fetchFile;
 
   if (!FFmpegClass || !fetchFile) {
     throw new Error('FFmpeg.wasm non disponible.');
   }
 
   ffmpeg = new FFmpegClass();
   await ffmpeg.load(); 
   ffmpeg._fetchFile = fetchFile;
 
   return ffmpeg;
 }
 
-async function mergeVideoAndAudio(videoFile, audioBlob) {
+async function mergeVideoAndAudio(videoFile, audioBlob, startTime = 0, duration = 0) {
   const ff = await ensureFFmpeg(); 
   const fetchFile = ff._fetchFile;
 
   await ff.writeFile('video.mp4', await fetchFile(videoFile));
   await ff.writeFile('audio.webm', await fetchFile(audioBlob));
 
-  await ff.exec([
+  const ffmpegArgs = [
+    '-ss', String(Math.max(0, startTime)),
+  ];
+
+  if (duration > 0) {
+    ffmpegArgs.push('-t', String(duration));
+  }
+
+  ffmpegArgs.push(
     '-i', 'video.mp4',
     '-i', 'audio.webm',
     '-c:v', 'copy',
     '-c:a', 'aac',
     '-shortest',
     'output.mp4'
-  ]);
+  );
+
+  await ff.exec(ffmpegArgs);
 
   const data = await ff.readFile('output.mp4');
   return new Blob([data.buffer], { type: 'video/mp4' });
 }
 
 async function stopRecording() {
-  if (!recorder) return;
+  if (!recorder || !isRecording) return;
 
-  stopTimer(); 
+  lastRecordingDuration = recordingStart ? (Date.now() - recordingStart) / 1000 : 0;
+  stopTimer();
+  setRecordingState(false);
 
   recorder.stopRecording(async () => {
     try {
-      recordedBlob = recorder.getBlob(); 
+      recordedBlob = recorder.getBlob();
 
-      if (activeMode === 'video' && importedVideoFile) {
+      if (recordingMode === 'video' && importedVideoFile) {
+        importedVideo.pause();
         downloadLink.textContent = 'Fusion en cours...';
         downloadLink.hidden = false;
 
-        const finalBlob = await mergeVideoAndAudio(importedVideoFile, recordedBlob);
+        const finalBlob = await mergeVideoAndAudio(
+          importedVideoFile,
+          recordedBlob,
+          importedVideoRecordingStartTime,
+          lastRecordingDuration
+        );
 
         setDownload(
           finalBlob,
-          `teleprompter-final-${Date.now()}.mp4`, 
+          `teleprompter-final-${Date.now()}.mp4`,
           'Télécharger la vidéo finale'
         );
       } else {
         setDownload(
           recordedBlob,
-          `teleprompter-live-${Date.now()}.webm`, 
+          `teleprompter-live-${Date.now()}.webm`,
           'Télécharger la vidéo'
         );
       }
     } catch (error) {
       console.error(error);
       alert('Erreur pendant la fusion vidéo/audio.');
-      downloadLink.hidden = true;
+      resetDownload();
+    } finally {
+      if (recordingMode === 'video') {
+        stopStream(micStream);
+        micStream = null;
+      }
+
+      recorder = null;
+      recordingMode = null;
     }
   });
 }
 
 modeLiveBtn.addEventListener('click', startCamera);
 modeVideoBtn.addEventListener('click', openVideoPicker);
 cameraBtn.addEventListener('click', startCamera);
 flipBtn.addEventListener('click', flipCamera);
 mirrorLiveBtn.addEventListener('click', () => applyMirror(cameraPreview));
 mirrorVideoBtn.addEventListener('click', () => applyMirror(importedVideo));
 videoInput.addEventListener('change', (e) => loadVideo(e.target.files[0]));
 playBtn.addEventListener('click', () => importedVideo.play());
 pauseBtn.addEventListener('click', () => importedVideo.pause());
 stopVideoBtn.addEventListener('click', () => {
   importedVideo.pause();
   importedVideo.currentTime = 0;
 }); 
 recordBtn.addEventListener('click', startRecording);
 stopBtn.addEventListener('click', stopRecording);
 applyTextBtn.addEventListener('click', toggleScroll);
 upBtn.addEventListener('click', () => moveText(-20));
 downBtn.addEventListener('click', () => moveText(20));
 scriptInput.addEventListener('input', updateTeleprompterText);
 sizeRange.addEventListener('input', updateTeleprompterText);
 speedRange.addEventListener('input', () => {
   scrollSpeed = Number(speedRange.value);
 }); 
 
 (function init() {
   scriptInput.value = localStorage.getItem('teleprompter_script') || scriptInput.value;
 
-  downloadLink.hidden = true;
+  resetDownload();
+  setRecordingState(false);
 
   // Réinitialisation complète du téléprompteur au démarrage.
   scrollY = 0;
   scrolling = false;
   stopScroll(); 
 
   setMode('live');
   updateTeleprompterText(); 
 
-  setTimeout(() => {
-    startCamera().catch?.(() => {});
-  }, 500);
 })(); 
 
EOF
)
