from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new, label):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Patch introuvable: {label} dans {path}')
    text = text.replace(old, new, 1)
    p.write_text(text, encoding='utf-8')


def append_before(path, marker, addition, label):
    replace_once(path, marker, addition + marker, label)


# 1) Bouton Pause/Reprendre directement sous l'écran.
append_before(
    'index.html',
    '      <section class="gestureHelp" aria-label="Aide tactile">',
    '''      <section class="telePlaybackBar" aria-label="Contrôle du téléprompteur">
        <button id="telePauseToggle" class="telePauseToggle" type="button" disabled>Ⅱ Pause téléprompteur</button>
        <span>En pause : glisse le texte directement avec le doigt, même pendant REC.</span>
      </section>

''',
    'barre pause teleprompteur'
)

# 2) Style lisible, compact et tactile.
append_before(
    'style.css',
    '.gestureHelp {',
    '''.telePlaybackBar { display: grid; grid-template-columns: minmax(150px,.9fr) 1.4fr; gap: 9px; align-items: center; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.08); background: #07142b; }
.telePauseToggle { min-height: 48px; border: 1px solid rgba(96,165,250,.55); border-radius: 12px; background: linear-gradient(135deg,#1d4ed8,#6d28d9); color: #fff; font-weight: 900; font-size: 14px; touch-action: manipulation; }
.telePauseToggle:disabled { opacity: .38; }
.telePauseToggle.paused { border-color: #34d399; background: linear-gradient(135deg,#047857,#10b981); }
.telePlaybackBar span { color: #9fb5d5; font-size: 10px; font-weight: 800; line-height: 1.3; text-align: center; }
.teleprompter.telePaused { border-color: rgba(52,211,153,.92); box-shadow: inset 0 0 0 1px rgba(52,211,153,.28),0 0 0 2px rgba(16,185,129,.10); }
.teleprompter.telePaused .teleText { pointer-events: none; }
@media (max-width: 430px) { .telePlaybackBar { grid-template-columns: 1fr; } .telePlaybackBar span { font-size: 9px; } }

''',
    'style pause teleprompter'
)

# 3) Références DOM + état pause tactile.
replace_once(
    'script.js',
    "    timer: $('timer'), teleprompter: $('teleprompter'),\n",
    "    timer: $('timer'), teleprompter: $('teleprompter'), telePauseToggle: $('telePauseToggle'),\n",
    'reference bouton pause'
)
replace_once(
    'script.js',
    "    teleRaf: 0, teleStartedAt: 0, teleRunning: false, downloadUrl: '',\n",
    "    teleRaf: 0, teleStartedAt: 0, teleRunning: false, telePaused: false, teleOffsetPx: 0,\n    teleTouchPointer: -1, teleTouchStartY: 0, teleTouchStartOffset: 0, downloadUrl: '',\n",
    'etat pause teleprompteur'
)

# Ne jamais recentrer le texte lorsqu'il est volontairement en pause.
replace_once(
    'script.js',
    '    if (!state.teleRunning) requestAnimationFrame(updateTeleScrollMode);\n',
    '    if (!state.teleRunning && !state.telePaused) requestAnimationFrame(updateTeleScrollMode);\n',
    'layout tele pause safe'
)
replace_once(
    'script.js',
    '    if (!state.teleRunning) positionTeleTextAtRest();\n',
    '    if (!state.teleRunning && !state.telePaused) positionTeleTextAtRest();\n',
    'scroll mode pause safe'
)

old_tele = '''  function stopTeleprompter(reset = false) {
    state.teleRunning = false;
    if (state.teleRaf) cancelAnimationFrame(state.teleRaf);
    state.teleRaf = 0;
    if (reset) positionTeleTextAtRest();
  }
  function startTeleprompter() {
    updateTeleText(true);
    if (!teleHasText()) return;
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
'''
new_tele = '''  function maxTeleMove() {
    return Math.max(0, elements.teleText.scrollHeight + elements.teleprompter.clientHeight * .55);
  }
  function setTeleOffset(offset) {
    state.teleOffsetPx = clamp(Number(offset) || 0, 0, maxTeleMove());
    elements.teleText.style.top = '55%';
    elements.teleText.style.transform = `translateY(${-state.teleOffsetPx}px)`;
  }
  function currentTeleOffset() {
    const match = String(elements.teleText.style.transform || '').match(/translateY\\((-?[0-9.]+)px\\)/);
    return match ? Math.max(0, -Number(match[1])) : state.teleOffsetPx;
  }
  function updateTelePauseUi() {
    if (!elements.telePauseToggle) return;
    elements.telePauseToggle.disabled = !teleHasText() || !state.teleShouldScroll;
    elements.telePauseToggle.classList.toggle('paused', state.telePaused);
    elements.telePauseToggle.textContent = state.telePaused
      ? '▶ Reprendre le téléprompteur'
      : 'Ⅱ Pause téléprompteur';
    elements.teleprompter.classList.toggle('telePaused', state.telePaused);
  }
  function runTeleprompterFrom(offset) {
    state.telePaused = false;
    state.teleRunning = true;
    state.teleOffsetPx = clamp(offset, 0, maxTeleMove());
    state.teleStartedAt = performance.now();
    const startOffset = state.teleOffsetPx;
    elements.teleText.style.top = '55%';
    updateTelePauseUi();
    const loop = (now) => {
      if (!state.teleRunning || state.telePaused) return;
      const speed = 10 + clamp(Number(elements.speedRange.value) || 3, 1, 10) * 9;
      const elapsed = (now - state.teleStartedAt) / 1000;
      const nextOffset = Math.min(maxTeleMove(), startOffset + elapsed * speed);
      setTeleOffset(nextOffset);
      if (nextOffset < maxTeleMove()) state.teleRaf = requestAnimationFrame(loop);
      else {
        state.teleRunning = false;
        state.teleRaf = 0;
        updateTelePauseUi();
      }
    };
    state.teleRaf = requestAnimationFrame(loop);
  }
  function pauseTeleprompter() {
    if (!state.teleRunning || !state.teleShouldScroll) return;
    state.teleOffsetPx = currentTeleOffset();
    state.teleRunning = false;
    state.telePaused = true;
    if (state.teleRaf) cancelAnimationFrame(state.teleRaf);
    state.teleRaf = 0;
    setTeleOffset(state.teleOffsetPx);
    updateTelePauseUi();
    showStatus('Téléprompteur en pause · glisse le texte avec ton doigt', false, 2200);
  }
  function resumeTeleprompter() {
    if (!state.telePaused || !state.teleShouldScroll) return;
    runTeleprompterFrom(state.teleOffsetPx);
  }
  function toggleTeleprompterPause() {
    if (state.telePaused) resumeTeleprompter();
    else pauseTeleprompter();
  }
  function stopTeleprompter(reset = false) {
    state.teleRunning = false;
    state.telePaused = false;
    state.teleTouchPointer = -1;
    if (state.teleRaf) cancelAnimationFrame(state.teleRaf);
    state.teleRaf = 0;
    if (reset) {
      state.teleOffsetPx = 0;
      positionTeleTextAtRest();
    }
    updateTelePauseUi();
  }
  function startTeleprompter() {
    updateTeleText(true);
    if (!teleHasText()) return;
    updateTeleScrollMode();
    if (!state.teleShouldScroll) {
      state.teleRunning = false;
      state.telePaused = false;
      positionTeleTextAtRest();
      updateTelePauseUi();
      return;
    }
    state.teleOffsetPx = 0;
    runTeleprompterFrom(0);
  }
'''
replace_once('script.js', old_tele, new_tele, 'moteur pause teleprompter')

# UI pause + défilement tactile uniquement pendant la pause. Compatible pendant REC.
needle = "  elements.pauseBtn.addEventListener('click', () => { if (state.mediaType === 'video') elements.mediaVideo.pause(); });\n"
addition = needle + '''  elements.telePauseToggle?.addEventListener('click', toggleTeleprompterPause);
  elements.teleprompter.addEventListener('pointerdown', (event) => {
    if (!state.telePaused || !state.teleShouldScroll) return;
    if (event.target === elements.teleResizeHandle) return;
    state.teleTouchPointer = event.pointerId;
    state.teleTouchStartY = event.clientY;
    state.teleTouchStartOffset = state.teleOffsetPx;
    try { elements.teleprompter.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  });
  elements.teleprompter.addEventListener('pointermove', (event) => {
    if (!state.telePaused || event.pointerId !== state.teleTouchPointer) return;
    const delta = event.clientY - state.teleTouchStartY;
    setTeleOffset(state.teleTouchStartOffset - delta);
    event.preventDefault();
  });
  const finishTeleTouch = (event) => {
    if (event.pointerId !== state.teleTouchPointer) return;
    state.teleTouchPointer = -1;
    try { elements.teleprompter.releasePointerCapture(event.pointerId); } catch (_) {}
  };
  elements.teleprompter.addEventListener('pointerup', finishTeleTouch);
  elements.teleprompter.addEventListener('pointercancel', finishTeleTouch);
'''
replace_once('script.js', needle, addition, 'events pause tactile')

# Mettre à jour l'état du bouton après chaque recalcul de longueur.
replace_once(
    'script.js',
    "    if (!state.teleRunning && !state.telePaused) positionTeleTextAtRest();\n    return state.teleShouldScroll;\n",
    "    if (!state.teleRunning && !state.telePaused) positionTeleTextAtRest();\n    updateTelePauseUi();\n    return state.teleShouldScroll;\n",
    'rafraichissement bouton pause'
)

# 4) Fond vert : cadence plus élevée et moins de données entre WebView et ML Kit.
replace_once('script.js', '  const SEGMENTATION_INTERVAL_MS = 55;\n', '  const SEGMENTATION_INTERVAL_MS = 34;\n', 'cadence segmentation')
replace_once('script.js', '  const SEGMENTATION_INPUT_EDGE = 256;\n', '  const SEGMENTATION_INPUT_EDGE = 224;\n', 'resolution segmentation')
replace_once('script.js', "    const encoded = capture.toDataURL('image/jpeg', .72).split(',')[1] || '';\n", "    const encoded = capture.toDataURL('image/jpeg', .60).split(',')[1] || '';\n", 'jpeg segmentation')
replace_once('script.js', '      scheduleSegmentation(70);\n', '      scheduleSegmentation(45);\n', 'retry segmentation busy')
replace_once('script.js', '    if (!state.segmentationBusy) scheduleSegmentation(90);\n', '    if (!state.segmentationBusy) scheduleSegmentation(55);\n', 'retry segmentation bridge')

# Audio natif : tampon de secours beaucoup plus court pour réduire le décalage voix/image.
replace_once('script.js', '          native.nextTime = now + .18;\n', '          native.nextTime = now + .055;\n', 'latence initiale audio')
replace_once('script.js', '        if (!native.nextTime || native.nextTime < now - .08 || native.nextTime > now + .45) {\n', '        if (!native.nextTime || native.nextTime < now - .045 || native.nextTime > now + .20) {\n', 'fenetre synchro audio')

# 5) Android : privilégier explicitement le micro intégré du téléphone et réduire le chunk à 20 ms.
replace_once(
    'app/src/main/java/com/chasmet/grokteleprompter/MainActivity.java',
    'import android.media.AudioFormat;\nimport android.media.AudioRecord;\n',
    'import android.media.AudioDeviceInfo;\nimport android.media.AudioFormat;\nimport android.media.AudioManager;\nimport android.media.AudioRecord;\n',
    'imports audio device'
)
replace_once(
    'app/src/main/java/com/chasmet/grokteleprompter/MainActivity.java',
    '        // 40 ms exactement à 48 kHz mono 16 bits : quatre trames audio de\n        // 10 ms, sans fraction résiduelle aux frontières WebRTC/MediaRecorder.\n        private static final int NATIVE_MIC_CHUNK_BYTES = 3840;\n',
    '        // 20 ms à 48 kHz mono 16 bits : latence plus faible et cadence stable.\n        private static final int NATIVE_MIC_CHUNK_BYTES = 1920;\n',
    'chunk audio 20ms'
)
old_create = '''                if (recorder.getState() == AudioRecord.STATE_INITIALIZED) return recorder;
                recorder.release();
'''
new_create = '''                if (recorder.getState() == AudioRecord.STATE_INITIALIZED) {
                    preferBuiltInMicrophone(recorder);
                    return recorder;
                }
                recorder.release();
'''
replace_once('app/src/main/java/com/chasmet/grokteleprompter/MainActivity.java', old_create, new_create, 'selection micro integre')
insert_marker = '        private void pumpNativeMicrophone(AudioRecord recorder) {\n'
insert_method = '''        private void preferBuiltInMicrophone(AudioRecord recorder) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
            try {
                AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
                if (manager == null) return;
                AudioDeviceInfo[] inputs = manager.getDevices(AudioManager.GET_DEVICES_INPUTS);
                for (AudioDeviceInfo device : inputs) {
                    if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
                        recorder.setPreferredDevice(device);
                        return;
                    }
                }
            } catch (Exception ignored) {}
        }

'''
append_before('app/src/main/java/com/chasmet/grokteleprompter/MainActivity.java', insert_marker, insert_method, 'helper micro integre')

# 6) Masque ML Kit plus réactif : moins d'inertie sur les mouvements rapides.
for old, new, label in [
    ('if (difference < .035f) historyWeight = .38f;', 'if (difference < .035f) historyWeight = .24f;', 'smooth 1'),
    ('else if (difference < .08f) historyWeight = .29f;', 'else if (difference < .08f) historyWeight = .18f;', 'smooth 2'),
    ('else if (difference < .16f) historyWeight = .16f;', 'else if (difference < .16f) historyWeight = .09f;', 'smooth 3'),
    ('else if (difference < .28f) historyWeight = .055f;', 'else if (difference < .28f) historyWeight = .025f;', 'smooth 4'),
    ('else historyWeight = .012f;', 'else historyWeight = .004f;', 'smooth 5'),
]:
    replace_once('app/src/main/java/com/chasmet/grokteleprompter/NativeCameraSegmenter.java', old, new, label)

print('Upgrade téléprompteur/fond vert appliqué avec succès.')
