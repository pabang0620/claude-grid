# promo.html을 시간 기준으로 한 프레임씩 찍는다
# 사용: python3 render.py <출력폴더> [fps] [초] [찍을 시각들(쉼표, 미리보기용)]
import sys, pathlib
from playwright.sync_api import sync_playwright

out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
fps = int(sys.argv[2]) if len(sys.argv) > 2 else 30
dur = float(sys.argv[3]) if len(sys.argv) > 3 else 14.0
only = [float(x) for x in sys.argv[4].split(',')] if len(sys.argv) > 4 else None
html = (pathlib.Path(__file__).parent / 'promo.html').resolve().as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    page.goto(html)
    page.wait_for_timeout(300)
    times = only if only else [f / fps for f in range(int(dur * fps))]
    for i, t in enumerate(times):
        page.evaluate(f'render({t})')
        page.screenshot(path=str(out / (f't{t:05.2f}.png' if only else f'f{i:04d}.png')))
    browser.close()
