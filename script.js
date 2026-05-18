const $ = (id) => document.getElementById(id);

// =====================================================
// ELEMENTS
// =====================================================
const modeLiveBtn = $("modeLiveBtn");
const modeVideoBtn = $("modeVideoBtn");

const cameraPreview = $("cameraPreview");
const importedVideo = $("importedVideo");

const cameraBtn = $("cameraBtn");
const flipBtn = $("flipBtn");
const mirrorLiveBtn = $("mirrorLiveBtn");
const mirrorVideoBtn = $("mirrorVideoBtn");

const videoInput = $("videoInput");

const playBtn = $("playBtn");
const pauseBtn = $("pauseBtn");
const stopVideoBtn = $("stopVideoBtn");

const recordBtn = $("recordBtn");
const stopBtn = $("stopBtn");
const recordTimer = $("recordTimer");
const downloadLink = $("downloadLink");

const speedRange = $("speedRange");
const sizeRange = $("sizeRange");

const scriptInput = $("scriptInput");
const applyTextBtn = $("applyTextBtn");
const upBtn = $("upBtn");
const downBtn = $("downBtn");

const teleprompterText = $("teleprompterText");

// =====================================================
// VARIABLES
// =====================================================
let activeMode = "live";          // live | video
let facingMode = "user";          // user | environment
let cameraStream = null;
let activeVideoUrl = null;

let mediaRecorder = null;
let recordedChunks = [];

let scrollInterval = null;
let scrollPaused = false;
let scrollOffset = 0;
let baseOffset = Number(localStorage.getItem("teleprompter_base_offset") || 0);

let recordInterval = null;
let recordSeconds = 0;

// =====================================================
// UTILITAIRES
// =====================================================
function save(key, value) {
  localStorage.setItem(key, String(value));
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// =====================================================
// CAMERA
// =====================================================
function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  if (cameraPreview) {
    cameraPreview.pause?.();
    cameraPreview.srcObject = null;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Caméra non disponible.");
    return;
  }

  try {
    stopCameraStream();

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode }
      },
      audio: true
    });

    setMode("live");

    cameraPreview.srcObject = cameraStream;
    await cameraPreview.play().catch(() => {});
  } catch (error) {
    alert("Impossible d'accéder à la caméra.");
  }
}

function flipCamera() {
  facingMode = facingMode === "user" ? "environment" : "user";
  startCamera();
}

// =====================================================
// MODES
// =====================================================
function setMode(mode) {
  activeMode = mode;

  const isLive = mode === "live";

  if (modeLiveBtn) modeLiveBtn.classList.toggle("active", isLive);
  if (modeVideoBtn) modeVideoBtn.classList.toggle("active", !isLive);

  if (cameraPreview) {
    cameraPreview.hidden = !isLive;
    cameraPreview.style.display = isLive ? "block" : "none";
  }

  if (importedVideo) {
    if (isLive) importedVideo.pause();
    importedVideo.hidden = isLive;
    importedVideo.style.display = isLive ? "none" : "block";
  }

  // En mode vidéo, on arrête toujours la caméra
  if (!isLive) {
    stopCameraStream();
  }
}

// =====================================================
// IMPORT VIDEO ANDROID
// =====================================================
function openVideoPicker() {
  setMode("video");

  setTimeout(() => {
    try {
      if (typeof videoInput.showPicker === "function") {
        videoInput.showPicker();
      } else {
        videoInput.click();
      }
    } catch (e) {
      videoInput.click();
    }
  }, 100);
}

function loadVideo(file) {
  if (!file || !importedVideo) return;

  // Supprimer l'ancienne URL
  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
    activeVideoUrl = null;
  }

  // Créer une nouvelle URL locale
  activeVideoUrl = URL.createObjectURL(file);

  // Arrêter totalement la caméra
  stopCameraStream();

  // Basculer en mode vidéo
  setMode("video");

  // Réinitialiser le lecteur vidéo
  importedVideo.pause();
  importedVideo.removeAttribute("src");
  importedVideo.load();

  // Configuration
  importedVideo.src = activeVideoUrl;
  importedVideo.muted = true;
  importedVideo.playsInline = true;
  importedVideo.preload = "auto";
  importedVideo.controls = false;
  importedVideo.currentTime = 0;

  // Afficher le lecteur
  importedVideo.hidden = false;
  importedVideo.style.display = "block";

  // Masquer totalement la caméra
  if (cameraPreview) {
    cameraPreview.hidden = true;
    cameraPreview.style.display = "none";
    cameraPreview.srcObject = null;
  }

  // Android : forcer la génération de la première image
  importedVideo.onloadeddata = async () => {
    try {
      importedVideo.currentTime = 0;
      await importedVideo.play();

      setTimeout(() => {
        importedVideo.pause();
        importedVideo.currentTime = 0;
      }, 100);
    } catch (e) {
      importedVideo.currentTime = 0;
    }
  };

  importedVideo.oncanplay = () => {
    importedVideo.currentTime = 0;
  };

  importedVideo.onerror = () => {
    alert("Impossible de charger cette vidéo.");
  };

  importedVideo.load();

  // Important : permet de re-sélectionner la même vidéo plus tard
  if (videoInput) {
    videoInput.value = "";
  }
}

// =====================================================
// TELEPROMPTEUR - EXTRACTION JSON
// =====================================================
function extractScriptText(rawText) {
  const text = (rawText || "").trim();

  if (!text) {
    return "Colle ton texte ici...";
  }

  try {
    // Nettoyage éventuel des balises ```json
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    if (typeof parsed === "string") {
      return parsed;
    }

    if (typeof parsed.script === "string") {
      return parsed.script;
    }

    if (typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch (e) {
    // Ce n'est pas du JSON, on garde le texte brut
  }

  return text;
}

function updateTeleprompterText() {
  const raw = scriptInput ? scriptInput.value : "";
  const finalText = extractScriptText(raw);

  if (teleprompterText) {
    teleprompterText.textContent = finalText;
  }

  save("teleprompter_script", raw);
}
