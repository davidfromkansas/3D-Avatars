import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const stage = process.env.STAGE || '4';
const smoke = process.argv.includes('--smoke');
const glb = process.argv.includes('--glb');
const exporting = process.argv.includes('--export');
const exportOnly = process.argv.includes('--export-only');
const rigged = process.argv.includes('--rigged');
const assetName = rigged ? 'cat-operator-rigged' : 'cat-operator';
const folder = glb ? 'glb' : stage === '4' ? 'final' : `stage-${stage}`;
const output = path.resolve(process.env.OUTPUT || (smoke ? '.img2threejs/smoke' : `previews/${assetName}/${folder}`));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 568, height: 1024 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  await page.goto(`http://127.0.0.1:4173/?capture&stage=${stage}${smoke ? '&smoke' : ''}${glb ? '&glb' : ''}${rigged ? '&rigged' : ''}`);
  await page.waitForFunction(() => window.avatarReady, { timeout: 60000 });
  const views = exportOnly ? {} : smoke ? { smoke: [0, 4] } : { front: [0, 4], right: [90, 4], back: [180, 4], left: [270, 4], hero: [32, 8] };
  for (const [name, [angle, elevation]] of Object.entries(views)) {
    await page.evaluate(([a, e]) => window.avatar.setView(a, e), [angle, elevation]);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  if (!smoke && !exportOnly) {
    await page.setViewportSize({ width: 1024, height: 1024 });
    for (const [name, target, height] of [['head-detail', [0, 2.76, 0], 1.94], ['uniform-detail', [0, 1.22, 0], 2.05]]) {
      await page.evaluate(([t, h]) => window.avatar.closeup(t, h), [target, height]);
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(output, `${name}.png`) });
    }
  }
  const stats = await page.evaluate(() => window.avatar.stats());
  await writeFile(path.join(output, 'stats.json'), JSON.stringify({ ...stats, errors }, null, 2) + '\n');
  if (rigged && !exportOnly) {
    const payload = await page.evaluate(() => window.avatar.rigPayload());
    if (payload) { await mkdir('.img2threejs', { recursive: true }); await writeFile('.img2threejs/rig-payload.json', JSON.stringify(payload)); }
    await page.setViewportSize({ width: 720, height: 900 });
    const clips = await page.evaluate(() => window.avatar.clips);
    for (const clip of clips) {
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        await page.evaluate(([name, time]) => { window.avatar.seek(name, time); window.avatar.closeup([0, 1.75, 0], 4.35, 30); }, [clip.name, clip.duration * phase]);
        await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(output, `${clip.name.toLowerCase()}-${phase}.png`) });
      }
    }
    for (const probe of ['shoulder-abduction', 'elbow-flex', 'hip-knee-flex', 'wrist-ankle', 'head-spine-turn']) {
      for (const angle of [0, 90]) {
        await page.evaluate(([name, a]) => { window.avatar.probe(name); window.avatar.closeup([0, 1.75, 0], 4.35, a); }, [probe, angle]);
        await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(output, `${probe}-${angle}.png`) });
      }
    }
    await page.evaluate(() => { window.avatar.seek('', 0); window.avatar.closeup([0, 1.75, 0], 4.1, 25); window.avatar.showSkeleton(true); });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(output, 'skeleton.png') });
    await page.evaluate(() => window.avatar.showSkeleton(false));
  }
  if (exporting) {
    const data = await page.evaluate(() => window.avatar.exportGLB());
    const filename = path.resolve(`assets/cat-operator/${assetName}.glb`);
    await writeFile(filename, Buffer.from(data, 'base64'));
    console.log(`Exported ${filename}`);
  }
  console.log(JSON.stringify({ output, triangles: stats.triangles, meshes: stats.meshes.length, materials: stats.materialCount, errors }));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
