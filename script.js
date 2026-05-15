let stream = null, mediaRecorder = null, chunks = [];
let prompterInterval = null, isPaused = false, speed = 1.8, isMirrored = false;

const preview = document.getElementById('preview');
const uploaded = document.getElementById('uploaded-video');
const prompter = document.getElementById('prompter');
const prompterText = document.getElementById('prompter-text');
const scriptArea = document.getElementById('script');
const speedSlider = document.getElementById('speed-slider');
const sizeSlider = document.getElementById('size-slider');

async function startCamera() {
    try {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "user"}, audio: true});
        preview.srcObject = stream;
        preview.style.display = 'block';
        uploaded.style.display = 'none';
        return true;
    } catch(e) {
        alert("✅ Autorise Caméra + Micro dans les paramètres du navigateur (chrome://settings/content/camera)");
        return false;
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
    uploaded.src = URL.createObjectURL(file);
    uploaded.style.display = 'block';
    preview.style.display = 'none';
    uploaded.play();
}

function startPrompter() {
    const text = scriptArea.value.trim();
    if (!text) return alert("Écris le texte !");
    prompterText.textContent = text;
    prompter.style.display = 'flex';
    let pos = 0;
    clearInterval(prompterInterval);
    prompterInterval = setInterval(() => {
        if (isPaused) return;
        pos += 3.5 * speed;
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
    const t = isMirrored ? 'scaleX(-1)' : 'none';
    preview.style.transform = t;
    uploaded.style.transform = t;
}

async function toggleRecording() {
    const btn = document.getElementById('rec-btn');
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        if (!(await startCamera())) return;
        mediaRecorder = new MediaRecorder(stream, {mimeType: 'video/webm'});
        chunks = [];
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, {type: 'video/webm'});
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `grok-teleprompter-${Date.now()}.webm`;
            a.click();
        };
        mediaRecorder.start();
        btn.textContent = '⏹ STOP';
        btn.style.background = '#0f0';
    } else {
        mediaRecorder.stop();
        btn.textContent = '● REC';
        btn.style.background = '#f00';
    }
}

window.onload = () => {
    switchMode('live');
    speedSlider.oninput = () => speed = +speedSlider.value;
    sizeSlider.oninput = () => prompterText.style.fontSize = sizeSlider.value + 'px';
    if (localStorage.grokScript) scriptArea.value = localStorage.grokScript;
    scriptArea.oninput = () => localStorage.grokScript = scriptArea.value;
};
