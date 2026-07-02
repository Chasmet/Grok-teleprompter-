/* Correctif Mode Live : affiche un vrai teleprompteur lisible au-dessus de la camera. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const scriptInput = $('scriptInput');
  const speedRange = $('speedRange');
  const sizeRange = $('sizeRange');
  const recBtn = $('recBtn');
  const stopBtn = $('stopBtn');
  const liveTab = $('liveTab');
  const mediaTab = $('mediaTab');
  const faceTab = $('faceTab');

  if (!stage || !scriptInput) return;

  const style = document.createElement('style');
  style.textContent = `
    .teleprompter-live-layer{
      position:absolute;
      left:4%;
      right:4%;
      top:8%;
      bottom:14%;
      z-index:40;
      pointer-events:none;
      display:flex;
      align-items:center;
      justify-content:center;
      overflow:hidden;
      border-radius:18px;
      background:linear-gradient(180deg, rgba(0,0,0,.10), rgba(0,0,0,.42));
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);
    }
    .teleprompter-live-layer.hidden-live-prompt{display:none!important}
    .teleprompter-live-text{
      width:100%;
      padding:28px 18px;
      color:#fff;
      font-weight:950;
      line-height:1.28;
      text-align:center;
      text-shadow:0 4px 12px #000, 0 0 22px #000;
      white-space:pre-wrap;
      will-change:transform;
    }
    .teleprompter-live-layer::before,
    .teleprompter-live-layer::after{
      content:"";
      position:absolute;
      left:0;
      right:0;
      height:23%;
      z-index:2;
      pointer-events:none;
    }
    .teleprompter-live-layer::before{top:0;background:linear-gradient(#000c,#0000)}
    .teleprompter-live-layer::after{bottom:0;background:linear-gradient(#0000,#000c)}
    .teleprompter-live-guide{
      position:absolute;
      left:7%;
      right:7%;
      top:50%;
      height:2px;
      z-index:3;
      background:linear-gradient(90deg, transparent, rgba(255,255,255,.85), transparent);
      opacity:.75;
    }
    @media(max-width:430px){
      .teleprompter-live-layer{left:3%;right:3%;top:7%;bottom:12%;border-radius:14px}
      .teleprompter-live-text{padding:22px 12px;line-height:1.23}
    }
  `;
  document.head.appendChild(style);

  const layer = document.createElement('div');
  layer.id = 'teleprompterLiveLayer';
  layer.className = 'teleprompter-live-layer';
  layer.innerHTML = '<div class="teleprompter-live-guide"></div><div id="teleprompterLiveText" class="teleprompter-live-text"></div>';
  stage.appendChild(layer);

  const textEl = $('teleprompterLiveText');
  let raf = 0;
  let start = 0;
  let running = false;

  function activeMode() {
    if (liveTab && liveTab.classList.contains('active')) return 'live';
    if (faceTab && faceTab.classList.contains('active')) return 'facecam';
    if (mediaTab && mediaTab.classList.contains('active')) return 'media';
    return 'facecam';
  }

  function getText() {
    return (scriptInput.value || '').trim();
  }

  function getSize() {
    const value = Number(sizeRange?.value || 36);
    return Math.max(22, Math.min(82, value));
  }

  function getSpeedPxPerSecond() {
    const value = Number(speedRange?.value || 3);
    return 10 + Math.max(1, Math.min(10, value)) * 9;
  }

  function syncText(reset = false) {
    const text = getText();
    textEl.textContent = text || 'Écris ton texte ici.';
    textEl.style.fontSize = getSize() + 'px';
    if (reset) textEl.style.transform = 'translateY(0px)';
    updateVisibility();
  }

  function updateVisibility() {
    const hasText = !!getText();
    const mode = activeMode();
    // Visible en Live et Facecam. Cache en Video importee seule pour ne pas gêner.
    const visible = hasText && (mode === 'live' || mode === 'facecam');
    layer.classList.toggle('hidden-live-prompt', !visible);
  }

  function stopScroll(reset = false) {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (reset) textEl.style.transform = 'translateY(0px)';
  }

  function startScroll() {
    syncText(true);
    if (!getText()) return;
    running = true;
    start = performance.now();

    const loop = (now) => {
      if (!running) return;
      const elapsed = (now - start) / 1000;
      const layerH = layer.clientHeight || 1;
      const textH = textEl.scrollHeight || 1;
      const maxMove = Math.max(0, textH + layerH * 0.58);
      const y = Math.min(maxMove, elapsed * getSpeedPxPerSecond());
      textEl.style.transform = `translateY(${-y}px)`;
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
  }

  scriptInput.addEventListener('input', () => syncText(false));
  sizeRange?.addEventListener('input', () => syncText(false));
  speedRange?.addEventListener('input', () => {});

  [liveTab, mediaTab, faceTab].forEach((btn) => {
    btn?.addEventListener('click', () => {
      setTimeout(() => {
        stopScroll(true);
        syncText(true);
      }, 80);
    });
  });

  recBtn?.addEventListener('click', () => {
    setTimeout(() => {
      // Si Stop devient actif, l'enregistrement a bien commencé.
      if (stopBtn && !stopBtn.disabled) startScroll();
    }, 350);
  });

  stopBtn?.addEventListener('click', () => {
    setTimeout(() => stopScroll(true), 150);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopScroll(false);
  });

  syncText(true);
})();
