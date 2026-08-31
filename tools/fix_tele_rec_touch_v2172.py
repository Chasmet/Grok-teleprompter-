from pathlib import Path

# 1) Allow the teleprompter surface to receive real touch input while recording.
css_path = Path('style.css')
css = css_path.read_text()
old_css = 'body.recording .teleprompter { pointer-events: none; border-color: transparent; }'
new_css = 'body.recording .teleprompter { pointer-events: auto; touch-action: none; border-color: transparent; }'
if old_css not in css:
    raise SystemExit('recording teleprompter pointer-events rule not found')
css_path.write_text(css.replace(old_css, new_css, 1))

# 2) Replace the body-text pointer gesture with a global, geometry-based gesture.
# This avoids Android WebView losing the gesture when REC changes the visible layers.
script_path = Path('script.js')
script = script_path.read_text()
start_marker = "  elements.teleprompter.addEventListener('pointerdown', (event) => {\n    if (event.target === elements.teleResizeHandle || event.target === elements.teleMoveHandle || state.teleTouchPointer !== -1) return;"
end_marker = "  elements.teleprompter.addEventListener('pointercancel', finishTeleTouch);"
start = script.find(start_marker)
if start < 0:
    raise SystemExit('teleprompter text pointerdown block not found')
end = script.find(end_marker, start)
if end < 0:
    raise SystemExit('teleprompter text finish block not found')
end += len(end_marker)

new_block = r'''  const pointInsideTeleprompter = (clientX, clientY) => {
    if (elements.teleprompter.classList.contains('hide')) return false;
    const box = elements.teleprompter.getBoundingClientRect();
    return clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
  };

  const teleTextGestureBlocked = (target) => {
    if (!target) return false;
    if (elements.teleMoveHandle?.contains(target) || elements.teleResizeHandle?.contains(target)) return true;
    if (!elements.faceFrame.classList.contains('hide') && elements.faceFrame.contains(target)) return true;
    return false;
  };

  const beginTeleTextPointer = (event) => {
    if (event.pointerType === 'touch') return;
    if (state.teleTouchPointer !== -1 || teleTextGestureBlocked(event.target)) return;
    if (!pointInsideTeleprompter(event.clientX, event.clientY)) return;
    state.teleTouchPointer = event.pointerId;
    state.teleTouchStartY = event.clientY;
    state.teleOffsetPx = currentTeleOffset();
    state.teleTouchStartOffset = state.teleOffsetPx;
    state.teleTouchWasRunning = state.teleRunning && !state.telePaused;
    if (state.teleTouchWasRunning) {
      state.teleRunning = false;
      if (state.teleRaf) cancelAnimationFrame(state.teleRaf);
      state.teleRaf = 0;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener('pointerdown', beginTeleTextPointer, true);
  window.addEventListener('pointermove', (event) => {
    if (event.pointerId !== state.teleTouchPointer) return;
    const delta = event.clientY - state.teleTouchStartY;
    setTeleOffset(state.teleTouchStartOffset - delta);
    event.preventDefault();
  }, true);

  const finishTeleTouch = (event) => {
    if (event.pointerId !== state.teleTouchPointer) return;
    const resumeAfterTouch = state.teleTouchWasRunning && !state.telePaused && teleHasText();
    state.teleTouchPointer = -1;
    state.teleTouchWasRunning = false;
    if (resumeAfterTouch) {
      updateTeleScrollMode();
      if (state.teleShouldScroll && state.teleOffsetPx < maxTeleMove()) runTeleprompterFrom(state.teleOffsetPx);
      else setTeleOffset(state.teleOffsetPx);
    }
    event.preventDefault();
  };
  window.addEventListener('pointerup', finishTeleTouch, true);
  window.addEventListener('pointercancel', finishTeleTouch, true);

  let teleNativeTouchId = null;
  let teleNativeTouchStartY = 0;
  let teleNativeTouchStartOffset = 0;
  let teleNativeTouchWasRunning = false;

  document.addEventListener('touchstart', (event) => {
    if (teleNativeTouchId !== null || teleTextGestureBlocked(event.target)) return;
    const touch = event.changedTouches?.[0];
    if (!touch || !pointInsideTeleprompter(touch.clientX, touch.clientY)) return;
    teleNativeTouchId = touch.identifier;
    teleNativeTouchStartY = touch.clientY;
    state.teleOffsetPx = currentTeleOffset();
    teleNativeTouchStartOffset = state.teleOffsetPx;
    teleNativeTouchWasRunning = state.teleRunning && !state.telePaused;
    if (teleNativeTouchWasRunning) {
      state.teleRunning = false;
      if (state.teleRaf) cancelAnimationFrame(state.teleRaf);
      state.teleRaf = 0;
    }
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false, capture: true });

  document.addEventListener('touchmove', (event) => {
    if (teleNativeTouchId === null) return;
    const touch = Array.from(event.touches || []).find((item) => item.identifier === teleNativeTouchId);
    if (!touch) return;
    const delta = touch.clientY - teleNativeTouchStartY;
    setTeleOffset(teleNativeTouchStartOffset - delta);
    event.preventDefault();
  }, { passive: false, capture: true });

  const finishNativeTeleTouch = (event) => {
    if (teleNativeTouchId === null) return;
    const touch = Array.from(event.changedTouches || []).find((item) => item.identifier === teleNativeTouchId);
    if (!touch && event.type !== 'touchcancel') return;
    const resumeAfterTouch = teleNativeTouchWasRunning && !state.telePaused && teleHasText();
    teleNativeTouchId = null;
    teleNativeTouchWasRunning = false;
    if (resumeAfterTouch) {
      updateTeleScrollMode();
      if (state.teleShouldScroll && state.teleOffsetPx < maxTeleMove()) runTeleprompterFrom(state.teleOffsetPx);
      else setTeleOffset(state.teleOffsetPx);
    }
    event.preventDefault();
  };
  document.addEventListener('touchend', finishNativeTeleTouch, { passive: false, capture: true });
  document.addEventListener('touchcancel', finishNativeTeleTouch, { passive: false, capture: true });'''

script = script[:start] + new_block + script[end:]
script_path.write_text(script)

# 3) Bump the Android update version.
gradle_path = Path('app/build.gradle')
gradle = gradle_path.read_text()
if "versionCode 26" not in gradle or "versionName '2.17.1'" not in gradle:
    raise SystemExit('expected Android version 2.17.1 not found')
gradle = gradle.replace('versionCode 26', 'versionCode 27', 1)
gradle = gradle.replace("versionName '2.17.1'", "versionName '2.17.2'", 1)
gradle_path.write_text(gradle)

# 4) Replace the synthetic test with a real, hit-tested drag while recording.
test_path = Path('tests/app.e2e.js')
test = test_path.read_text()
old = """  const beforeTextDrag = await page.locator('#teleText').evaluate((el) => Math.abs(Number.parseFloat((el.style.transform.match(/-?[0-9.]+/) || ['0'])[0])) || 0);
  await page.evaluate(() => {
    document.body.classList.add('recording');
    const tele = document.querySelector('#teleprompter');
    tele.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77, pointerType: 'touch', clientY: 220 }));
    tele.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 77, pointerType: 'touch', clientY: 150 }));
    tele.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 77, pointerType: 'touch', clientY: 150 }));
    document.body.classList.remove('recording');
  });
  const afterTextDrag = await page.locator('#teleText').evaluate((el) => Math.abs(Number.parseFloat((el.style.transform.match(/-?[0-9.]+/) || ['0'])[0])) || 0);
  expect(afterTextDrag).toBeGreaterThan(beforeTextDrag + 20);"""
new = """  const beforeTextDrag = await page.locator('#teleText').evaluate((el) => Math.abs(Number.parseFloat((el.style.transform.match(/-?[0-9.]+/) || ['0'])[0])) || 0);
  await page.evaluate(() => document.body.classList.add('recording'));
  await expect(prompt).toHaveCSS('pointer-events', 'auto');
  const recBox = await prompt.boundingBox();
  const dragX = recBox.x + recBox.width * 0.28;
  const dragStartY = recBox.y + recBox.height * 0.68;
  const dragEndY = recBox.y + recBox.height * 0.36;
  const hitInside = await page.evaluate(({ x, y }) => {
    const tele = document.querySelector('#teleprompter');
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === tele || tele.contains(hit)));
  }, { x: dragX, y: dragStartY });
  expect(hitInside).toBeTruthy();
  await page.mouse.move(dragX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragX, dragEndY, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => document.body.classList.remove('recording'));
  const afterTextDrag = await page.locator('#teleText').evaluate((el) => Math.abs(Number.parseFloat((el.style.transform.match(/-?[0-9.]+/) || ['0'])[0])) || 0);
  expect(afterTextDrag).toBeGreaterThan(beforeTextDrag + 20);"""
if old not in test:
    raise SystemExit('synthetic recording drag test block not found')
test_path.write_text(test.replace(old, new, 1))
