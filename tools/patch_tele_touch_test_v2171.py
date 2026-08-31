from pathlib import Path

p = Path('tests/app.e2e.js')
s = p.read_text()

old_move = """  const start = await prompt.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 14, start.y + start.height / 2 + 22, { steps: 4 });
  await page.mouse.up();
  const moved = await prompt.boundingBox();
  expect(Math.abs(moved.y - start.y)).toBeGreaterThan(10);"""

new_move = """  const start = await prompt.boundingBox();
  const moveHandle = page.locator('#teleMoveHandle');
  const move = await moveHandle.boundingBox();
  await page.mouse.move(move.x + move.width / 2, move.y + move.height / 2);
  await page.mouse.down();
  await page.mouse.move(move.x + move.width / 2 - 14, move.y + move.height / 2 + 22, { steps: 4 });
  await page.mouse.up();
  const moved = await prompt.boundingBox();
  expect(Math.abs(moved.y - start.y)).toBeGreaterThan(10);"""

if old_move not in s:
    raise SystemExit('old move test not found')
s = s.replace(old_move, new_move, 1)

marker = """  await expect(prompt).toHaveAttribute('data-scroll-mode', 'scroll');
  await expect(page.locator('#teleScrollState')).toHaveText('Texte long : défilement automatique');"""

extra = marker + """

  const beforeTextDrag = await page.locator('#teleScroll').evaluate((el) => Number.parseFloat(el.style.getPropertyValue('--move')) || 0);
  await page.evaluate(() => {
    document.body.classList.add('recording');
    const tele = document.querySelector('#teleprompter');
    tele.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77, pointerType: 'touch', clientY: 220 }));
    tele.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 77, pointerType: 'touch', clientY: 150 }));
    tele.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 77, pointerType: 'touch', clientY: 150 }));
    document.body.classList.remove('recording');
  });
  const afterTextDrag = await page.locator('#teleScroll').evaluate((el) => Number.parseFloat(el.style.getPropertyValue('--move')) || 0);
  expect(afterTextDrag).toBeGreaterThan(beforeTextDrag + 20);"""

if marker not in s:
    raise SystemExit('scroll marker not found')
s = s.replace(marker, extra, 1)
p.write_text(s)
