from pathlib import Path

# 1) Allow the teleprompter surface to receive real touch input while recording.
css_path = Path('style.css')
css = css_path.read_text()
old_css = 'body.recording .teleprompter { pointer-events: none; border-color: transparent; }'
new_css = 'body.recording .teleprompter { pointer-events: auto; touch-action: none; border-color: transparent; }'
if old_css not in css:
    raise SystemExit('recording teleprompter pointer-events rule not found')
css_path.write_text(css.replace(old_css, new_css, 1))

# 2) Make teleprompter text dragging robust in Android WebView.
script_path = Path('script.js')
script = script_path.read_text()

old_pointerdown = """  elements.teleprompter.addEventListener('pointerdown', (event) => {
    if (event.target === elements.teleResizeHandle || event.target === elements.teleMoveHandle || state.teleTouchPointer !== -1) return;"""
new_pointerdown = """  elements.teleprompter.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') return;
    if (event.target === elements.teleResizeHandle || event.target === elements.teleMoveHandle || state.teleTouchPointer !== -1) return;"""
if old_pointerdown not in script:
    raise SystemExit('teleprompter pointerdown block not found')
script = script.replace(old_pointerdown, new_pointerdown, 1)

old_move = "  elements.teleprompter.addEventListener('pointermove', (event) => {"
new_move = "  window.addEventListener('pointermove', (event) => {"
if old_move not in script:
    raise SystemExit('teleprompter pointermove listener not found')
script = script.replace(old_move, new_move, 1)

old_finish = """  elements.teleprompter.addEventListener('pointerup', finishTeleTouch);
  elements.teleprompter.addEventListener('pointercancel', finishTeleTouch);"""
new_finish = """  window.addEventListener('pointerup', finishTeleTouch, true);
  window.addEventListener('pointercancel', finishTeleTouch, true);

  let teleNativeTouchId = null;
  let teleNativeTouchStartY = 0;
  let teleNativeTouchStartOffset = 0;
  let teleNativeTouchWasRunning = false;

  elements.teleprompter.addEventListener('touchstart', (event) => {
    if (event.target === elements.teleResizeHandle || event.target === elements.teleMoveHandle || teleNativeTouchId !== null) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
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
  }, { passive: false });

  elements.teleprompter.addEventListener('touchmove', (event) => {
    if (teleNativeTouchId === null) return;
    const touch = Array.from(event.touches || []).find((item) => item.identifier === teleNativeTouchId);
    if (!touch) return;
    const delta = touch.clientY - teleNativeTouchStartY;
    setTeleOffset(teleNativeTouchStartOffset - delta);
    event.preventDefault();
  }, { passive: false });

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
  elements.teleprompter.addEventListener('touchend', finishNativeTeleTouch, { passive: false });
  elements.teleprompter.addEventListener('touchcancel', finishNativeTeleTouch, { passive: false });"""
if old_finish not in script:
    raise SystemExit('teleprompter pointer finish listeners not found')
script = script.replace(old_finish, new_finish, 1)
script_path.write_text(script)

# 3) Bump the Android update version.
gradle_path = Path('app/build.gradle')
gradle = gradle_path.read_text()
if "versionCode 26" not in gradle or "versionName '2.17.1'" not in gradle:
    raise SystemExit('expected Android version 2.17.1 not found')
gradle = gradle.replace('versionCode 26', 'versionCode 27', 1)
gradle = gradle.replace("versionName '2.17.1'", "versionName '2.17.2'", 1)
gradle_path.write_text(gradle)

# 4) Replace the synthetic event test with a real hit-tested drag while recording.
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
