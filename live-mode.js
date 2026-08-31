(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function openNativeSettings() {
    window.location.href = 'grok-settings://open';
  }

  function copyLiveSettingsToMain(textarea, speed, size) {
    const scriptInput = $('scriptInput');
    const speedRange = $('speedRange');
    const sizeRange = $('sizeRange');
    if (scriptInput) {
      scriptInput.value = textarea.value;
      scriptInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (speedRange) {
      speedRange.value = speed.value;
      speedRange.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (sizeRange) {
      sizeRange.value = size.value;
      sizeRange.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function launchNativeLive(script, speed, size) {
    const url = `grok-live://start?text=${encodeURIComponent(script)}&speed=${encodeURIComponent(speed)}&size=${encodeURIComponent(size)}`;
    window.location.href = url;
  }

  function createLiveSetup() {
    const setup = document.createElement('section');
    setup.id = 'liveSetup';
    setup.className = 'liveSetup hidden';
    setup.innerHTML = `
      <div class="liveSetupCard">
        <div class="liveBadge">LIVE FOND D’ÉCRAN VERT</div>
        <h2>Caméra + téléprompteur au-dessus de toutes tes applis</h2>
        <p>Tu peux revenir sur l’accueil, ouvrir Chrome, Bybit ou une autre application. La caméra détourée, le texte et les commandes restent visibles.</p>
        <label class="liveField">Texte du téléprompteur
          <textarea id="liveScriptInput" spellcheck="true"></textarea>
        </label>
        <label class="liveField">Vitesse <output id="liveSpeedValue">3</output>
          <input id="liveSpeed" type="range" min="1" max="10" value="3">
        </label>
        <label class="liveField">Taille du texte <output id="liveSizeValue">36</output>
          <input id="liveSize" type="range" min="20" max="70" value="36">
        </label>
        <div class="liveFeatureGrid">
          <span>✓ Caméra détourée flottante</span>
          <span>✓ Téléprompteur flottant</span>
          <span>✓ REC / Pause / Reprendre / Stop</span>
          <span>✓ Déplacement + redimensionnement en pause</span>
          <span>✓ Navigation libre dans le téléphone</span>
          <span>✓ Micro intégré du téléphone</span>
        </div>
        <button id="launchLiveOverlay" class="launchLiveOverlay" type="button">LANCER LE LIVE SUR MON ÉCRAN</button>
        <button id="liveSettingsButton" class="closeLiveSetup" type="button">⚙ Réglages · Mises à jour</button>
        <button id="closeLiveSetup" class="closeLiveSetup" type="button">Retour aux 3 modes</button>
        <p class="livePermissionHint">Au premier lancement Android demandera l’autorisation d’afficher par-dessus les applis puis l’autorisation de capturer l’écran.</p>
      </div>`;
    document.body.appendChild(setup);

    const script = $('liveScriptInput');
    const speed = $('liveSpeed');
    const size = $('liveSize');
    const mainScript = $('scriptInput');
    const mainSpeed = $('speedRange');
    const mainSize = $('sizeRange');
    script.value = mainScript?.value || 'Bienvenue dans Grok Téléprompteur Live.\nRegarde la caméra et laisse le texte défiler naturellement.';
    speed.value = mainSpeed?.value || '3';
    size.value = mainSize?.value || '36';
    $('liveSpeedValue').textContent = speed.value;
    $('liveSizeValue').textContent = size.value;

    speed.addEventListener('input', () => { $('liveSpeedValue').textContent = speed.value; });
    size.addEventListener('input', () => { $('liveSizeValue').textContent = size.value; });
    $('liveSettingsButton').addEventListener('click', openNativeSettings);

    $('launchLiveOverlay').addEventListener('click', () => {
      copyLiveSettingsToMain(script, speed, size);
      const launch = $('launchLiveOverlay');
      launch.disabled = true;
      launch.textContent = 'AUTORISATION ANDROID…';
      try {
        launchNativeLive(script.value, Number(speed.value) || 3, Number(size.value) || 36);
      } finally {
        window.setTimeout(() => {
          launch.disabled = false;
          launch.textContent = 'LANCER LE LIVE SUR MON ÉCRAN';
        }, 1800);
      }
    });

    return setup;
  }

  function createModeGate(openLiveSetup) {
    const gate = document.createElement('section');
    gate.id = 'modeGate';
    gate.className = 'modeGate';
    gate.innerHTML = `
      <div class="modeGateInner">
        <div class="modeGateBrand">GROK TÉLÉPROMPTEUR STUDIO</div>
        <h1>Choisis ton mode</h1>
        <p class="modeGateLead">3 studios séparés. Tu peux changer ensuite depuis l’application.</p>
        <button id="gateSettings" type="button" aria-label="Ouvrir les réglages et mises à jour">⚙ RÉGLAGES · MISES À JOUR</button>
        <div class="modeGateChoices">
          <button id="gateClassic" class="modeGateCard classic" type="button">
            <span class="modeGateIcon">▣</span>
            <strong>CLASSIQUE</strong>
            <small>Caméra et téléprompteur dans l’application</small>
          </button>
          <button id="gateGreen" class="modeGateCard green" type="button">
            <span class="modeGateIcon">◉</span>
            <strong>FOND VERT</strong>
            <small>Silhouette détourée sur image ou vidéo</small>
          </button>
          <button id="gateLive" class="modeGateCard live" type="button">
            <span class="modeGateIcon">▤</span>
            <strong>FOND D’ÉCRAN LIVE</strong>
            <small>Caméra + texte flottants pendant que tu te balades sur le téléphone</small>
          </button>
        </div>
      </div>`;
    document.body.appendChild(gate);

    const settings = $('gateSettings');
    settings.style.cssText = [
      'width:100%',
      'min-height:52px',
      'margin:0 0 18px',
      'border-radius:18px',
      'border:1px solid rgba(147,197,253,.5)',
      'background:rgba(15,35,70,.82)',
      'color:#dbeafe',
      'font-weight:900',
      'font-size:14px',
      'letter-spacing:.04em'
    ].join(';');
    settings.addEventListener('click', openNativeSettings);

    $('gateClassic').addEventListener('click', () => {
      $('classicStudioTab')?.click();
      gate.classList.add('hidden');
    });
    $('gateGreen').addEventListener('click', () => {
      $('greenStudioTab')?.click();
      gate.classList.add('hidden');
    });
    $('gateLive').addEventListener('click', () => {
      gate.classList.add('hidden');
      openLiveSetup();
    });
    return gate;
  }

  function addLiveStudioTab(openLiveSetup) {
    const tabs = document.querySelector('.studioModeTabs');
    if (!tabs || $('liveStudioTab')) return;
    const live = document.createElement('button');
    live.id = 'liveStudioTab';
    live.className = 'studioModeButton live';
    live.type = 'button';
    live.innerHTML = '<strong>FOND D’ÉCRAN LIVE</strong><span>Flottant sur le téléphone</span>';
    tabs.appendChild(live);
    live.addEventListener('click', () => {
      document.querySelectorAll('.studioModeButton').forEach((item) => item.classList.remove('active'));
      live.classList.add('active');
      openLiveSetup();
    });
    $('classicStudioTab')?.addEventListener('click', () => live.classList.remove('active'));
    $('greenStudioTab')?.addEventListener('click', () => live.classList.remove('active'));
  }

  function addSettingsShortcut() {
    const switcher = document.querySelector('.studioModeSwitcher');
    if (!switcher || $('studioSettingsButton')) return;
    const button = document.createElement('button');
    button.id = 'studioSettingsButton';
    button.type = 'button';
    button.textContent = '⚙ Réglages · Mises à jour';
    button.style.cssText = [
      'width:100%',
      'min-height:48px',
      'margin-top:10px',
      'border-radius:14px',
      'border:1px solid rgba(147,197,253,.35)',
      'background:rgba(15,35,70,.72)',
      'color:#dbeafe',
      'font-weight:800',
      'font-size:14px'
    ].join(';');
    button.addEventListener('click', openNativeSettings);
    switcher.appendChild(button);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const setup = createLiveSetup();
    let gate;
    const openLiveSetup = () => {
      const script = $('liveScriptInput');
      if (script && $('scriptInput')) script.value = $('scriptInput').value;
      setup.classList.remove('hidden');
    };
    gate = createModeGate(openLiveSetup);
    addLiveStudioTab(openLiveSetup);
    addSettingsShortcut();
    $('closeLiveSetup').addEventListener('click', () => {
      setup.classList.add('hidden');
      gate.classList.remove('hidden');
    });
  });
})();
