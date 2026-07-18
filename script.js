(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const elements = {
    stage: $('stage'), viewer: $('viewer'), empty: $('empty'), mediaVideo: $('mediaVideo'),
    mediaImage: $('mediaImage'), cameraVideo: $('cameraVideo'), faceFrame: $('faceFrame'),
    faceResizeHandle: $('faceResizeHandle'), mediaInput: $('mediaInput'),
    download: $('download'), status: $('status'), timer: $('timer'), teleprompter: $('teleprompter'),
    teleText: $('teleText'), scriptInput: $('scriptInput'), speedRange: $('speedRange'),
    sizeRange: $('sizeRange'), liveTab: $('liveTab'), mediaTab: $('mediaTab'), faceTab: $('faceTab'),
    recBtn: $('recBtn'), stopBtn: $('stopBtn'), cameraBtn: $('cameraBtn'), flipBtn: $('flipBtn'),
    mirrorBtn: $('mirrorBtn'), playBtn: $('playBtn'), pauseBtn: $('pauseBtn'), audioMode: $('audioMode'),
    videoQuality: $('videoQuality'), includeMicrophone: $('includeMicrophone'),
    includeMediaAudio: $('includeMediaAudio'), micVolumeRange: $('micVolumeRange'),
    mediaVolumeRange: $('mediaVolumeRange'), micVolumeValue: $('micVolumeValue'),
    mediaVolumeValue: $('mediaVolumeValue'), microphoneToggleLabel: $('microphoneToggleLabel'),
    mediaAudioToggleLabel: $('mediaAudioToggleLabel'), activateMicBtn: $('activateMicBtn'),
    microphoneHelp: $('microphoneHelp'), microphoneHelpText: $('microphoneHelpText'),
    retryMicrophoneBtn: $('retryMicrophoneBtn'), microphoneSettingsBtn: $('microphoneSettingsBtn'),
    audioMeter: $('audioMeter'),
    audioPeak: $('audioPeak'), audioLabel: $('audioLabel'), recordQuality: $('recordQuality'),
    cameraHelp: $('cameraHelp'), cameraHelpText: $('cameraHelpText'), retryCameraBtn: $('retryCameraBtn'),
    cameraSettingsBtn: $('cameraSettingsBtn'), teleMoveHandle: $('teleMoveHandle'),
    teleResizeHandle: $('teleResizeHandle'), teleScrollState: $('teleScrollState'),
    textUpBtn: $('textUpBtn'), textDownBtn: $('textDownBtn'), textSmallerBtn: $('textSmallerBtn'),
    textLargerBtn: $('textLargerBtn'), resetLayoutBtn: $('resetLayoutBtn')
  };

  const DEFAULT_FACE = { x: .05, y: .05, w: .36, h: .25 };
  const DEFAULT_TELE_BOX = { x: .05, y: .09, w: .90, h: .72 };

  const state = {
    mode: 'facecam', mediaType: '', mediaWidth: 720, mediaHeight: 1280, mediaUrl: '',
    cameraStream: null, micOnlyStream: null, resumeCamera: false, recorder: null, chunks: [], recordingBlob: null,
    recordingName: '', timerId: 0, startedAt: 0, renderId: 0, wakeLock: null,
    audioGraph: null, audioMeterId: 0, microphoneStarting: false, microphonePromise: null, micLastError: null,
    recordingStarting: false,
    facingMode: 'user', mirrored: true,
    face: { ...DEFAULT_FACE }, facePointers: new Map(), faceGesture: null,
    teleBox: { ...DEFAULT_TELE_BOX }, telePointers: new Map(), teleGesture: null,
    teleShouldScroll: false,
    mediaView: { scale: 1, x: 0, y: 0 }, viewPointers: new Map(), pinchStart: null,
    panStart: null, lastTap: 0,
    teleRaf: 0, teleStartedAt: 0, teleRunning: false, downloadUrl: ''
  };

  const AUDIO_PROFILES = {
    studio: { label: 'Voix studio', echoCancellation: true, noiseSuppression: true, autoGainControl: true, channels: 1, highpass: 75, presence: 2.8, threshold: -24, ratio: 3.2, gain: 1.08 },
    natural: { label: 'Voix naturelle', echoCancellation: true, noiseSuppression: true, autoGainControl: false, channels: 1, highpass: 55, presence: 1.2, threshold: -20, ratio: 2.2, gain: 1.02 },
    music: { label: 'Musique / chant', echoCancellation: false, noiseSuppression: false, autoGainControl: false, channels: 2, highpass: 30, presence: .5, threshold: -14, ratio: 1.6, gain: 1 }
  };

  function showStatus(message, isError = false, timeout = 2800) {
    elements.status.textContent = message;
    elements.status.style.color = isError ? '#f87171' : '#34d399';
    elements.status.style.display = 'block';
    clearTimeout(elements.status._timer);
    elements.status._timer = setTimeout(() => { elements.status.style.display = 'none'; }, timeout);
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const selectedProfile = () => AUDIO_PROFILES[elements.audioMode.value] || AUDIO_PROFILES.studio;
  const wantsMicrophone = () => elements.includeMicrophone.checked;
  const microphoneVolume = () => clamp(Number(elements.micVolumeRange.value) || 0, 0, 200) / 100;
  const mediaVolume = () => clamp(Number(elements.mediaVolumeRange.value) || 0, 0, 100) / 100;
  const liveTracks = (stream, kind) => stream?.getTracks().filter((track) => track.kind === kind && track.readyState === 'live') || [];
  const hasLiveCamera = () => liveTracks(state.cameraStream, 'video').length > 0;
  const hasLiveMicrophone = () => liveTracks(state.micOnlyStream, 'audio').length > 0;

  function audioConstraints() {
    const profile = selectedProfile();
    return {
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 24 },
      channelCount: { ideal: profile.channels },
      echoCancellation: { ideal: profile.echoCancellation },
      noiseSuppression: { ideal: profile.noiseSuppression },
      autoGainControl: { ideal: profile.autoGainControl },
      latency: { ideal: .01 }
    };
  }

  function videoConstraints() {
    const high = elements.videoQuality.value === '1080';
    return {
      facingMode: { ideal: state.facingMode },
      width: { ideal: high ? 1920 : 1280 },
      height: { ideal: high ? 1080 : 720 },
      frameRate: { ideal: 30, max: 30 }
    };
  }

  function updateAudioLabel() {
    const profile = selectedProfile();
    const track = liveTracks(state.micOnlyStream, 'audio')[0] || liveTracks(state.cameraStream, 'audio')[0];
    if (!wantsMicrophone()) {
      elements.audioLabel.textContent = `${profile.label} · micro coupé volontairement`;
      elements.activateMicBtn.textContent = 'Réactiver le micro';
      return;
    }
    if (!track) {
      elements.audioLabel.textContent = `${profile.label} · aucun micro actif`;
      elements.activateMicBtn.textContent = state.microphoneStarting ? 'Ouverture du micro…' : 'Activer / tester le micro';
      return;
    }
    const settings = track.getSettings ? track.getSettings() : {};
    const rate = settings.sampleRate ? `${Math.round(settings.sampleRate / 1000)} kHz` : 'haute qualité';
    const channels = settings.channelCount === 2 ? 'stéréo' : 'mono';
    elements.audioLabel.textContent = `${profile.label} · ${rate} · ${channels}`;
    elements.activateMicBtn.textContent = 'Micro actif · tester ma voix';
  }

  function updateMixerUi() {
    const micPercent = Math.round(microphoneVolume() * 100);
    const videoPercent = elements.includeMediaAudio.checked ? Math.round(mediaVolume() * 100) : 0;
    elements.microphoneToggleLabel.textContent = wantsMicrophone() ? '🎙 Micro : ON' : '🔇 Micro : OFF';
    elements.mediaAudioToggleLabel.textContent = elements.includeMediaAudio.checked ? '🔊 Son vidéo : ON' : '🔇 Son vidéo : OFF';
    elements.micVolumeValue.textContent = `${micPercent} %`;
    elements.mediaVolumeValue.textContent = `${videoPercent} %`;
    elements.micVolumeRange.disabled = !wantsMicrophone();
    elements.mediaVolumeRange.disabled = !elements.includeMediaAudio.checked;
    updateAudioLabel();
  }

  function updateMirror() {
    const enabled = state.facingMode === 'user' && state.mirrored;
    elements.cameraVideo.classList.toggle('mirrored', enabled);
    elements.mirrorBtn.textContent = `Miroir : ${state.mirrored ? 'ON' : 'OFF'}`;
  }

  function updateTabs() {
    elements.liveTab.classList.toggle('active', state.mode === 'live');
    elements.mediaTab.classList.toggle('active', state.mode === 'media');
    elements.faceTab.classList.toggle('active', state.mode === 'facecam');
    document.body.dataset.mode = state.mode;
    const cameraVisible = (state.mode === 'live' || state.mode === 'facecam') && hasLiveCamera();
    elements.faceFrame.classList.toggle('hide', !cameraVisible);
    elements.faceFrame.classList.toggle('liveCamera', state.mode === 'live');
    elements.flipBtn.disabled = !hasLiveCamera();
    elements.mirrorBtn.disabled = !hasLiveCamera();
    for (const id of ['minusBtn', 'plusBtn', 'tlBtn', 'trBtn', 'brBtn']) $(id).disabled = !hasLiveCamera();
    updateTeleVisibility();
    layoutFace();
    layoutTeleprompter();
    updateMirror();
    updateEmptyVisibility();
  }

  function setMode(mode) {
    if (state.recorder && state.recorder.state !== 'inactive') return;
    state.mode = mode;
    state.viewPointers.clear();
    stopTeleprompter(true);
    if (mode === 'live') {
      elements.empty.classList.add('hide');
      elements.mediaVideo.classList.add('hide');
      elements.mediaImage.classList.add('hide');
      setAspect(9, 16);
    } else {
      displayImportedMedia();
    }
    updateTabs();
    updateTeleText(true);
  }

  function setAspect(width, height) {
    state.mediaWidth = Math.max(1, Number(width) || 720);
    state.mediaHeight = Math.max(1, Number(height) || 1280);
    resizeStage();
  }

  function resizeStage() {
    const ratio = state.mediaWidth / state.mediaHeight;
    const maxWidth = Math.max(120, elements.viewer.clientWidth - 20);
    const maxHeight = Math.max(120, elements.viewer.clientHeight - 20);
    let width = maxWidth;
    let height = width / ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    elements.stage.style.width = `${Math.max(120, width)}px`;
    elements.stage.style.height = `${Math.max(120, height)}px`;
    layoutFace();
    clampMediaView();
  }

  function layoutFace() {
    const face = state.face;
    elements.faceFrame.style.left = `${face.x * 100}%`;
    elements.faceFrame.style.top = `${face.y * 100}%`;
    elements.faceFrame.style.width = `${face.w * 100}%`;
    elements.faceFrame.style.height = `${face.h * 100}%`;
  }

  function layoutTeleprompter() {
    const box = state.teleBox;
    elements.teleprompter.style.left = `${box.x * 100}%`;
    elements.teleprompter.style.top = `${box.y * 100}%`;
    elements.teleprompter.style.width = `${box.w * 100}%`;
    elements.teleprompter.style.height = `${box.h * 100}%`;
    if (!state.teleRunning) requestAnimationFrame(updateTeleScrollMode);
  }

  function moveFace(position) {
    const margin = .03;
    if (position === 'tl') { state.face.x = margin; state.face.y = margin; }
    if (position === 'tr') { state.face.x = 1 - state.face.w - margin; state.face.y = margin; }
    if (position === 'br') { state.face.x = 1 - state.face.w - margin; state.face.y = 1 - state.face.h - margin; }
    layoutFace();
    saveScript();
  }

  function resizeFace(delta) {
    state.face.w = clamp(state.face.w + delta, .14, .58);
    state.face.h = clamp(state.face.h + delta * .7, .10, .46);
    state.face.x = clamp(state.face.x, 0, 1 - state.face.w);
    state.face.y = clamp(state.face.y, 0, 1 - state.face.h);
    layoutFace();
    saveScript();
  }

  function applyMediaView() {
    const transform = `translate(${state.mediaView.x}px,${state.mediaView.y}px) scale(${state.mediaView.scale})`;
    for (const media of [elements.mediaVideo, elements.mediaImage]) {
      media.style.transform = transform;
      media.style.transformOrigin = 'center center';
    }
  }

  function clampMediaView() {
    const rect = elements.stage.getBoundingClientRect();
    state.mediaView.scale = clamp(state.mediaView.scale, 1, 5);
    if (state.mediaView.scale <= 1.01) {
      state.mediaView = { scale: 1, x: 0, y: 0 };
    } else {
      const maxX = rect.width * (state.mediaView.scale - 1) / 2;
      const maxY = rect.height * (state.mediaView.scale - 1) / 2;
      state.mediaView.x = clamp(state.mediaView.x, -maxX, maxX);
      state.mediaView.y = clamp(state.mediaView.y, -maxY, maxY);
    }
    applyMediaView();
  }

  function resetMediaView() {
    state.mediaView = { scale: 1, x: 0, y: 0 };
    applyMediaView();
  }

  function pointerDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function pointerCenter(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function displayImportedMedia() {
    elements.mediaImage.classList.toggle('hide', state.mediaType !== 'image');
    elements.mediaVideo.classList.toggle('hide', state.mediaType !== 'video');
    elements.playBtn.disabled = state.mediaType !== 'video';
    elements.pauseBtn.disabled = state.mediaType !== 'video';
    updateEmptyVisibility();
  }

  function updateEmptyVisibility() {
    const promptVisible = teleHasText() && (state.mode === 'live' || state.mode === 'facecam');
    const shouldHide = state.mode === 'live' || Boolean(state.mediaType) || promptVisible || hasLiveCamera();
    elements.empty.classList.toggle('hide', shouldHide);
  }

  function teleHasText() { return Boolean(elements.scriptInput.value.trim()); }
  function updateTeleVisibility() {
    const visible = teleHasText() && (state.mode === 'live' || state.mode === 'facecam');
    elements.teleprompter.classList.toggle('hide', !visible);
    updateEmptyVisibility();
  }
  function updateTeleScrollMode() {
    if (elements.teleprompter.classList.contains('hide')) return false;
    const availableHeight = Math.max(1, elements.teleprompter.clientHeight - 44);
    const preferredSize = clamp(Number(elements.sizeRange.value) || 36, 18, 86);
    elements.teleText.style.fontSize = `${preferredSize}px`;
    let textHeight = Math.max(1, elements.teleText.scrollHeight);
    const wordCount = elements.scriptInput.value.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount <= 34 && textHeight > availableHeight) {
      const fittedSize = clamp(Math.floor(preferredSize * availableHeight / textHeight), 18, preferredSize);
      elements.teleText.style.fontSize = `${fittedSize}px`;
      textHeight = Math.max(1, elements.teleText.scrollHeight);
    }
    state.teleShouldScroll = textHeight > availableHeight;
    elements.teleprompter.dataset.scrollMode = state.teleShouldScroll ? 'scroll' : 'static';
    elements.teleScrollState.textContent = state.teleShouldScroll
      ? 'Texte long : défilement automatique'
      : 'Texte court : reste fixe';
    if (!state.teleRunning) positionTeleTextAtRest();
    return state.teleShouldScroll;
  }
  function positionTeleTextAtRest() {
    const textHeight = Math.max(1, elements.teleText.scrollHeight);
    if (state.teleShouldScroll) {
      elements.teleText.style.top = '55%';
      elements.teleText.style.transform = 'translateY(0px)';
    } else {
      elements.teleText.style.top = '50%';
      elements.teleText.style.transform = `translateY(${-textHeight / 2}px)`;
    }
  }
  function updateTeleText(reset = false) {
    elements.teleText.textContent = elements.scriptInput.value.trim() || 'Écris ton texte ici.';
    elements.teleText.style.fontSize = `${clamp(Number(elements.sizeRange.value) || 36, 18, 86)}px`;
    updateTeleVisibility();
    requestAnimationFrame(() => {
      updateTeleScrollMode();
      if (reset) positionTeleTextAtRest();
    });
  }
  function stopTeleprompter(reset = false) {
    state.teleRunning = false;
    if (state.teleRaf) cancelAnimationFrame(state.teleRaf);
    state.teleRaf = 0;
    if (reset) positionTeleTextAtRest();
  }
  function startTeleprompter() {
    updateTeleText(true);
    if (!teleHasText() || state.mode === 'media') return;
    updateTeleScrollMode();
    if (!state.teleShouldScroll) {
      state.teleRunning = false;
      positionTeleTextAtRest();
      return;
    }
    state.teleRunning = true;
    state.teleStartedAt = performance.now();
    elements.teleText.style.top = '55%';
    const loop = (now) => {
      if (!state.teleRunning) return;
      const speed = 10 + clamp(Number(elements.speedRange.value) || 3, 1, 10) * 9;
      const elapsed = (now - state.teleStartedAt) / 1000;
      const maxMove = Math.max(0, elements.teleText.scrollHeight + elements.teleprompter.clientHeight * .55);
      elements.teleText.style.transform = `translateY(${-Math.min(maxMove, elapsed * speed)}px)`;
      if (elapsed * speed < maxMove) state.teleRaf = requestAnimationFrame(loop);
      else state.teleRunning = false;
    };
    state.teleRaf = requestAnimationFrame(loop);
  }

  function applyTeleFont(value) {
    elements.sizeRange.value = String(clamp(
      Math.round(value),
      Number(elements.sizeRange.min),
      Number(elements.sizeRange.max)
    ));
    updateTeleText(false);
    saveScript();
  }

  async function stopCameraVideo() {
    state.cameraStream?.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    elements.cameraVideo.srcObject = null;
    elements.cameraBtn.textContent = 'Activer la caméra';
    updateTabs();
  }

  async function stopCameraTracks() {
    await stopCameraVideo();
    state.micOnlyStream?.getTracks().forEach((track) => track.stop());
    state.micOnlyStream = null;
    stopLiveMeter();
    updateMixerUi();
  }

  function cameraFailureText(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'L’autorisation caméra est refusée. Appuie sur « Réglages Android », puis autorise Caméra et Microphone.';
    }
    if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
      return 'La caméra est occupée ou bloquée. Ferme Appareil photo, WhatsApp, Grok ou toute autre application utilisant la caméra, puis appuie sur « Réessayer ».';
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return 'Aucune caméra n’a été détectée sur le téléphone.';
    }
    return `Impossible d’ouvrir la caméra (${error?.name || 'erreur inconnue'}). Redémarre l’application puis réessaie.`;
  }

  function showCameraHelp(error) {
    elements.cameraHelpText.textContent = cameraFailureText(error);
    elements.cameraHelp.classList.remove('hide');
    console.error('Échec caméra', error);
  }

  async function cameraConstraintAttempts() {
    const high = elements.videoQuality.value === '1080';
    const attempts = [
      videoConstraints(),
      {
        facingMode: { ideal: state.facingMode },
        width: { ideal: high ? 1280 : 960 },
        height: { ideal: high ? 720 : 540 },
        frameRate: { ideal: 30, max: 30 }
      },
      { facingMode: { ideal: state.facingMode } },
      true
    ];

    if (navigator.mediaDevices.enumerateDevices) {
      try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
        const wanted = state.facingMode === 'user' ? /front|avant|user|face/i : /back|rear|arrière|environment/i;
        devices.sort((a, b) => Number(wanted.test(b.label)) - Number(wanted.test(a.label)));
        for (const device of devices.slice(0, 3)) {
          if (device.deviceId) attempts.push({ deviceId: { exact: device.deviceId } });
        }
      } catch (_) {}
    }
    return attempts;
  }

  async function openCameraVideo() {
    const attempts = await cameraConstraintAttempts();
    let lastError = null;
    for (let index = 0; index < attempts.length; index += 1) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: attempts[index], audio: false });
        if (liveTracks(stream, 'video').length) return stream;
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        lastError = error;
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') break;
        await delay(error.name === 'NotReadableError' ? 450 : 180);
      }
    }
    throw lastError || new Error('CameraUnavailable');
  }

  async function installCameraStream(stream) {
    state.cameraStream = stream;
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = 'motion';
      videoTrack.addEventListener('ended', () => {
        if (state.cameraStream && !hasLiveCamera()) {
          elements.cameraBtn.textContent = 'Réactiver la caméra';
          updateTabs();
        }
      });
    }
    elements.cameraVideo.srcObject = stream;
    await elements.cameraVideo.play();
    elements.cameraBtn.textContent = 'Caméra activée';
    updateTabs();
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showStatus('Caméra non compatible avec cet appareil', true, 4500);
      return;
    }
    elements.cameraBtn.disabled = true;
    elements.cameraBtn.textContent = 'Ouverture…';
    elements.cameraHelp.classList.add('hide');
    await stopCameraVideo();
    await delay(320);
    try {
      state.cameraStream = await openCameraVideo();
    } catch (error) {
      showCameraHelp(error);
      showStatus('Caméra non ouverte · consulte l’aide rouge', true, 5000);
      elements.cameraBtn.disabled = false;
      elements.cameraBtn.textContent = 'Réessayer la caméra';
      updateTabs();
      return;
    }
    try {
      await installCameraStream(state.cameraStream);
    } catch (error) {
      await stopCameraVideo();
      showCameraHelp(error);
      showStatus('La caméra ne peut pas afficher l’image', true, 5000);
      elements.cameraBtn.disabled = false;
      elements.cameraBtn.textContent = 'Réessayer la caméra';
      return;
    }
    elements.cameraBtn.disabled = false;
    const microphone = wantsMicrophone() ? await ensureMicrophone() : null;
    updateAudioLabel();
    if (microphone) startLiveMeter(microphone);
    showStatus(microphone || !wantsMicrophone()
      ? (microphone ? 'Caméra et micro prêts' : 'Caméra prête · micro coupé')
      : 'Caméra prête · micro non disponible', wantsMicrophone() && !microphone, 4200);
  }

  function microphoneFailureText(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'Le microphone est refusé. Appuie sur « Réglages Android », puis autorise Microphone pour cette application.';
    }
    if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
      return 'Le microphone est occupé ou bloqué. Ferme les autres applications utilisant le micro, puis réessaie.';
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return 'Aucun microphone n’a été détecté sur le téléphone.';
    }
    return `Impossible d’ouvrir le microphone (${error?.name || 'erreur inconnue'}).`;
  }

  function showMicrophoneHelp(error) {
    state.micLastError = error;
    elements.microphoneHelpText.textContent = microphoneFailureText(error);
    elements.microphoneHelp.classList.remove('hide');
    updateMixerUi();
    console.error('Échec microphone', error);
  }

  async function openAudioOnly() {
    const profile = selectedProfile();
    const attempts = [
      audioConstraints(),
      {
        channelCount: { ideal: profile.channels },
        echoCancellation: { ideal: profile.echoCancellation },
        noiseSuppression: { ideal: profile.noiseSuppression },
        autoGainControl: { ideal: profile.autoGainControl }
      },
      true
    ];
    let lastError = null;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
        if (liveTracks(stream, 'audio').length) return stream;
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        lastError = error;
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') break;
        await delay(error.name === 'NotReadableError' ? 350 : 120);
      }
    }
    throw lastError || new Error('MicrophoneUnavailable');
  }

  async function recoverCombinedCameraAndMicrophone() {
    if (!hasLiveCamera()) return null;
    const previousCamera = state.cameraStream;
    previousCamera?.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    elements.cameraVideo.srcObject = null;
    await delay(450);
    let combined = null;
    try {
      combined = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: state.facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: audioConstraints()
      });
      const videoTracks = combined.getVideoTracks();
      const audioTracks = combined.getAudioTracks();
      if (!videoTracks.length || !audioTracks.length) throw new Error('CombinedCaptureIncomplete');
      const cameraStream = new MediaStream(videoTracks);
      const microphoneStream = new MediaStream(audioTracks);
      await installCameraStream(cameraStream);
      return microphoneStream;
    } catch (error) {
      combined?.getTracks().forEach((track) => track.stop());
      try {
        const cameraStream = await openCameraVideo();
        await installCameraStream(cameraStream);
      } catch (cameraError) {
        showCameraHelp(cameraError);
      }
      throw error;
    }
  }

  async function openMicrophone() {
    state.microphoneStarting = true;
    updateMixerUi();
    state.micOnlyStream?.getTracks().forEach((track) => track.stop());
    state.micOnlyStream = null;
    let microphone = null;
    try {
      microphone = await openAudioOnly();
    } catch (error) {
      if (hasLiveCamera() && error.name !== 'NotAllowedError' && error.name !== 'SecurityError') {
        try { microphone = await recoverCombinedCameraAndMicrophone(); }
        catch (combinedError) { error = combinedError; }
      }
      if (!microphone) {
        showMicrophoneHelp(error);
        showStatus('Micro indisponible · la vidéo pourra quand même être enregistrée', true, 5200);
        return null;
      }
    } finally {
      state.microphoneStarting = false;
      updateMixerUi();
    }
    state.micOnlyStream = microphone;
    const track = microphone.getAudioTracks()[0];
    if (track) {
      track.enabled = true;
      track.contentHint = elements.audioMode.value === 'music' ? 'music' : 'speech';
      track.addEventListener('ended', () => {
        if (wantsMicrophone()) showMicrophoneHelp(new DOMException('La piste micro s’est arrêtée', 'NotReadableError'));
        updateMixerUi();
      });
    }
    state.micLastError = null;
    elements.microphoneHelp.classList.add('hide');
    updateMixerUi();
    return microphone;
  }

  async function ensureMicrophone() {
    if (!wantsMicrophone()) return null;
    if (hasLiveMicrophone()) return state.micOnlyStream;
    if (!state.microphonePromise) {
      state.microphonePromise = openMicrophone().finally(() => { state.microphonePromise = null; });
    }
    return state.microphonePromise;
  }

  function createContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { return new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' }); }
    catch (_) { return new AudioContextClass(); }
  }

  function connectVoicePipeline(context, inputStream, master) {
    const profile = selectedProfile();
    const source = context.createMediaStreamSource(inputStream);
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = profile.highpass;
    highpass.Q.value = .7;
    const presence = context.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3000;
    presence.Q.value = .8;
    presence.gain.value = profile.presence;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = profile.threshold;
    compressor.knee.value = 18;
    compressor.ratio.value = profile.ratio;
    compressor.attack.value = .005;
    compressor.release.value = .18;
    const gain = context.createGain();
    gain.gain.value = profile.gain * microphoneVolume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .78;
    source.connect(highpass).connect(presence).connect(compressor).connect(gain).connect(analyser).connect(master);
    return analyser;
  }

  function captureMediaAudio() {
    if (state.mode === 'live' || state.mediaType !== 'video' || !elements.includeMediaAudio.checked) return null;
    const capture = elements.mediaVideo.captureStream || elements.mediaVideo.mozCaptureStream;
    if (!capture) return null;
    try {
      const stream = capture.call(elements.mediaVideo);
      return stream.getAudioTracks().length ? stream : null;
    } catch (_) { return null; }
  }

  async function buildAudioGraph() {
    const microphoneRequested = wantsMicrophone();
    // Après un échec déjà signalé, Enregistrer démarre immédiatement. Une
    // nouvelle ouverture du périphérique reste possible avec Réessayer le micro.
    const micStream = microphoneRequested
      ? (hasLiveMicrophone() ? state.micOnlyStream : (state.micLastError ? null : await ensureMicrophone()))
      : null;
    const microphoneUnavailable = microphoneRequested && !micStream;
    const mediaAudio = captureMediaAudio();
    if (!micStream && !mediaAudio) {
      return {
        stream: new MediaStream(), context: null, analyser: null,
        micIncluded: false, mediaIncluded: false, microphoneUnavailable
      };
    }
    const context = createContext();
    if (!context) {
      const fallback = new MediaStream();
      const preferredStream = micStream || mediaAudio;
      preferredStream?.getAudioTracks().forEach((track) => fallback.addTrack(track));
      return {
        stream: fallback,
        context: null,
        analyser: null,
        micIncluded: Boolean(micStream),
        mediaIncluded: Boolean(!micStream && mediaAudio),
        microphoneUnavailable
      };
    }
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = .002;
    limiter.release.value = .08;
    limiter.connect(destination);
    let analyser = null;
    if (micStream) analyser = connectVoicePipeline(context, micStream, limiter);
    if (mediaAudio) {
      const mediaSource = context.createMediaStreamSource(mediaAudio);
      const mediaGain = context.createGain();
      mediaGain.gain.value = mediaVolume();
      mediaSource.connect(mediaGain).connect(limiter);
    }
    return {
      stream: destination.stream,
      context,
      analyser,
      micIncluded: Boolean(micStream),
      mediaIncluded: Boolean(mediaAudio),
      microphoneUnavailable
    };
  }

  function meterLoop(analyser) {
    cancelAnimationFrame(state.audioMeterId);
    if (!analyser) return;
    const values = new Uint8Array(analyser.fftSize);
    const update = () => {
      analyser.getByteTimeDomainData(values);
      let sum = 0;
      for (const value of values) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / values.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      elements.audioMeter.value = clamp((db + 55) / 50, 0, 1);
      elements.audioPeak.textContent = `${Math.round(Math.max(-60, db))} dB`;
      state.audioMeterId = requestAnimationFrame(update);
    };
    update();
  }

  function stopLiveMeter() {
    cancelAnimationFrame(state.audioMeterId);
    state.audioMeterId = 0;
    if (state.audioGraph?.context) state.audioGraph.context.close().catch(() => {});
    state.audioGraph = null;
    elements.audioMeter.value = 0;
    elements.audioPeak.textContent = '— dB';
  }

  function startLiveMeter(stream) {
    stopLiveMeter();
    const context = createContext();
    if (!context || !stream?.getAudioTracks().length) return;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .78;
    context.createMediaStreamSource(stream).connect(analyser);
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    analyser.connect(silentOutput).connect(context.destination);
    context.resume().catch(() => {});
    state.audioGraph = { context, analyser, silentOutput, meterOnly: true };
    meterLoop(analyser);
  }

  function drawContained(context, source, x, y, width, height) {
    const sourceWidth = source.videoWidth || source.naturalWidth || width;
    const sourceHeight = source.videoHeight || source.naturalHeight || height;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function drawCovered(context, source, x, y, width, height, mirror = false) {
    const sourceWidth = source.videoWidth || source.naturalWidth || width;
    const sourceHeight = source.videoHeight || source.naturalHeight || height;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const cropWidth = width / scale;
    const cropHeight = height / scale;
    context.save();
    if (mirror) {
      context.translate(x + width, y);
      context.scale(-1, 1);
      context.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, width, height);
    } else {
      context.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, x, y, width, height);
    }
    context.restore();
  }

  function drawImported(context, canvas) {
    const source = state.mediaType === 'image' ? elements.mediaImage : elements.mediaVideo;
    if (!source || (state.mediaType === 'video' && source.readyState < 2)) return;
    const stageRect = elements.stage.getBoundingClientRect();
    const tx = stageRect.width ? state.mediaView.x / stageRect.width * canvas.width : 0;
    const ty = stageRect.height ? state.mediaView.y / stageRect.height * canvas.height : 0;
    context.save();
    context.translate(canvas.width / 2 + tx, canvas.height / 2 + ty);
    context.scale(state.mediaView.scale, state.mediaView.scale);
    context.translate(-canvas.width / 2, -canvas.height / 2);
    drawContained(context, source, 0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function drawFrame(context, canvas) {
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const mirrorCamera = state.facingMode === 'user' && state.mirrored;
    if (state.mode === 'live' && elements.cameraVideo.readyState >= 2) {
      drawCovered(context, elements.cameraVideo, 0, 0, canvas.width, canvas.height, mirrorCamera);
      return;
    }
    drawImported(context, canvas);
    if (state.mode === 'facecam' && elements.cameraVideo.readyState >= 2) {
      const x = Math.round(state.face.x * canvas.width);
      const y = Math.round(state.face.y * canvas.height);
      const width = Math.round(state.face.w * canvas.width);
      const height = Math.round(state.face.h * canvas.height);
      drawCovered(context, elements.cameraVideo, x, y, width, height, mirrorCamera);
      context.lineWidth = Math.max(4, canvas.width * .006);
      context.strokeStyle = '#fff';
      context.strokeRect(x, y, width, height);
    }
  }

  function outputSize() {
    const sourceWidth = state.mode === 'live' ? 1080 : state.mediaWidth;
    const sourceHeight = state.mode === 'live' ? 1920 : state.mediaHeight;
    const maxEdge = elements.videoQuality.value === '1080' ? 1920 : 1280;
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const makeEven = (value) => Math.max(2, Math.round(value * scale / 2) * 2);
    return { width: makeEven(sourceWidth), height: makeEven(sourceHeight) };
  }

  function recorderMimeTypes(hasAudio) {
    const candidates = hasAudio ? [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ] : [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    const supported = candidates.filter((type) => MediaRecorder.isTypeSupported(type));
    return [...new Set([...supported, ''])];
  }

  function createRecorder(stream, hasAudio, width, height) {
    const pixels = width * height;
    let lastError = null;
    for (const mimeType of recorderMimeTypes(hasAudio)) {
      const options = {
        videoBitsPerSecond: pixels >= 1800000 ? 12000000 : 6500000
      };
      if (hasAudio) options.audioBitsPerSecond = 256000;
      if (mimeType) options.mimeType = mimeType;
      try { return new MediaRecorder(stream, options); }
      catch (error) {
        lastError = error;
        try { return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); }
        catch (fallbackError) { lastError = fallbackError; }
      }
    }
    throw new Error(`Format vidéo non compatible (${lastError?.name || 'erreur'})`);
  }

  async function requestWakeLock() {
    try { if (navigator.wakeLock) state.wakeLock = await navigator.wakeLock.request('screen'); }
    catch (_) {}
  }

  async function releaseWakeLock() {
    try { await state.wakeLock?.release(); }
    catch (_) {}
    state.wakeLock = null;
  }

  function setRecordingUi(recording) {
    document.body.classList.toggle('recording', recording);
    elements.recBtn.disabled = recording;
    elements.recBtn.textContent = recording ? '● Enregistrement' : '● Enregistrer';
    elements.stopBtn.disabled = !recording;
    [
      elements.liveTab, elements.mediaTab, elements.faceTab, elements.mediaInput,
      elements.cameraBtn, elements.flipBtn, elements.mirrorBtn, elements.audioMode,
      elements.videoQuality, elements.playBtn, elements.pauseBtn, elements.textUpBtn,
      elements.textDownBtn, elements.textSmallerBtn, elements.textLargerBtn,
      elements.resetLayoutBtn, elements.includeMicrophone, elements.includeMediaAudio,
      elements.micVolumeRange, elements.mediaVolumeRange, elements.activateMicBtn
    ].forEach((item) => { item.disabled = recording; });
    if (!recording) {
      displayImportedMedia();
      updateTabs();
      updateMixerUi();
    }
  }

  function updateTimer() {
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    elements.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  async function startRecording() {
    if (state.recordingStarting || (state.recorder && state.recorder.state !== 'inactive')) return;
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      showStatus('Enregistrement non compatible avec ce navigateur', true, 5000);
      return;
    }
    if (state.mode === 'live' && !hasLiveCamera()) { showStatus('Active d’abord la caméra', true); return; }
    if (state.mode !== 'live' && !state.mediaType) { showStatus('Importe d’abord une vidéo ou une image', true); return; }
    if (state.mode === 'facecam' && !hasLiveCamera()) { showStatus('Active d’abord la caméra', true); return; }

    state.recordingStarting = true;
    elements.recBtn.disabled = true;
    elements.recBtn.textContent = 'Préparation…';
    elements.recordQuality.textContent = 'Préparation de l’enregistrement…';

    try {
    state.chunks = [];
    state.recordingBlob = null;
    elements.download.style.display = 'none';
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = '';

    if (state.mediaType === 'video' && state.mode !== 'live') await elements.mediaVideo.play().catch(() => {});
    stopLiveMeter();
    let audioGraph;
    try {
      audioGraph = await buildAudioGraph();
    } catch (error) {
      console.error('Préparation audio impossible', error);
      audioGraph = {
        stream: new MediaStream(), context: null, analyser: null,
        micIncluded: false, mediaIncluded: false, microphoneUnavailable: wantsMicrophone()
      };
    }
    if (audioGraph.microphoneUnavailable) {
      showMicrophoneHelp(state.micLastError || new DOMException('Microphone indisponible', 'NotReadableError'));
    }
    state.audioGraph = audioGraph;
    meterLoop(audioGraph.analyser);

    const size = outputSize();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const render = () => {
      drawFrame(context, canvas);
      state.renderId = requestAnimationFrame(render);
    };
    render();
    const outputStream = canvas.captureStream(30);
    audioGraph.stream.getAudioTracks().forEach((track) => outputStream.addTrack(track));

    try {
      state.recorder = createRecorder(outputStream, outputStream.getAudioTracks().length > 0, size.width, size.height);
      state.recorder.ondataavailable = (event) => { if (event.data?.size) state.chunks.push(event.data); };
      state.recorder.onerror = (event) => showStatus(`Erreur d’enregistrement : ${event.error?.name || 'inconnue'}`, true, 5000);
      state.recorder.onstop = finishRecording;
      state.recorder.start(1000);
    } catch (error) {
      await cleanupAfterRecording();
      showStatus(error.message, true, 5000);
      return;
    }

    state.startedAt = Date.now();
    state.timerId = window.setInterval(updateTimer, 400);
    setRecordingUi(true);
    startTeleprompter();
    requestWakeLock();
    const profile = selectedProfile();
    const audioParts = [];
    if (audioGraph.micIncluded) audioParts.push(`micro ${Math.round(microphoneVolume() * 100)} %`);
    if (audioGraph.mediaIncluded) audioParts.push(`vidéo ${Math.round(mediaVolume() * 100)} %`);
    elements.recordQuality.textContent = `${Math.min(size.width, size.height)}p · ${profile.label} · ${audioParts.join(' + ') || 'sans son'}`;
    if (audioGraph.microphoneUnavailable) {
      showStatus(audioGraph.mediaIncluded
        ? 'Enregistrement lancé sans micro · son de la vidéo conservé'
        : 'Enregistrement lancé sans micro · vidéo sans son', true, 6200);
    } else {
      showStatus('Enregistrement lancé · audio haute qualité');
    }
    } catch (error) {
      console.error('Démarrage de l’enregistrement impossible', error);
      if (state.recorder && state.recorder.state !== 'inactive') {
        state.recorder.onstop = null;
        try { state.recorder.stop(); } catch (_) {}
      }
      await cleanupAfterRecording();
      showStatus(`Enregistrement impossible : ${error?.message || error?.name || 'erreur inconnue'}`, true, 6200);
    } finally {
      state.recordingStarting = false;
      if (!state.recorder || state.recorder.state === 'inactive') {
        elements.recBtn.disabled = false;
        elements.recBtn.textContent = '● Enregistrer';
      }
    }
  }

  function stopRecording() {
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.recorder.requestData();
      state.recorder.stop();
    }
  }

  async function cleanupAfterRecording() {
    if (state.renderId) cancelAnimationFrame(state.renderId);
    state.renderId = 0;
    clearInterval(state.timerId);
    state.timerId = 0;
    elements.timer.textContent = '00:00';
    stopTeleprompter(true);
    if (state.mediaType === 'video') elements.mediaVideo.pause();
    cancelAnimationFrame(state.audioMeterId);
    state.audioMeterId = 0;
    if (state.audioGraph?.context) await state.audioGraph.context.close().catch(() => {});
    state.audioGraph = null;
    releaseWakeLock();
    setRecordingUi(false);
    updateAudioLabel();
    const meterStream = state.micOnlyStream || state.cameraStream;
    if (meterStream) startLiveMeter(meterStream);
  }

  async function finishRecording() {
    const mimeType = state.recorder?.mimeType || state.chunks[0]?.type || 'video/webm';
    state.recordingBlob = new Blob(state.chunks, { type: mimeType });
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    state.recordingName = `Grok_Teleprompteur_${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    state.downloadUrl = URL.createObjectURL(state.recordingBlob);
    elements.download.style.display = 'block';
    elements.download.textContent = 'Enregistrer la vidéo sur le téléphone';
    elements.recordQuality.textContent = `${(state.recordingBlob.size / 1048576).toFixed(1)} Mo · prête à enregistrer`;
    await cleanupAfterRecording();
    showStatus('Vidéo prête · appuie sur le bouton vert');
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
    }
    return btoa(binary);
  }

  async function saveWithAndroidBridge(blob, name) {
    const bridge = window.AndroidBridge;
    const session = bridge.beginSave(name, blob.type || 'video/webm');
    if (!session) throw new Error('Impossible de préparer le fichier Android');
    const chunkSize = 512 * 1024;
    try {
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const data = await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer();
        if (!bridge.writeChunk(session, bufferToBase64(data))) throw new Error('Écriture interrompue');
        const percent = Math.min(100, Math.round((offset + data.byteLength) / blob.size * 100));
        elements.download.textContent = `Enregistrement… ${percent} %`;
        await delay(0);
      }
      if (!bridge.finishSave(session)) throw new Error('Finalisation impossible');
    } catch (error) {
      try { bridge.cancelSave(session); } catch (_) {}
      throw error;
    }
  }

  async function saveRecording() {
    if (!state.recordingBlob) return;
    elements.download.disabled = true;
    try {
      if (window.AndroidBridge?.beginSave) {
        await saveWithAndroidBridge(state.recordingBlob, state.recordingName);
        showStatus('Vidéo enregistrée dans Films/Grok Téléprompteur', false, 4500);
      } else {
        const anchor = document.createElement('a');
        anchor.href = state.downloadUrl;
        anchor.download = state.recordingName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        showStatus('Téléchargement lancé');
      }
    } catch (error) {
      showStatus(`Échec de l’enregistrement : ${error.message}`, true, 5000);
    } finally {
      elements.download.disabled = false;
      elements.download.textContent = 'Enregistrer la vidéo sur le téléphone';
    }
  }

  function saveScript() {
    try {
      localStorage.setItem('grokTeleprompterScript', elements.scriptInput.value);
      localStorage.setItem('grokTeleprompterAudio', elements.audioMode.value);
      localStorage.setItem('grokTeleprompterQuality', elements.videoQuality.value);
      localStorage.setItem('grokTeleprompterSpeed', elements.speedRange.value);
      localStorage.setItem('grokTeleprompterSize', elements.sizeRange.value);
      localStorage.setItem('grokTeleprompterMixer', JSON.stringify({
        microphone: wantsMicrophone(),
        microphoneVolume: Math.round(microphoneVolume() * 100),
        mediaAudio: elements.includeMediaAudio.checked,
        mediaVolume: Math.round(mediaVolume() * 100)
      }));
      localStorage.setItem('grokTeleprompterLayout', JSON.stringify({
        face: state.face,
        teleBox: state.teleBox,
        mirrored: state.mirrored
      }));
    } catch (_) {}
  }

  function restoreBox(value, fallback, minWidth, minHeight) {
    if (!value || typeof value !== 'object') return { ...fallback };
    const width = clamp(Number(value.w) || fallback.w, minWidth, 1);
    const height = clamp(Number(value.h) || fallback.h, minHeight, 1);
    return {
      x: clamp(Number(value.x) || 0, 0, 1 - width),
      y: clamp(Number(value.y) || 0, 0, 1 - height),
      w: width,
      h: height
    };
  }

  function restorePreferences() {
    try {
      const script = localStorage.getItem('grokTeleprompterScript');
      const audio = localStorage.getItem('grokTeleprompterAudio');
      const quality = localStorage.getItem('grokTeleprompterQuality');
      const speed = localStorage.getItem('grokTeleprompterSpeed');
      const size = localStorage.getItem('grokTeleprompterSize');
      const layout = JSON.parse(localStorage.getItem('grokTeleprompterLayout') || 'null');
      const mixer = JSON.parse(localStorage.getItem('grokTeleprompterMixer') || 'null');
      if (script !== null) elements.scriptInput.value = script;
      if (audio && AUDIO_PROFILES[audio]) elements.audioMode.value = audio;
      if (quality === '720' || quality === '1080') elements.videoQuality.value = quality;
      if (speed) elements.speedRange.value = String(clamp(Number(speed), 1, 10));
      if (size) elements.sizeRange.value = String(clamp(Number(size), 20, 70));
      if (mixer) {
        elements.includeMicrophone.checked = mixer.microphone !== false;
        elements.includeMediaAudio.checked = mixer.mediaAudio === true;
        const savedMicVolume = Number(mixer.microphoneVolume);
        const savedMediaVolume = Number(mixer.mediaVolume);
        if (Number.isFinite(savedMicVolume)) elements.micVolumeRange.value = String(clamp(savedMicVolume, 0, 200));
        if (Number.isFinite(savedMediaVolume)) elements.mediaVolumeRange.value = String(clamp(savedMediaVolume, 0, 100));
      }
      state.face = restoreBox(layout?.face, DEFAULT_FACE, .14, .10);
      state.teleBox = restoreBox(layout?.teleBox, DEFAULT_TELE_BOX, .35, .24);
      if (typeof layout?.mirrored === 'boolean') state.mirrored = layout.mirrored;
    } catch (_) {}
  }

  elements.liveTab.addEventListener('click', () => setMode('live'));
  elements.mediaTab.addEventListener('click', () => setMode('media'));
  elements.faceTab.addEventListener('click', () => setMode('facecam'));
  elements.cameraBtn.addEventListener('click', startCamera);
  elements.retryCameraBtn.addEventListener('click', startCamera);
  function openAndroidAppSettings(retryCamera = false) {
    state.resumeCamera = retryCamera || hasLiveCamera();
    if (window.AndroidBridge?.openAppSettings) window.AndroidBridge.openAppSettings();
    else showStatus('Ouvre les réglages Android de l’application pour autoriser caméra et micro', true, 5000);
  }
  async function activateMicrophone() {
    elements.includeMicrophone.checked = true;
    updateMixerUi();
    const microphone = await ensureMicrophone();
    if (microphone) {
      startLiveMeter(microphone);
      showStatus('Micro actif · parle et vérifie la barre de niveau', false, 4500);
    }
    saveScript();
  }
  elements.cameraSettingsBtn.addEventListener('click', () => openAndroidAppSettings(true));
  elements.microphoneSettingsBtn.addEventListener('click', () => openAndroidAppSettings(false));
  elements.retryMicrophoneBtn.addEventListener('click', activateMicrophone);
  elements.activateMicBtn.addEventListener('click', activateMicrophone);
  elements.recBtn.addEventListener('click', startRecording);
  elements.stopBtn.addEventListener('click', stopRecording);
  elements.download.addEventListener('click', saveRecording);
  elements.playBtn.addEventListener('click', () => { if (state.mediaType === 'video') elements.mediaVideo.play().catch(() => {}); });
  elements.pauseBtn.addEventListener('click', () => { if (state.mediaType === 'video') elements.mediaVideo.pause(); });
  $('tlBtn').addEventListener('click', () => moveFace('tl'));
  $('trBtn').addEventListener('click', () => moveFace('tr'));
  $('brBtn').addEventListener('click', () => moveFace('br'));
  $('minusBtn').addEventListener('click', () => resizeFace(-.05));
  $('plusBtn').addEventListener('click', () => resizeFace(.05));

  elements.flipBtn.addEventListener('click', async () => {
    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    await startCamera();
  });
  elements.mirrorBtn.addEventListener('click', () => {
    state.mirrored = !state.mirrored;
    updateMirror();
    saveScript();
  });
  elements.audioMode.addEventListener('change', async () => {
    saveScript();
    updateAudioLabel();
    if (hasLiveMicrophone()) {
      state.micOnlyStream.getTracks().forEach((track) => track.stop());
      state.micOnlyStream = null;
      stopLiveMeter();
      const microphone = await ensureMicrophone();
      if (microphone) startLiveMeter(microphone);
    }
  });
  elements.includeMicrophone.addEventListener('change', async () => {
    if (wantsMicrophone()) {
      await activateMicrophone();
    } else {
      state.micOnlyStream?.getTracks().forEach((track) => track.stop());
      state.micOnlyStream = null;
      state.micLastError = null;
      elements.microphoneHelp.classList.add('hide');
      stopLiveMeter();
      updateMixerUi();
      saveScript();
      showStatus('Micro coupé pour les prochains enregistrements');
    }
  });
  elements.includeMediaAudio.addEventListener('change', () => {
    updateMixerUi();
    saveScript();
    showStatus(elements.includeMediaAudio.checked
      ? `Son de la vidéo activé à ${Math.round(mediaVolume() * 100)} %`
      : 'Son de la vidéo coupé');
  });
  elements.micVolumeRange.addEventListener('input', () => {
    updateMixerUi();
    saveScript();
  });
  elements.mediaVolumeRange.addEventListener('input', () => {
    updateMixerUi();
    saveScript();
  });
  elements.videoQuality.addEventListener('change', async () => {
    saveScript();
    if (hasLiveCamera()) await startCamera();
  });
  elements.scriptInput.addEventListener('input', () => {
    updateTeleText(false);
    clearTimeout(elements.scriptInput._saveTimer);
    elements.scriptInput._saveTimer = setTimeout(saveScript, 350);
  });
  elements.speedRange.addEventListener('input', saveScript);
  elements.sizeRange.addEventListener('input', () => {
    updateTeleText(false);
    saveScript();
  });
  elements.textUpBtn.addEventListener('click', () => {
    state.teleBox.y = clamp(state.teleBox.y - .045, 0, 1 - state.teleBox.h);
    layoutTeleprompter();
    saveScript();
  });
  elements.textDownBtn.addEventListener('click', () => {
    state.teleBox.y = clamp(state.teleBox.y + .045, 0, 1 - state.teleBox.h);
    layoutTeleprompter();
    saveScript();
  });
  elements.textSmallerBtn.addEventListener('click', () => applyTeleFont(Number(elements.sizeRange.value) - 3));
  elements.textLargerBtn.addEventListener('click', () => applyTeleFont(Number(elements.sizeRange.value) + 3));
  elements.resetLayoutBtn.addEventListener('click', () => {
    state.face = { ...DEFAULT_FACE };
    state.teleBox = { ...DEFAULT_TELE_BOX };
    elements.sizeRange.value = '36';
    layoutFace();
    layoutTeleprompter();
    updateTeleText(true);
    saveScript();
    showStatus('Positions réinitialisées');
  });

  elements.mediaInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      showStatus('Choisis une image ou une vidéo', true);
      return;
    }
    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = URL.createObjectURL(file);
    elements.download.style.display = 'none';
    resetMediaView();
    if (file.type.startsWith('image/')) {
      state.mediaType = 'image';
      elements.mediaImage.onload = () => {
        setAspect(elements.mediaImage.naturalWidth, elements.mediaImage.naturalHeight);
        displayImportedMedia();
        showStatus('Image prête');
      };
      elements.mediaImage.src = state.mediaUrl;
    } else {
      state.mediaType = 'video';
      elements.mediaVideo.onloadedmetadata = () => {
        setAspect(elements.mediaVideo.videoWidth, elements.mediaVideo.videoHeight);
        displayImportedMedia();
        showStatus('Vidéo prête');
      };
      elements.mediaVideo.src = state.mediaUrl;
      elements.mediaVideo.muted = true;
      elements.mediaVideo.load();
    }
    displayImportedMedia();
  });

  function startFaceGesture(kind, point) {
    state.faceGesture = {
      kind,
      pointerId: point.id,
      startX: point.x,
      startY: point.y,
      box: { ...state.face }
    };
  }

  elements.faceFrame.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'facecam' || !hasLiveCamera() || document.body.classList.contains('recording')) return;
    const point = { id: event.pointerId, x: event.clientX, y: event.clientY };
    state.facePointers.set(event.pointerId, point);
    try { elements.faceFrame.setPointerCapture(event.pointerId); } catch (_) {}
    if (state.facePointers.size === 1) {
      startFaceGesture(event.target === elements.faceResizeHandle ? 'resize' : 'drag', point);
    } else if (state.facePointers.size === 2) {
      const points = [...state.facePointers.values()];
      state.faceGesture = {
        kind: 'pinch',
        distance: pointerDistance(points[0], points[1]),
        center: pointerCenter(points[0], points[1]),
        box: { ...state.face }
      };
    }
    event.stopPropagation();
    event.preventDefault();
  });

  elements.faceFrame.addEventListener('pointermove', (event) => {
    if (!state.facePointers.has(event.pointerId) || !state.faceGesture) return;
    state.facePointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
    const stageRect = elements.stage.getBoundingClientRect();
    const gesture = state.faceGesture;
    if (gesture.kind === 'pinch' && state.facePointers.size >= 2) {
      const points = [...state.facePointers.values()].slice(0, 2);
      const center = pointerCenter(points[0], points[1]);
      const scale = pointerDistance(points[0], points[1]) / Math.max(1, gesture.distance);
      const width = clamp(gesture.box.w * scale, .14, .78);
      const height = clamp(gesture.box.h * scale, .10, .64);
      const baseCenterX = gesture.box.x + gesture.box.w / 2;
      const baseCenterY = gesture.box.y + gesture.box.h / 2;
      const centerX = baseCenterX + (center.x - gesture.center.x) / stageRect.width;
      const centerY = baseCenterY + (center.y - gesture.center.y) / stageRect.height;
      state.face = {
        x: clamp(centerX - width / 2, 0, 1 - width),
        y: clamp(centerY - height / 2, 0, 1 - height),
        w: width,
        h: height
      };
    } else if (gesture.pointerId === event.pointerId && gesture.kind === 'resize') {
      const dx = (event.clientX - gesture.startX) / stageRect.width;
      const dy = (event.clientY - gesture.startY) / stageRect.height;
      const scale = Math.max(
        (gesture.box.w + dx) / gesture.box.w,
        (gesture.box.h + dy) / gesture.box.h
      );
      state.face.w = clamp(gesture.box.w * scale, .14, 1 - gesture.box.x);
      state.face.h = clamp(gesture.box.h * scale, .10, 1 - gesture.box.y);
    } else if (gesture.pointerId === event.pointerId && gesture.kind === 'drag') {
      state.face.x = clamp(gesture.box.x + (event.clientX - gesture.startX) / stageRect.width, 0, 1 - state.face.w);
      state.face.y = clamp(gesture.box.y + (event.clientY - gesture.startY) / stageRect.height, 0, 1 - state.face.h);
    }
    layoutFace();
    event.stopPropagation();
    event.preventDefault();
  });

  function endFacePointer(event) {
    if (!state.facePointers.has(event.pointerId)) return;
    state.facePointers.delete(event.pointerId);
    state.faceGesture = null;
    if (state.facePointers.size === 1) startFaceGesture('drag', [...state.facePointers.values()][0]);
    saveScript();
    event.stopPropagation();
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => elements.faceFrame.addEventListener(name, endFacePointer));

  function startTeleGesture(kind, point) {
    state.teleGesture = {
      kind,
      pointerId: point.id,
      startX: point.x,
      startY: point.y,
      box: { ...state.teleBox },
      fontSize: Number(elements.sizeRange.value)
    };
  }

  elements.teleprompter.addEventListener('pointerdown', (event) => {
    if (state.mode === 'media' || document.body.classList.contains('recording')) return;
    stopTeleprompter(true);
    const point = { id: event.pointerId, x: event.clientX, y: event.clientY };
    state.telePointers.set(event.pointerId, point);
    try { elements.teleprompter.setPointerCapture(event.pointerId); } catch (_) {}
    if (state.telePointers.size === 1) {
      startTeleGesture(event.target === elements.teleResizeHandle ? 'resize' : 'drag', point);
    } else if (state.telePointers.size === 2) {
      const points = [...state.telePointers.values()];
      state.teleGesture = {
        kind: 'pinch',
        distance: pointerDistance(points[0], points[1]),
        center: pointerCenter(points[0], points[1]),
        box: { ...state.teleBox },
        fontSize: Number(elements.sizeRange.value)
      };
    }
    event.stopPropagation();
    event.preventDefault();
  });

  elements.teleprompter.addEventListener('pointermove', (event) => {
    if (!state.telePointers.has(event.pointerId) || !state.teleGesture) return;
    state.telePointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
    const stageRect = elements.stage.getBoundingClientRect();
    const gesture = state.teleGesture;
    if (gesture.kind === 'pinch' && state.telePointers.size >= 2) {
      const points = [...state.telePointers.values()].slice(0, 2);
      const center = pointerCenter(points[0], points[1]);
      const scale = pointerDistance(points[0], points[1]) / Math.max(1, gesture.distance);
      const width = clamp(gesture.box.w * scale, .35, 1);
      const height = clamp(gesture.box.h * scale, .24, 1);
      const baseCenterX = gesture.box.x + gesture.box.w / 2;
      const baseCenterY = gesture.box.y + gesture.box.h / 2;
      const centerX = baseCenterX + (center.x - gesture.center.x) / stageRect.width;
      const centerY = baseCenterY + (center.y - gesture.center.y) / stageRect.height;
      state.teleBox = {
        x: clamp(centerX - width / 2, 0, 1 - width),
        y: clamp(centerY - height / 2, 0, 1 - height),
        w: width,
        h: height
      };
      elements.sizeRange.value = String(clamp(Math.round(gesture.fontSize * scale), 20, 70));
      elements.teleText.style.fontSize = `${elements.sizeRange.value}px`;
    } else if (gesture.pointerId === event.pointerId && gesture.kind === 'resize') {
      const dx = (event.clientX - gesture.startX) / stageRect.width;
      const dy = (event.clientY - gesture.startY) / stageRect.height;
      state.teleBox.w = clamp(gesture.box.w + dx, .35, 1 - gesture.box.x);
      state.teleBox.h = clamp(gesture.box.h + dy, .24, 1 - gesture.box.y);
    } else if (gesture.pointerId === event.pointerId && gesture.kind === 'drag') {
      state.teleBox.x = clamp(gesture.box.x + (event.clientX - gesture.startX) / stageRect.width, 0, 1 - state.teleBox.w);
      state.teleBox.y = clamp(gesture.box.y + (event.clientY - gesture.startY) / stageRect.height, 0, 1 - state.teleBox.h);
    }
    layoutTeleprompter();
    event.stopPropagation();
    event.preventDefault();
  });

  function endTelePointer(event) {
    if (!state.telePointers.has(event.pointerId)) return;
    state.telePointers.delete(event.pointerId);
    state.teleGesture = null;
    if (state.telePointers.size === 1) startTeleGesture('drag', [...state.telePointers.values()][0]);
    updateTeleText(true);
    saveScript();
    event.stopPropagation();
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => elements.teleprompter.addEventListener(name, endTelePointer));

  elements.stage.addEventListener('pointerdown', (event) => {
    if (elements.faceFrame.contains(event.target) || elements.teleprompter.contains(event.target) || state.mode === 'live' || !state.mediaType) return;
    const now = Date.now();
    if (now - state.lastTap < 280 && state.viewPointers.size === 0) {
      resetMediaView();
      showStatus('Zoom remis à zéro');
    }
    state.lastTap = now;
    state.viewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { elements.stage.setPointerCapture(event.pointerId); } catch (_) {}
    if (state.viewPointers.size === 1 && state.mediaView.scale > 1) {
      state.panStart = { x: event.clientX, y: event.clientY, viewX: state.mediaView.x, viewY: state.mediaView.y };
    }
    if (state.viewPointers.size === 2) {
      const points = [...state.viewPointers.values()];
      const center = pointerCenter(points[0], points[1]);
      state.pinchStart = { distance: pointerDistance(points[0], points[1]), scale: state.mediaView.scale, x: state.mediaView.x, y: state.mediaView.y, centerX: center.x, centerY: center.y };
      state.panStart = null;
    }
    event.preventDefault();
  });

  elements.stage.addEventListener('pointermove', (event) => {
    if (!state.viewPointers.has(event.pointerId) || elements.faceFrame.contains(event.target) || elements.teleprompter.contains(event.target)) return;
    state.viewPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.viewPointers.size >= 2 && state.pinchStart) {
      const points = [...state.viewPointers.values()].slice(0, 2);
      const center = pointerCenter(points[0], points[1]);
      state.mediaView.scale = state.pinchStart.scale * pointerDistance(points[0], points[1]) / Math.max(1, state.pinchStart.distance);
      state.mediaView.x = state.pinchStart.x + center.x - state.pinchStart.centerX;
      state.mediaView.y = state.pinchStart.y + center.y - state.pinchStart.centerY;
      clampMediaView();
      event.preventDefault();
    } else if (state.viewPointers.size === 1 && state.panStart && state.mediaView.scale > 1) {
      state.mediaView.x = state.panStart.viewX + event.clientX - state.panStart.x;
      state.mediaView.y = state.panStart.viewY + event.clientY - state.panStart.y;
      clampMediaView();
      event.preventDefault();
    }
  });

  function endMediaPointer(event) {
    state.viewPointers.delete(event.pointerId);
    state.pinchStart = null;
    state.panStart = null;
    if (state.viewPointers.size === 1 && state.mediaView.scale > 1) {
      const point = [...state.viewPointers.values()][0];
      state.panStart = { x: point.x, y: point.y, viewX: state.mediaView.x, viewY: state.mediaView.y };
    }
  }
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => elements.stage.addEventListener(name, endMediaPointer));

  window.addEventListener('resize', resizeStage);
  window.addEventListener('beforeunload', (event) => {
    if (state.recorder && state.recorder.state !== 'inactive') {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => {
    if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    stopCameraTracks();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (!state.recorder || state.recorder.state === 'inactive')) {
      state.resumeCamera = state.resumeCamera || hasLiveCamera();
      stopCameraTracks();
    } else if (!document.hidden && state.recorder?.state === 'recording') {
      requestWakeLock();
    } else if (!document.hidden && state.resumeCamera) {
      state.resumeCamera = false;
      startCamera();
    }
  });

  restorePreferences();
  setAspect(9, 16);
  updateTabs();
  resizeStage();
  applyMediaView();
  updateTeleText(true);
  updateMixerUi();

  if ('serviceWorker' in navigator && location.hostname !== 'appassets.androidplatform.net') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
