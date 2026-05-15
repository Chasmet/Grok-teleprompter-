let stream = null;
let mediaRecorder = null;
let recordedChunks = [];
let prompterInterval = null;
let isPaused = false;
let speed = 1;
let isMirrored = false;

const preview = document.getElementById('preview');
const uploadedVideo = document.getElementById('uploaded-video');
const prompter = document.getElementById('prompter');
const prompterText = document.getElementById('prompter-text');
const scriptArea = document.getElementById('script');
const speedSlider = document.getElementById('speed-slider');
const sizeSlider = document.getElementById('size-slider');

async function startCamera() {
    try {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user" }, 
            audio: true 
        });
        preview.srcObject = stream;
        preview.style.display = 'block';
        uploadedVideo.style.display = 'none';
    } catch(e) {
        alert("Caméra refusée ou non disponible");
    }
}

function switchMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    if (mode === 'live') {
        document.getElementById('live-btn').classList.add('active');
        startCamera();
    } else {
        document.getElementById('video-btn').classList.add('active');
    }
}

function loadVideo(input) {
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    uploadedVideo.src = url;
    uploadedVideo.style.display = 'block';
    preview.style.display = 'none';
    uploadedVideo.play();
}

function startPrompter() {
    const text = scriptArea.value.trim();
    if (!text) return alert("Écris un script d’abord !");
    
    prompterText.textContent = text;
    prompter.style.display = 'flex';
    
    let pos = 0;
    clearInterval(prompterInterval);
    prompterInterval = setInterval(() => {
        if (isPaused) return;
        pos += 3 * speed;
        prompterText.style.transform = `translateY(-${pos}px)`;
    }, 16);
}

function togglePause() { isPaused = !isPaused; }
function resetPrompter() {
    clearInterval(prompterInterval);
    prompter.style.display = 'none';
    prompterText.style.transform = 'none';
}

function toggleMirror() {
    isMirrored = !isMirrored;
    preview.style.transform = isMirrored ? 'scaleX(-1)' : 'none';
    uploadedVideo.style.transform = isMirrored ? 'scaleX(-1)' : 'none';
}

async function toggleRecording() {
    const btn = document.getElementById('rec-btn');
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        if (!stream) await startCamera();
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `grok-video-${Date.now()}.webm`;
            a.click();
        };
        
        mediaRecorder.start();
        btn.textContent = '⏹ STOP';
        btn.style.background = '#00ff00';
    } else {
        mediaRecorder.stop();
        btn.textContent = '● REC';
        btn.style.background = '#ff0000';
    }
}

function downloadScript() {
    const text = scriptArea.value;
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'script.txt';
    a.click();
}

// Initialisation
window.onload = () => {
    startCamera(); // caméra par défaut
    speedSlider.oninput = () => speed = parseFloat(speedSlider.value);
    sizeSlider.oninput = () => prompterText.style.fontSize = sizeSlider.value + 'px';
    
    // Sauvegarde auto
    if (localStorage.grokScript) scriptArea.value = localStorage.grokScript;
    scriptArea.oninput = () => localStorage.grokScript = scriptArea.value;
};
