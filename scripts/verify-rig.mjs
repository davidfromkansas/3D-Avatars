import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const inspect = async (glb) => {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4173/?capture&rigged${glb ? '&glb' : ''}`);
    await page.waitForFunction(() => window.avatarReady, { timeout: 60000 });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const model = window.avatar.model, meshes = [], bones = [];
      model.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); if (o.isBone) bones.push(o); });
      meshes.sort((a, b) => a.name.localeCompare(b.name));
      const position = (mesh, index) => mesh.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index)).applyMatrix4(mesh.matrixWorld);
      const samples = meshes.map(mesh => {
        const vertices = [], edges = [], p = mesh.geometry.attributes.position, indices = mesh.geometry.index;
        const stride = Math.max(1, Math.ceil(p.count / 32));
        for (let i = 0; i < p.count; i += stride) vertices.push(i);
        const count = indices?.count || p.count, step = Math.max(3, Math.floor(count / 36 / 3) * 3);
        for (let i = 0; i + 2 < count; i += step) {
          const a = indices ? indices.getX(i) : i, b = indices ? indices.getX(i + 1) : i + 1;
          const distance = new THREE.Vector3().fromBufferAttribute(p, a).distanceTo(new THREE.Vector3().fromBufferAttribute(p, b));
          if (distance > 0.003) edges.push([a, b, distance]);
        }
        return { mesh, vertices, edges };
      });
      const frames = [], footContacts = [], joints = [];
      let maxStretch = 1, minStretch = 1, finite = true, worstCompression = null, worstStretch = null;
      const snapshot = (name, clip = null, phase = 0) => {
        model.updateMatrixWorld(true);
        const points = [];
        for (const { mesh, vertices, edges } of samples) {
          for (const index of vertices) points.push(...position(mesh, index).toArray());
          for (const [a, b, distance] of edges) {
            const ratio = position(mesh, a).distanceTo(position(mesh, b)) / distance;
            const detail = () => ({ pose: name, mesh: mesh.name, vertices: [a, b], ratio, restLength: distance, restPoints: [a, b].map(i => new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i).toArray()) });
            if (ratio > maxStretch) worstStretch = detail();
            if (ratio < minStretch) worstCompression = detail();
            maxStretch = Math.max(maxStretch, ratio); minStretch = Math.min(minStretch, ratio);
          }
        }
        finite &&= points.every(Number.isFinite);
        const bounds = new THREE.Box3().setFromObject(model);
        finite &&= [...bounds.min, ...bounds.max].every(Number.isFinite);
        frames.push({ name, points, bounds: [bounds.min.toArray(), bounds.max.toArray()] });
        const tracked = {};
        for (const boneName of ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Head']) tracked[boneName] = model.getObjectByName(boneName).getWorldPosition(new THREE.Vector3()).toArray();
        joints.push({ name, positions: tracked });
        if (!clip) return;
        for (const [side, offset] of [['l', 0], ['r', 0.5]]) {
          const stance = clip !== 'Walk' || (phase + offset) % 1 < 0.55;
          if (!stance) continue;
          const sole = model.getObjectByName(`boot-sole-${side}`);
          let minY = Infinity;
          for (let i = 0; i < sole.geometry.attributes.position.count; i++) minY = Math.min(minY, position(sole, i).y);
          footContacts.push({ name, side, minY });
        }
      };
      window.avatar.seek('', 0); snapshot('bind');
      for (const clip of window.avatar.clips) {
        for (const phase of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
          window.avatar.seek(clip.name, phase * clip.duration);
          snapshot(`${clip.name}:${phase}`, clip.name, phase);
        }
      }
      for (const probe of ['shoulder-abduction', 'elbow-flex', 'hip-knee-flex', 'wrist-ankle', 'head-spine-turn']) {
        window.avatar.probe(probe); snapshot(probe);
      }
      window.avatar.seek('', 0);
      return { frames, joints, footContacts, maxStretch, minStretch, worstCompression, worstStretch, finite, boneNames: bones.map(b => b.name), meshCount: meshes.length, samplesPerFrame: frames[0].points.length / 3, uniqueBoneObjectsInSkins: new Set(meshes.flatMap(m => m.skeleton.bones)).size, skeletonInstances: new Set(meshes.map(m => m.skeleton)).size };
    });
    await page.close();
    assert.deepEqual(errors, [], `${glb ? 'GLB' : 'Source'} browser errors`);
    return result;
  };
  const source = await inspect(false), loaded = await inspect(true);
  console.log(JSON.stringify({ source: { worstCompression: source.worstCompression, worstStretch: source.worstStretch }, glb: { worstCompression: loaded.worstCompression, worstStretch: loaded.worstStretch } }, null, 2));
  assert.equal(source.meshCount, 121);
  assert.equal(loaded.meshCount, source.meshCount);
  assert.equal(source.boneNames.length, 22);
  assert.equal(loaded.uniqueBoneObjectsInSkins, 22, 'GLB skins must reference one common joint hierarchy');
  assert.equal(source.skeletonInstances, 1, 'Authoring runtime must share one Skeleton');
  for (const [label, runtime] of [['source', source], ['glb', loaded]]) {
    assert.ok(runtime.finite, `${label}: non-finite deformation`);
    assert.ok(runtime.maxStretch < 4, `${label}: excessive sampled stretch ${runtime.maxStretch}`);
    assert.ok(runtime.minStretch > 0.12, `${label}: collapsed sampled edge ${runtime.minStretch}`);
    assert.ok(runtime.footContacts.every(contact => Math.abs(contact.minY) < 0.015), `${label}: planted foot leaves floor: ${JSON.stringify(runtime.footContacts.filter(c => Math.abs(c.minY) >= 0.015))}`);
    for (const clip of ['Idle', 'Walk', 'Wave']) {
      const a = runtime.frames.find(f => f.name === `${clip}:0`).points, b = runtime.frames.find(f => f.name === `${clip}:1`).points;
      assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-5), `${label}: ${clip} loop seam`);
    }
  }
  const range = (runtime, clip, bone, axis) => {
    const values = runtime.joints.filter(frame => frame.name.startsWith(clip + ':')).map(frame => frame.positions[bone][axis]);
    return Math.max(...values) - Math.min(...values);
  };
  assert.ok(range(loaded, 'Walk', 'LeftFoot', 2) > 0.35, 'Walk must actually stride');
  assert.ok(range(loaded, 'Wave', 'LeftHand', 1) > 0.6, 'Wave must actually raise a hand');
  let maxExportPositionError = 0;
  for (let frame = 0; frame < source.frames.length; frame++) {
    const a = source.frames[frame], b = loaded.frames[frame];
    assert.equal(a.name, b.name);assert.equal(a.points.length, b.points.length);
    for (let i = 0; i < a.points.length; i++) maxExportPositionError = Math.max(maxExportPositionError, Math.abs(a.points[i] - b.points[i]));
  }
  assert.ok(maxExportPositionError < 0.0001, `Animated export drift: ${maxExportPositionError}`);
  const comparisonPage = await browser.newPage();
  await comparisonPage.goto('http://127.0.0.1:4173/?capture&glb');
  const bindAppearance = await comparisonPage.evaluate(async () => {
    async function pixels(url) {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas');canvas.width = image.width;canvas.height = image.height;
      const context = canvas.getContext('2d');context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    const result = [];
    for (const view of ['front', 'right', 'back', 'left', 'hero']) {
      const a = await pixels(`/previews/cat-operator/glb/${view}.png`), b = await pixels(`/previews/cat-operator-rigged/glb/${view}.png`);
      if (a.length !== b.length) throw new Error('Bind capture dimensions differ');
      let total = 0, count = 0;
      for (let i = 0; i < a.length; i++) if (i % 4 !== 3) { total += (a[i] - b[i]) ** 2; count++; }
      result.push({ view, rgbRMSE: Math.sqrt(total / count) });
    }
    return result;
  });
  await comparisonPage.close();
  assert.ok(bindAppearance.every(view => view.rgbRMSE < 3), `Bind appearance changed: ${JSON.stringify(bindAppearance)}`);
  const report = {
    passed: true,
    bindAppearance,
    sampledPoses: source.frames.length,
    sampledVerticesPerPose: source.samplesPerFrame,
    maxExportPositionError,
    maxSampledEdgeStretch: loaded.maxStretch,
    minSampledEdgeStretch: loaded.minStretch,
    maxPlantedSoleHeightError: Math.max(...loaded.footContacts.map(c => Math.abs(c.minY))),
    loopContinuity: ['Idle', 'Walk', 'Wave'],
    walkFootTravel: range(loaded, 'Walk', 'LeftFoot', 2),
    waveHandLift: range(loaded, 'Wave', 'LeftHand', 1),
    bones: loaded.boneNames.length,
    meshes: loaded.meshCount,
    sharedBoneHierarchy: true,
    limitations: 'Sampled deformation and foot-contact checks, not an exhaustive collision test. Walk is in-place: translate the avatar externally at approximately 0.70 units per second. Root is a global control with no direct vertex weights.'
  };
  await writeFile('assets/cat-operator/rig-motion-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
