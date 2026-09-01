from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"{label}: marker not found in {path}")
    p.write_text(text.replace(old, new, 1))


# Android version
replace_once("app/build.gradle", "versionCode 29", "versionCode 30", "versionCode")
replace_once("app/build.gradle", "versionName '2.17.4'", "versionName '2.17.5'", "versionName")

sw = Path("sw.js")
sw_text = sw.read_text()
if "grok-teleprompter-studio-v24" in sw_text:
    sw.write_text(sw_text.replace("grok-teleprompter-studio-v24", "grok-teleprompter-studio-v25", 1))

# Position slider directly under Pause.
replace_once(
    "index.html",
    '      <section class="gestureHelp" aria-label="Aide tactile">',
    '''      <section class="telePositionBar" aria-label="Position verticale du téléprompteur">
        <div class="telePositionHeader"><strong>Position du téléprompteur</strong><span id="telePositionValue">Bas</span></div>
        <input id="telePositionRange" type="range" min="0" max="100" step="1" value="75" aria-label="Monter ou descendre le téléprompteur">
        <div class="telePositionScale"><span>↑ Haut</span><span>Bas ↓</span></div>
      </section>

      <section class="gestureHelp" aria-label="Aide tactile">''',
    "tele position slider",
)

# Independent camera rotation controls.
replace_once(
    "index.html",
    '      <section class="recordBar">',
    '''      <section class="cameraRotationPicker" aria-label="Rotation réelle de la caméra">
        <div class="formatTitle">Rotation réelle de la caméra</div>
        <div class="rotationChoices">
          <label class="formatChoice rotationChoice">
            <input id="cameraRotation0" name="cameraRotation" type="radio" value="0" checked>
            <span>↥ Normal <strong>0°</strong></span>
          </label>
          <label class="formatChoice rotationChoice">
            <input id="cameraRotationLeft" name="cameraRotation" type="radio" value="-90">
            <span>↺ Caméra <strong>90° gauche</strong></span>
          </label>
          <label class="formatChoice rotationChoice">
            <input id="cameraRotationRight" name="cameraRotation" type="radio" value="90">
            <span>↻ Caméra <strong>90° droite</strong></span>
          </label>
        </div>
        <p class="teleOrientationHint">Ce choix tourne réellement l’image caméra dans l’aperçu et dans la vidéo enregistrée.</p>
      </section>

      <section class="recordBar">''',
    "camera rotation interface",
)

# CSS.
replace_once(
    "style.css",
    ".formatPicker, .teleOrientationPicker, .teleRotationPicker {",
    ".formatPicker, .teleOrientationPicker, .teleRotationPicker, .cameraRotationPicker {",
    "camera rotation picker styles",
)
replace_once(
    "style.css",
    ".faceFrame video, .faceFrame .cameraCutout { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }",
    ".faceFrame video, .faceFrame .cameraCutout { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; transform-origin: center center; will-change: transform; }",
    "camera transform origin",
)
replace_once(
    "style.css",
    ".gestureHelp { display: grid;",
    '''.telePositionBar { padding: 9px 12px 10px; border-bottom: 1px solid rgba(255,255,255,.08); background: #08142d; }
.telePositionHeader, .telePositionScale { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.telePositionHeader { margin-bottom: 6px; color: #dbeafe; font-size: 12px; font-weight: 900; }
.telePositionHeader span { color: #93c5fd; }
.telePositionBar input[type="range"] { width: 100%; height: 38px; accent-color: #8b5cf6; touch-action: pan-x; }
.telePositionScale { color: #8096b8; font-size: 10px; font-weight: 800; }
body[data-mode="media"] .cameraRotationPicker { display: none; }

.gestureHelp { display: grid;''',
    "tele position styles",
)

# DOM refs and state.
replace_once(
    "script.js",
    "    faceFormatVertical: $('faceFormatVertical'), faceFormatHorizontal: $('faceFormatHorizontal'),\n",
    "    faceFormatVertical: $('faceFormatVertical'), faceFormatHorizontal: $('faceFormatHorizontal'),\n    cameraRotation0: $('cameraRotation0'), cameraRotationLeft: $('cameraRotationLeft'), cameraRotationRight: $('cameraRotationRight'),\n",
    "camera rotation refs",
)
replace_once(
    "script.js",
    "    teleResizeHandle: $('teleResizeHandle'), teleScrollState: $('teleScrollState'),\n",
    "    teleResizeHandle: $('teleResizeHandle'), teleScrollState: $('teleScrollState'),\n    telePositionRange: $('telePositionRange'), telePositionValue: $('telePositionValue'),\n",
    "tele position refs",
)
replace_once(
    "script.js",
    "  const DEFAULT_TELE_BOX = { x: .05, y: .09, w: .90, h: .72 };",
    "  const DEFAULT_TELE_BOX = { x: .05, y: .38, w: .90, h: .50 };",
    "lower tele default",
)
replace_once(
    "script.js",
    "    facingMode: 'user', mirrored: true,",
    "    facingMode: 'user', mirrored: true, cameraRotation: 0,",
    "camera rotation state",
)
replace_once(
    "script.js",
    "  const selectedFaceOrientation = () => elements.faceFormatHorizontal.checked ? 'horizontal' : 'vertical';\n",
    "  const selectedFaceOrientation = () => elements.faceFormatHorizontal.checked ? 'horizontal' : 'vertical';\n  const selectedCameraRotation = () => elements.cameraRotationLeft?.checked ? -90 : (elements.cameraRotationRight?.checked ? 90 : 0);\n",
    "selected camera rotation",
)

# Preview transform includes camera rotation and mirror.
old_mirror = '''  function updateMirror() {
    const enabled = state.facingMode === 'user' && state.mirrored;
    elements.cameraVideo.classList.toggle('mirrored', enabled);
    elements.cameraCutout.classList.toggle('mirrored', enabled);
    elements.mirrorBtn.textContent = `Miroir : ${state.mirrored ? 'ON' : 'OFF'}`;
  }'''
new_mirror = '''  function updateCameraVisualTransform() {
    const mirror = state.facingMode === 'user' && state.mirrored;
    const rotation = Number(state.cameraRotation) || 0;
    const rect = elements.faceFrame.getBoundingClientRect();
    const frameWidth = Math.max(1, rect.width || elements.stage.clientWidth * state.face.w || 1);
    const frameHeight = Math.max(1, rect.height || elements.stage.clientHeight * state.face.h || 1);
    const coverScale = rotation === 90 || rotation === -90
      ? Math.max(frameWidth / frameHeight, frameHeight / frameWidth)
      : 1;
    const transform = `rotate(${rotation}deg) scale(${coverScale}) scaleX(${mirror ? -1 : 1})`;
    elements.cameraVideo.style.transform = transform;
    elements.cameraCutout.style.transform = transform;
    elements.cameraVideo.dataset.rotation = String(rotation);
    elements.cameraCutout.dataset.rotation = String(rotation);
  }

  function updateMirror() {
    elements.cameraVideo.classList.remove('mirrored');
    elements.cameraCutout.classList.remove('mirrored');
    updateCameraVisualTransform();
    elements.mirrorBtn.textContent = `Miroir : ${state.mirrored ? 'ON' : 'OFF'}`;
  }

  function applyCameraRotation(rotation = selectedCameraRotation(), announce = true) {
    const numeric = Number(rotation);
    state.cameraRotation = numeric === -90 || numeric === 90 ? numeric : 0;
    updateCameraVisualTransform();
    if (announce) showStatus(state.cameraRotation === -90
      ? 'Caméra tournée à 90° vers la gauche'
      : state.cameraRotation === 90
        ? 'Caméra tournée à 90° vers la droite'
        : 'Rotation caméra normale 0°', false, 2300);
  }'''
replace_once("script.js", old_mirror, new_mirror, "camera preview rotation")

replace_once(
    "script.js",
    "    elements.faceFrame.style.height = `${face.h * 100}%`;\n  }",
    "    elements.faceFrame.style.height = `${face.h * 100}%`;\n    requestAnimationFrame(updateCameraVisualTransform);\n  }",
    "camera transform after face layout",
)

# Teleprompter vertical position slider.
replace_once(
    "script.js",
    "    elements.teleprompter.style.transform = rotation ? `rotate(${rotation}deg)` : 'none';\n    if (!state.teleRunning",
    "    elements.teleprompter.style.transform = rotation ? `rotate(${rotation}deg)` : 'none';\n    updateTelePositionUi();\n    if (!state.teleRunning",
    "tele position ui update",
)
replace_once(
    "script.js",
    "  function applyTeleAspect(announce = true) {",
    '''  function updateTelePositionUi() {
    if (!elements.telePositionRange) return;
    const maxY = Math.max(0, 1 - state.teleBox.h);
    const percent = maxY > .001 ? clamp(state.teleBox.y / maxY * 100, 0, 100) : 50;
    elements.telePositionRange.value = String(Math.round(percent));
    if (elements.telePositionValue) {
      elements.telePositionValue.textContent = percent < 34 ? 'Haut' : percent > 66 ? 'Bas' : 'Milieu';
    }
  }

  function setTeleVerticalPercent(value, announce = false) {
    const maxY = Math.max(0, 1 - state.teleBox.h);
    state.teleBox.y = maxY * clamp(Number(value) || 0, 0, 100) / 100;
    layoutTeleprompter();
    saveScript();
    if (announce) showStatus('Position du téléprompteur réglée');
  }

  function applyTeleAspect(announce = true) {''',
    "tele position helpers",
)

# Recording compositor: camera rotation is baked into the output video.
replace_once(
    "script.js",
    "  function drawImported(context, canvas) {",
    '''  function drawCameraCovered(context, source, x, y, width, height, mirror = false, rotation = 0) {
    const normalized = Number(rotation) === -90 ? -90 : (Number(rotation) === 90 ? 90 : 0);
    if (!normalized) {
      drawCovered(context, source, x, y, width, height, mirror);
      return;
    }
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(normalized * Math.PI / 180);
    drawCovered(context, source, -height / 2, -width / 2, height, width, mirror);
    context.restore();
  }

  function drawImported(context, canvas) {''',
    "camera recording rotation helper",
)
replace_once(
    "script.js",
    "        drawCovered(context, cameraSource, 0, 0, canvas.width, canvas.height, mirrorCamera);",
    "        drawCameraCovered(context, cameraSource, 0, 0, canvas.width, canvas.height, mirrorCamera, state.cameraRotation);",
    "live camera recording rotation",
)
replace_once(
    "script.js",
    "      drawCovered(context, cameraSource, x, y, width, height, mirrorCamera);",
    "      drawCameraCovered(context, cameraSource, x, y, width, height, mirrorCamera, state.cameraRotation);",
    "facecam recording rotation",
)

# Save and restore camera rotation. Migrate old very tall prompt so it can sit lower.
replace_once(
    "script.js",
    "        greenFace: state.greenFace,\n        teleBox: state.teleBox,",
    "        greenFace: state.greenFace,\n        cameraRotation: state.cameraRotation,\n        teleBox: state.teleBox,",
    "save camera rotation",
)
replace_once(
    "script.js",
    "      state.face = { ...state.classicFace };\n      state.teleBox = restoreBox(layout?.teleBox, DEFAULT_TELE_BOX, .24, .20);",
    '''      state.face = { ...state.classicFace };
      state.cameraRotation = Number(layout?.cameraRotation) === -90 ? -90 : (Number(layout?.cameraRotation) === 90 ? 90 : 0);
      elements.cameraRotation0.checked = state.cameraRotation === 0;
      elements.cameraRotationLeft.checked = state.cameraRotation === -90;
      elements.cameraRotationRight.checked = state.cameraRotation === 90;
      state.teleBox = restoreBox(layout?.teleBox, DEFAULT_TELE_BOX, .24, .20);
      if (state.teleBox.h > .62) {
        state.teleBox.h = .50;
        state.teleBox.y = clamp(Math.max(state.teleBox.y, .38), 0, 1 - state.teleBox.h);
      }''',
    "restore camera rotation and migrate prompt",
)

# Controls.
replace_once(
    "script.js",
    "  [elements.teleFormatVertical, elements.teleFormatHorizontal].forEach((input) => input.addEventListener('change', (event) => {",
    '''  [elements.cameraRotation0, elements.cameraRotationLeft, elements.cameraRotationRight].forEach((input) => input.addEventListener('change', (event) => {
    if (!event.target.checked || (state.recorder && state.recorder.state !== 'inactive')) return;
    applyCameraRotation(Number(event.target.value), true);
    saveScript();
  }));
  [elements.teleFormatVertical, elements.teleFormatHorizontal].forEach((input) => input.addEventListener('change', (event) => {''',
    "camera rotation listeners",
)
replace_once(
    "script.js",
    "  elements.speedRange.addEventListener('input', saveScript);",
    "  elements.telePositionRange?.addEventListener('input', (event) => setTeleVerticalPercent(event.target.value));\n  elements.speedRange.addEventListener('input', saveScript);",
    "tele position listener",
)
replace_once("script.js", "state.teleBox.y - .045", "state.teleBox.y - .08", "tele up step")
replace_once("script.js", "state.teleBox.y + .045", "state.teleBox.y + .08", "tele down step")

replace_once(
    "script.js",
    "    state.teleBox = { ...DEFAULT_TELE_BOX };\n    state.teleOrientation = 'free';",
    "    state.teleBox = { ...DEFAULT_TELE_BOX };\n    state.cameraRotation = 0;\n    elements.cameraRotation0.checked = true;\n    elements.cameraRotationLeft.checked = false;\n    elements.cameraRotationRight.checked = false;\n    state.teleOrientation = 'free';",
    "reset camera rotation",
)
replace_once(
    "script.js",
    "      elements.faceFormatVertical, elements.faceFormatHorizontal,\n      elements.segmentationEnabled",
    "      elements.faceFormatVertical, elements.faceFormatHorizontal,\n      elements.cameraRotation0, elements.cameraRotationLeft, elements.cameraRotationRight,\n      elements.segmentationEnabled",
    "disable camera rotation during recording",
)

# Static tests.
audit = Path("tests/static-audit.test.mjs")
audit.write_text(
    audit.read_text()
    + '''

test('camera rotation and lower teleprompter controls are wired end to end', () => {
  assert.match(html, /id="cameraRotationLeft"/);
  assert.match(html, /id="cameraRotationRight"/);
  assert.match(html, /id="telePositionRange"/);
  assert.match(script, /function drawCameraCovered/);
  assert.match(script, /state\.cameraRotation/);
  assert.match(script, /drawCameraCovered\(context, cameraSource/);
  assert.match(script, /function setTeleVerticalPercent/);
  assert.match(script, /DEFAULT_TELE_BOX = \{ x: \.05, y: \.38, w: \.90, h: \.50 \}/);
  assert.match(androidBuild, /versionName '2\.17\.5'/);
});
'''
)

# Mobile interaction tests.
e2e = Path("tests/app.e2e.js")
e2e.write_text(
    e2e.read_text()
    + '''

test('camera rotates both ways and teleprompter can be lowered with the slider', async ({ page }) => {
  const prompt = page.locator('#teleprompter');
  const camera = page.locator('#cameraVideo');
  const slider = page.locator('#telePositionRange');
  await expect(page.locator('.cameraRotationPicker')).toBeVisible();
  await page.locator('label:has(#cameraRotationRight) span').click();
  await expect(page.locator('#cameraRotationRight')).toBeChecked();
  await expect(camera).toHaveAttribute('data-rotation', '90');
  await page.locator('label:has(#cameraRotationLeft) span').click();
  await expect(page.locator('#cameraRotationLeft')).toBeChecked();
  await expect(camera).toHaveAttribute('data-rotation', '-90');
  await page.locator('label:has(#cameraRotation0) span').click();
  await expect(camera).toHaveAttribute('data-rotation', '0');

  const before = await prompt.boundingBox();
  await slider.fill('100');
  const after = await prompt.boundingBox();
  expect(after.y).toBeGreaterThan(before.y + 20);
  await expect(page.locator('#telePositionValue')).toHaveText('Bas');
});
'''
)
