import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.img2threejs', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 568, height: 1024 } });
  await page.goto('http://127.0.0.1:4173/?capture&glb');
  await page.waitForFunction(() => window.avatarReady);
  const geometry = await page.evaluate(async () => {
    const THREE = await import('three');
    const model = window.avatar.model;
    model.updateMatrixWorld(true);
    const meshes = [], parts = [];
    let unnamedMeshes = 0;
    model.traverseVisible(o => {
      if (o.name) parts.push({ name: o.name, kind: o.isMesh ? 'part' : 'assembly', triangles: o.isMesh ? (o.geometry.index?.count || o.geometry.attributes.position.count) / 3 : 0 });
      if (!o.isMesh) return;
      if (!o.name) unnamedMeshes++;
      const position = o.geometry.attributes.position, normal = o.geometry.attributes.normal;
      const matrix = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
      const vertices = [], normals = [];
      for (let i = 0; i < position.count; i++) {
        vertices.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld).toArray());
        normals.push(new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(matrix).normalize().toArray());
      }
      const indices = o.geometry.index ? Array.from(o.geometry.index.array) : Array.from({ length: position.count }, (_, i) => i);
      meshes.push({ name: o.name, vertices, normals, indices });
    });
    const before = model.children.map(o => o.position.toArray());
    document.querySelector('#explode').click();
    const movedAssemblies = model.children.filter((o, i) => o.position.distanceTo(new THREE.Vector3(...before[i])) > 0.01).length;
    document.querySelector('#explode').click();
    const restored = model.children.every((o, i) => o.position.distanceTo(new THREE.Vector3(...before[i])) < 1e-8);
    model.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 2.6, 3), new THREE.Vector3(0, 0, -1));
    const picked = ray.intersectObject(model).find(hit => hit.object.visible)?.object.name;
    return { meshes, parts, unnamedMeshes, interaction: { movedAssemblies, restored, pickedPart: picked, passed: movedAssemblies >= 4 && restored && Boolean(picked) }, stats: window.avatar.stats() };
  });
  await writeFile('.img2threejs/exported-geometry.json', JSON.stringify({ meshes: geometry.meshes }));
  await writeFile('.img2threejs/parts.json', JSON.stringify({ model: 'cat-operator', parts: geometry.parts, unnamedMeshes: geometry.unnamedMeshes }, null, 2));
  const comparisons = await page.evaluate(async () => {
    const load = async url => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
    };
    const results = [];
    for (const view of ['front', 'right', 'back', 'left', 'hero']) {
      const a = await load(`/previews/cat-operator/final/${view}.png`);
      const b = await load(`/previews/cat-operator/glb/${view}.png`);
      if (a.width !== b.width || a.height !== b.height) throw new Error('Capture dimensions differ');
      let sum = 0, count = 0, max = 0;
      for (let i = 0; i < a.data.length; i++) {
        if (i % 4 === 3) continue;
        const d = Math.abs(a.data[i] - b.data[i]);
        sum += d * d; count++; max = Math.max(max, d);
      }
      results.push({ view, width: a.width, height: a.height, rgbRMSE: Math.sqrt(sum / count), maxChannelDifference: max });
    }
    return results;
  });
  const report = { comparisons, interaction: geometry.interaction, passed: comparisons.every(r => r.rgbRMSE < 3) && geometry.interaction.passed, thresholdRGBRMSE: 3, bounds: geometry.stats.bounds, triangles: geometry.stats.triangles, meshes: geometry.stats.meshes.length, unnamedMeshes: geometry.unnamedMeshes, limitations: 'Pixel roundtrip measures export/import preservation, not reference likeness. Texture filtering can differ slightly after GLB reload.' };
  await writeFile('assets/cat-operator/roundtrip.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) throw new Error('GLB roundtrip mismatch');
} finally {
  await browser.close();
}
