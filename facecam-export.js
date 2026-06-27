window.addEventListener('DOMContentLoaded', () => {
  const mode = document.getElementById('modeFacecamBtn');
  const video = document.getElementById('importedVideo');
  const cam = document.getElementById('cameraPreview');
  const input = document.getElementById('videoInput');
  const wrap = document.querySelector('.preview-container');
  if (!mode || !video || !cam || !input || !wrap) return;

  const capName = 'capture' + 'Stream';
  const mozName = 'mozCapture' + 'Stream';
  const oldCap = video[capName] ? video[capName].bind(video) : null;
  const oldMoz = video[mozName] ? video[mozName].bind(video) : null;

  input.accept = 'video/*,image/*';

  const image = new Image();
  image.style.cssText = 'display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1';
  wrap.appendChild(image);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let imageMode = false;
  let imageUrl = '';
  let loop = 0;

  function on() { return mode.classList.contains('active'); }

  function fit(src, x, y, w, h) {
    const sw0 = src.videoWidth || src.naturalWidth || w;
    const sh0 = src.videoHeight || src.naturalHeight || h;
    const scale = Math.max(w / sw0, h / sh0);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(src, (sw0 - sw) / 2, (sh0 - sh) / 2, sw, sh, x, y, w, h);
  }

  function updateSize() {
    canvas.width = imageMode ? (image.naturalWidth || 720) : (video.videoWidth || 720);
    canvas.height = imageMode ? (image.naturalHeight || 1280) : (video.videoHeight || 1280);
  }

  function draw() {
    updateSize();
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (imageMode && image.complete) fit(image, 0, 0, w, h);
    if (!imageMode && video.readyState >= 2) fit(video, 0, 0, w, h);
    if (cam.readyState >= 2) {
      const a = wrap.getBoundingClientRect();
      const b = cam.getBoundingClientRect();
      const x = Math.round(((b.left - a.left) / a.width) * w);
      const y = Math.round(((b.top - a.top) / a.height) * h);
      const cw = Math.round((b.width / a.width) * w);
      const ch = Math.round((b.height / a.height) * h);
      fit(cam, x, y, cw, ch);
      ctx.lineWidth = Math.max(4, Math.round(w * 0.006));
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(x, y, cw, ch);
    }
    loop = requestAnimationFrame(draw);
  }

  function start() {
    if (loop) cancelAnimationFrame(loop);
    updateSize();
    draw();
  }

  function stream() {
    if (!on()) return oldCap ? oldCap() : new MediaStream();
    start();
    return canvas[capName](30);
  }

  video[capName] = stream;
  video[mozName] = () => on() ? stream() : (oldMoz ? oldMoz() : stream());

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      imageMode = true;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(file);
      image.src = imageUrl;
      image.style.display = 'block';
      video.src = imageUrl;
      video.style.display = 'none';
      if (typeof setStatus === 'function') setStatus('Image importee prete', 'success');
    } else {
      imageMode = false;
      image.style.display = 'none';
    }
  });

  document.getElementById('recordBtn').addEventListener('click', () => { if (on()) start(); }, true);
  document.getElementById('stopBtn').addEventListener('click', () => {
    setTimeout(() => { if (loop) cancelAnimationFrame(loop); loop = 0; }, 1400);
  }, true);
});
