const scriptInput = document.getElementById('scriptInput');
const teleprompter = document.getElementById('teleprompter');
const container = document.getElementById('teleprompterContainer');
const speedInput = document.getElementById('speed');
const fontSizeInput = document.getElementById('fontSize');
const videoInput = document.getElementById('videoInput');
const backgroundVideo = document.getElementById('backgroundVideo');

let position = container.clientHeight;
let interval = null;
let paused = false;

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
