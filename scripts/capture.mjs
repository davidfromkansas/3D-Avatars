import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const stage = process.env.STAGE || '4';
const smoke = process.argv.includes('--smoke');
const glb = process.argv.includes('--glb');
const exporting = process.argv.includes('--export');
const folder = glb ? 'glb' : stage === '4' ? 'final' : `stage-${stage}`;
const output = path.resolve(process.env.OUTPUT || (smoke ? '.img2threejs/smoke' : `previews/cat-operator/${folder}`));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 568, height: 1024 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  await page.goto(`http://127.0.0.1:4173/?capture&stage=${stage}${smoke ? '&smoke' : ''}${glb ? '&glb' : ''}`);
  await page.waitForFunction(() => window.avatarReady, { timeout: 60000 });
  const views = smoke ? { smoke: [0, 4] } : { front: [0, 4], right: [90, 4], back: [180, 4], left: [270, 4], hero: [32, 8] };
  for (const [name, [angle, elevation]] of Object.entries(views)) {
    await page.evaluate(([a, e]) => window.avatar.setView(a, e), [angle, elevation]);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  if (!smoke) {
    await page.setViewportSize({ width: 1024, height: 1024 });
    for (const [name, target, height] of [['head-detail', [0, 2.76, 0], 1.94], ['uniform-detail', [0, 1.22, 0], 2.05]]) {
      await page.evaluate(([t, h]) => window.avatar.closeup(t, h), [target, height]);
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(output, `${name}.png`) });
    }
  }
  const stats = await page.evaluate(() => window.avatar.stats());
  await writeFile(path.join(output, 'stats.json'), JSON.stringify({ ...stats, errors }, null, 2) + '\n');
  if (exporting) {
    const data = await page.evaluate(() => window.avatar.exportGLB());
    const filename = path.resolve('assets/cat-operator/cat-operator.glb');
    await writeFile(filename, Buffer.from(data, 'base64'));
    console.log(`Exported ${filename}`);
  }
  console.log(JSON.stringify({ output, triangles: stats.triangles, meshes: stats.meshes.length, materials: stats.materialCount, errors }));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
