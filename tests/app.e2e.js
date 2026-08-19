const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('networkidle');
});

test('the prompt stays readable and can be moved and resized', async ({ page }) => {
  const empty = page.locator('#empty');
  const prompt = page.locator('#teleprompter');
  await expect(empty).toBeHidden();
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveAttribute('data-scroll-mode', 'static');
  await expect(page.locator('#teleScrollState')).toHaveText('Texte court : reste fixe');

  const start = await prompt.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 14, start.y + start.height / 2 + 22, { steps: 4 });
  await page.mouse.up();
  const moved = await prompt.boundingBox();
  expect(Math.abs(moved.y - start.y)).toBeGreaterThan(10);

  const handle = page.locator('#teleResizeHandle');
  const resize = await handle.boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 - 22, resize.y + resize.height / 2 - 28, { steps: 4 });
  await page.mouse.up();
  const resized = await prompt.boundingBox();
  expect(resized.width).toBeLessThan(moved.width - 10);

  const oldSize = Number(await page.locator('#sizeRange').inputValue());
  await page.locator('#textLargerBtn').click();
  expect(Number(await page.locator('#sizeRange').inputValue())).toBe(oldSize + 3);

  await page.locator('#scriptInput').fill(Array(100).fill('Un texte long pour vérifier le défilement automatique.').join(' '));
  await expect(prompt).toHaveAttribute('data-scroll-mode', 'scroll');
  await expect(page.locator('#teleScrollState')).toHaveText('Texte long : défilement automatique');
});

test('image import and media controls remain coherent', async ({ page }) => {
  await page.locator('#mediaInput').setInputFiles('icon-512.png');
  await page.locator('#mediaTab').click();
  await expect(page.locator('#mediaImage')).toBeVisible();
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#playBtn')).toBeDisabled();
  await expect(page.locator('#pauseBtn')).toBeDisabled();
  await expect(page.locator('#mediaImportLabel')).toHaveText('Changer le média');
  await expect(page.locator('#mediaInfo')).toContainText('icon-512.png');
  await expect(page.locator('#mediaInfo')).toHaveText(/Image · icon-512\.png · \d+ × \d+/);
});

test('imported media records a voice-over with a visible teleprompter and no camera', async ({ page }) => {
  const prompt = page.locator('#teleprompter');
  const longScript = Array(100).fill('Je lis mon texte pendant que la vidéo importée reste seule dans le fichier final.').join(' ');

  await page.locator('#mediaInput').setInputFiles('icon-512.png');
  await page.locator('#mediaTab').click();
  await page.locator('#scriptInput').fill(longScript);

  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveAttribute('data-scroll-mode', 'scroll');
  await expect(page.locator('#teleControls')).toBeVisible();
  await expect(page.locator('#teleScrollState')).toHaveText('Texte long : défilement automatique');
  await expect(page.locator('#faceFrame')).toBeHidden();
  await expect(page.locator('#cameraBtn')).toBeHidden();
  await expect(page.locator('#cameraControls')).toBeHidden();

  const before = await prompt.boundingBox();
  await page.locator('#textDownBtn').click();
  const moved = await prompt.boundingBox();
  expect(Math.abs(moved.y - before.y)).toBeGreaterThan(10);

  await page.locator('#recBtn').click();
  await expect(page.locator('#stopBtn')).toBeEnabled({ timeout: 10_000 });
  await expect(prompt).toBeVisible();
  await page.waitForTimeout(700);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#download')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#discardRecording')).toBeVisible();
  await expect(page.locator('#recordQuality')).toContainText('prête à télécharger');

  await page.locator('#recBtn').click();
  await expect(page.locator('#stopBtn')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('prise précédente');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#discardRecording').click();
  await expect(page.locator('#resultActions')).toBeHidden();
});

test('imported media keeps its own format when the webcam orientation changes', async ({ page }) => {
  await page.locator('#mediaInput').setInputFiles('icon-512.png');
  await expect(page.locator('#faceFormatVertical')).toBeChecked();
  const automaticStage = await page.locator('#stage').boundingBox();
  expect(Math.abs(automaticStage.width - automaticStage.height)).toBeLessThan(3);

  await page.locator('label.formatChoice').filter({ has: page.locator('#faceFormatHorizontal') }).click();
  await expect(page.locator('#faceFormatHorizontal')).toBeChecked();
  const unchangedStage = await page.locator('#stage').boundingBox();
  expect(Math.abs(unchangedStage.width - unchangedStage.height)).toBeLessThan(3);

  await page.reload();
  await expect(page.locator('#faceFormatHorizontal')).toBeChecked();
});

test('camera, microphone, facecam gestures and recording work together', async ({ page }) => {
  await page.locator('#mediaInput').setInputFiles('icon-512.png');
  await expect(page.locator('#includeMicrophone')).toBeChecked();
  await expect(page.locator('#includeMediaAudio')).not.toBeChecked();
  await expect(page.locator('#mediaVolumeRange')).toBeDisabled();
  await expect(page.locator('#micVolumeValue')).toHaveText('130 %');
  await page.locator('#cameraBtn').click();
  await expect(page.locator('#cameraBtn')).toHaveText('Caméra activée', { timeout: 15_000 });
  await expect(page.locator('#faceFrame')).toBeVisible();
  await expect(page.locator('#cameraHelp')).toBeHidden();
  await expect(page.locator('#audioLabel')).not.toContainText('micro non activé');
  expect(await page.locator('#cameraVideo').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);

  const frame = page.locator('#faceFrame');
  await frame.scrollIntoViewIfNeeded();
  const vertical = await frame.boundingBox();
  expect(vertical.width / vertical.height).toBeLessThan(.65);
  await page.locator('label.formatChoice').filter({ has: page.locator('#faceFormatHorizontal') }).click();
  await expect(page.locator('#faceFormatHorizontal')).toBeChecked();
  const start = await frame.boundingBox();
  expect(start.width / start.height).toBeGreaterThan(1.65);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 24, start.y + start.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  const moved = await frame.boundingBox();
  expect(Math.abs(moved.x - start.x) + Math.abs(moved.y - start.y)).toBeGreaterThan(18);

  const handle = page.locator('#faceResizeHandle');
  const resize = await handle.boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 + 25, resize.y + resize.height / 2 + 25, { steps: 4 });
  await page.mouse.up();
  const enlarged = await frame.boundingBox();
  expect(enlarged.width).toBeGreaterThan(moved.width + 10);

  await page.locator('#mediaAudioToggleLabel').click();
  await expect(page.locator('#includeMediaAudio')).toBeChecked();
  await page.locator('#mediaVolumeRange').fill('55');
  await expect(page.locator('#mediaVolumeValue')).toHaveText('55 %');
  await page.locator('#micVolumeRange').fill('150');
  await expect(page.locator('#micVolumeValue')).toHaveText('150 %');

  await page.locator('#recBtn').click();
  await expect(page.locator('#stopBtn')).toBeEnabled({ timeout: 10_000 });
  const beforeRecordingMove = await frame.boundingBox();
  await page.mouse.move(beforeRecordingMove.x + beforeRecordingMove.width / 2,
    beforeRecordingMove.y + beforeRecordingMove.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeRecordingMove.x + beforeRecordingMove.width / 2 - 22,
    beforeRecordingMove.y + beforeRecordingMove.height / 2 + 18, { steps: 4 });
  await page.mouse.up();
  const movedDuringRecording = await frame.boundingBox();
  expect(Math.abs(movedDuringRecording.x - beforeRecordingMove.x)
    + Math.abs(movedDuringRecording.y - beforeRecordingMove.y)).toBeGreaterThan(12);
  await page.waitForTimeout(1200);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#download')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#recordQuality')).toContainText('prête à télécharger');
  await expect(page.locator('#download')).toHaveText('⬇ Télécharger la vidéo');
});

test('recording still starts when an enabled microphone is unavailable', async ({ page }) => {
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints?.audio && !constraints?.video) {
        return Promise.reject(new DOMException('Permission micro refusée', 'NotAllowedError'));
      }
      return original(constraints);
    };
  });
  await page.locator('#mediaInput').setInputFiles('icon-512.png');
  await page.locator('#cameraBtn').click();
  await expect(page.locator('#faceFrame')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#microphoneHelp')).toBeVisible();
  await expect(page.locator('#audioLabel')).toContainText('aucun micro actif');

  await page.locator('#recBtn').click();
  await expect(page.locator('#stopBtn')).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator('#recordQuality')).toContainText('sans son');
  await expect(page.locator('#microphoneHelp')).toBeVisible();
  await page.waitForTimeout(500);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#download')).toBeVisible({ timeout: 15_000 });

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#discardRecording').click();
  await expect(page.locator('#resultActions')).toBeHidden();
  await page.locator('#microphoneToggleLabel').click();
  await expect(page.locator('#includeMicrophone')).not.toBeChecked();
  await page.locator('#recBtn').click();
  await expect(page.locator('#stopBtn')).toBeEnabled({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#download')).toBeVisible({ timeout: 15_000 });
});

test('the APK exclusively uses the Android camcorder microphone', async ({ page }) => {
  await page.evaluate(() => {
    window.__webViewAudioRequests = 0;
    window.AndroidBridge = {
      startNativeMicrophone: () => 48000,
      stopNativeMicrophone: () => {},
      openAppSettings: () => {}
    };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints?.audio && !constraints?.video) {
        window.__webViewAudioRequests += 1;
        return Promise.reject(new DOMException('WebView ne peut pas lire le micro', 'NotReadableError'));
      }
      return original(constraints);
    };
  });

  await page.locator('#mediaInput').setInputFiles('icon-512.png');
  await page.locator('#cameraBtn').click();
  await expect(page.locator('#cameraBtn')).toHaveText('Caméra activée', { timeout: 15_000 });
  await expect(page.locator('#audioLabel')).toContainText('micro caméra direct');
  await expect(page.locator('#audioLabel')).toContainText('48 kHz');
  await expect(page.locator('#microphoneHelp')).toBeHidden();
  expect(await page.evaluate(() => window.__webViewAudioRequests)).toBe(0);

  await page.locator('#recBtn').click();
  await expect(page.locator('#stopBtn')).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator('#recordQuality')).toContainText('micro caméra 48 kHz');
  await page.waitForTimeout(500);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#download')).toBeVisible({ timeout: 15_000 });
});
