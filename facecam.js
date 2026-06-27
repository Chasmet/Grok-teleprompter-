window.addEventListener('DOMContentLoaded', () => {
  const modeLiveBtn = document.getElementById('modeLiveBtn');
  const modeVideoBtn = document.getElementById('modeVideoBtn');
  const modeFacecamBtn = document.getElementById('modeFacecamBtn');
  const livePanel = document.getElementById('livePanel');
  const videoPanel = document.getElementById('videoPanel');
  const facecamPanel = document.getElementById('facecamPanel');
  const cameraPreview = document.getElementById('cameraPreview');
  const importedVideo = document.getElementById('importedVideo');
  const previewContainer = document.querySelector('.preview-container');

  if (!modeFacecamBtn || !facecamPanel) return;

  const box = { x: 0.58, y: 0.56, w: 0.34, h: 0.30 };
  let drag = false;
  let ox = 0;
  let oy = 0;

  function applyFacecam() {
    importedVideo.muted = true;
    importedVideo.defaultMuted = true;
    importedVideo.style.display = 'block';
    importedVideo.classList.add('facecam-bg');
    cameraPreview.style.display = cameraPreview.srcObject ? 'block' : 'none';
    cameraPreview.classList.add('facecam-window');
    cameraPreview.style.left = `${box.x * 100}%`;
    cameraPreview.style.top = `${box.y * 100}%`;
    cameraPreview.style.width = `${box.w * 100}%`;
    cameraPreview.style.height = `${box.h * 100}%`;
  }

  function setFacecamMode() {
    window.activeMode = 'facecam';
    modeLiveBtn.classList.remove('active');
    modeVideoBtn.classList.remove('active');
    modeFacecamBtn.classList.add('active');
    livePanel.style.display = 'none';
    videoPanel.style.display = 'none';
    facecamPanel.style.display = 'grid';
    applyFacecam();
  }

  function exitFacecam() {
    facecamPanel.style.display = 'none';
    cameraPreview.classList.remove('facecam-window');
    importedVideo.classList.remove('facecam-bg');
  }

  function resize(delta) {
    box.w = Math.max(0.18, Math.min(0.58, box.w + delta));
    box.h = Math.max(0.16, Math.min(0.50, box.h + delta * 0.75));
    box.x = Math.min(box.x, 1 - box.w - 0.02);
    box.y = Math.min(box.y, 1 - box.h - 0.02);
    applyFacecam();
  }

  function place(pos) {
    const m = 0.04;
    if (pos === 'tl') { box.x = m; box.y = m; }
    if (pos === 'tr') { box.x = 1 - box.w - m; box.y = m; }
    if (pos === 'br') { box.x = 1 - box.w - m; box.y = 1 - box.h - m; }
    applyFacecam();
  }

  modeFacecamBtn.addEventListener('click', setFacecamMode);
  modeLiveBtn.addEventListener('click', exitFacecam);
  modeVideoBtn.addEventListener('click', exitFacecam);

  document.getElementById('facecamCameraBtn').addEventListener('click', () => document.getElementById('cameraBtn').click());
  document.getElementById('facecamPlayBtn').addEventListener('click', () => { importedVideo.play(); });
  document.getElementById('facecamPauseBtn').addEventListener('click', () => { importedVideo.pause(); });
  document.getElementById('facecamSmallBtn').addEventListener('click', () => resize(-0.05));
  document.getElementById('facecamBigBtn').addEventListener('click', () => resize(0.05));
  document.getElementById('facecamTopLeftBtn').addEventListener('click', () => place('tl'));
  document.getElementById('facecamTopRightBtn').addEventListener('click', () => place('tr'));
  document.getElementById('facecamBottomRightBtn').addEventListener('click', () => place('br'));

  cameraPreview.addEventListener('pointerdown', (event) => {
    if (!modeFacecamBtn.classList.contains('active')) return;
    const rect = previewContainer.getBoundingClientRect();
    drag = true;
    ox = (event.clientX - rect.left) / rect.width - box.x;
    oy = (event.clientY - rect.top) / rect.height - box.y;
    cameraPreview.setPointerCapture(event.pointerId);
  });

  cameraPreview.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const rect = previewContainer.getBoundingClientRect();
    box.x = Math.max(0.02, Math.min(1 - box.w - 0.02, (event.clientX - rect.left) / rect.width - ox));
    box.y = Math.max(0.02, Math.min(1 - box.h - 0.02, (event.clientY - rect.top) / rect.height - oy));
    applyFacecam();
  });

  cameraPreview.addEventListener('pointerup', () => { drag = false; });
  cameraPreview.addEventListener('pointercancel', () => { drag = false; });
});
