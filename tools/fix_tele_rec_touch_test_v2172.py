from pathlib import Path

p = Path('tests/app.e2e.js')
s = p.read_text()
start_marker = "  const recBox = await prompt.boundingBox();\n"
end_marker = "  const cdp = await page.context().newCDPSession(page);\n"
start = s.find(start_marker)
if start < 0:
    raise SystemExit('REC touch test start marker not found')
end = s.find(end_marker, start)
if end < 0:
    raise SystemExit('REC touch test CDP marker not found')

replacement = r'''  await prompt.scrollIntoViewIfNeeded();
  const touchPoint = await page.evaluate(() => {
    const tele = document.querySelector('#teleprompter');
    const stage = document.querySelector('#stage');
    const tr = tele.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const left = Math.max(tr.left, sr.left, 0) + 5;
    const right = Math.min(tr.right, sr.right, window.innerWidth) - 5;
    const top = Math.max(tr.top, sr.top, 0) + 5;
    const bottom = Math.min(tr.bottom, sr.bottom, window.innerHeight) - 5;
    for (let yi = 8; yi >= 2; yi -= 1) {
      const y = top + (bottom - top) * (yi / 10);
      for (let xi = 2; xi <= 8; xi += 1) {
        const x = left + (right - left) * (xi / 10);
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === tele || tele.contains(hit))) {
          return { x, y, top, bottom };
        }
      }
    }
    const cx = Math.max(0, Math.min(window.innerWidth - 1, (left + right) / 2));
    const cy = Math.max(0, Math.min(window.innerHeight - 1, (top + bottom) / 2));
    return {
      x: -1,
      y: -1,
      top,
      bottom,
      debug: document.elementsFromPoint(cx, cy).map((el) => `${el.tagName}#${el.id}.${String(el.className)}`).slice(0, 8)
    };
  });
  expect(touchPoint.x, JSON.stringify(touchPoint)).toBeGreaterThanOrEqual(0);
  const dragX = touchPoint.x;
  const dragStartY = Math.min(touchPoint.y, touchPoint.bottom - 8);
  const dragEndY = Math.max(touchPoint.top + 8, dragStartY - Math.max(55, (touchPoint.bottom - touchPoint.top) * 0.28));
'''

p.write_text(s[:start] + replacement + s[end:])
