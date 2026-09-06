import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const output = path.resolve('previews/cat-operator-rigged/glb');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 600 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4173/?capture&rigged&glb');
  await page.waitForFunction(() => window.avatarReady, { timeout: 60000 });
  const clips = await page.evaluate(() => window.avatar.clips);
  for (const name of ['Walk', 'Wave']) {
    const clip = clips.find(clip => clip.name === name), fps = 20, frames = Math.round(clip.duration * fps);
    const directory = path.resolve('.img2threejs/rig-preview-frames', name.toLowerCase());
    await mkdir(directory, { recursive: true });
    for (let i = 0; i < frames; i++) {
      await page.evaluate(async ([name, time]) => {
        window.avatar.seek(name, time);
        window.avatar.closeup([0, 1.75, 0], 4.35, 30);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, [name, i / fps]);
      await page.screenshot({ path: path.join(directory, `${String(i).padStart(3, '0')}.png`) });
    }
    const filename = path.join(output, name.toLowerCase() + '.gif');
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(directory, '%03d.png'), '-filter_complex', '[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', filename], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'FFmpeg failed');
    console.log(`Created ${filename}`);
  }
} finally {
  await browser.close();
}
