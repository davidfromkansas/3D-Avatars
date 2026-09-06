import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRiggedCatOperator, resetRig, updateRig, applyRigProbe } from './cat-rig.js';

const params = new URLSearchParams(location.search);
const rigged = params.has('rigged') || (!params.has('capture') && !params.has('static') && !params.has('glb'));
const assetName = rigged ? 'cat-operator-rigged' : 'cat-operator';
if (params.has('capture')) document.body.classList.add('capture');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#ffffff');
const pmrem = new THREE.PMREMGenerator(renderer);
const environment = new RoomEnvironment();
scene.environment = pmrem.fromScene(environment, 0.04).texture;
scene.environmentIntensity = 0.5;
environment.dispose();
const camera = new THREE.OrthographicCamera(-2, 2, 2.5, -2.5, 0.1, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.75, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 15;
const key = new THREE.DirectionalLight('#fff6eb', 1.8);
key.position.set(-3, 6, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 5, bottom: -2, near: 0.1, far: 20 });
key.shadow.bias = -0.0001;
key.shadow.normalBias = 0.025;
scene.add(key);
const fill = new THREE.DirectionalLight('#e9efff', 1.3);
fill.position.set(4, 3.5, 4);
scene.add(fill);
const rim = new THREE.DirectionalLight('#ffffff', 2);
rim.position.set(1, 5, -4);
scene.add(rim);
scene.add(new THREE.HemisphereLight('#ffffff', '#dcd7d1', 0.5));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#615344', opacity: 0.10 }));
floor.name = 'Studio floor (not exported)';
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.005;
floor.receiveShadow = true;
floor.visible = !params.has('capture');
scene.add(floor);
let model;
if (params.has('glb')) {
  const loaded = await new GLTFLoader().loadAsync(`/assets/cat-operator/${assetName}.glb`);
  model = loaded.scene.getObjectByName(rigged ? 'Cat-Operator-Rigged' : 'Cat-Operator') || loaded.scene;
  model.animations = loaded.animations;
} else if (rigged) {
  model = await createRiggedCatOperator();
} else {
  try {
    const { createCatOperator } = await import('./cat-operator.js');
    model = createCatOperator({ stage: Number(params.get('stage') || 4) });
  } catch (error) {
    if (!params.has('smoke')) throw error;
    model = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 24), new THREE.MeshStandardMaterial({ color: '#f69839' }));
    model.position.y = 1.75;
  }
}
scene.add(model);
model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; if (o.isSkinnedMesh) o.frustumCulled = false; } });
const mixer = rigged ? new THREE.AnimationMixer(model) : null;
const clips = model.animations || [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const skeletonHelper = rigged ? new THREE.SkeletonHelper(model) : null;
if (skeletonHelper) { skeletonHelper.visible = false; skeletonHelper.material.depthTest = false; scene.add(skeletonHelper); }
let activeAction = null, playing = false;
function playAnimation(name, time = 0, autoplay = true) {
  if (!mixer) return;
  mixer.stopAllAction();
  resetRig(model);
  activeAction = null;
  const clip = clips.find(clip => clip.name === name);
  if (clip) { activeAction = mixer.clipAction(clip).reset().play(); mixer.setTime(time); }
  playing = Boolean(clip) && autoplay;
  document.querySelector('#animation').value = clip?.name || '';
  document.querySelector('#play').textContent = playing ? 'Pause' : 'Play';
  updateRig(model, true);
}
for (const id of ['animation', 'play', 'skeleton']) document.querySelector(`#${id}`).hidden = !rigged;
document.querySelector('#explode').hidden = rigged;
document.querySelector('#download').href = `/assets/cat-operator/${assetName}.glb`;
document.querySelector('#variant').href = rigged ? '/?static' : '/?rigged';
document.querySelector('#variant').textContent = rigged ? 'Static version' : 'Rigged version';
document.querySelector('#animation').onchange = event => playAnimation(event.target.value);
document.querySelector('#play').onclick = () => {
  if (!activeAction) return playAnimation('Idle');
  playing = !playing;
  document.querySelector('#play').textContent = playing ? 'Pause' : 'Play';
};
document.querySelector('#skeleton').onclick = event => {
  skeletonHelper.visible = !skeletonHelper.visible;
  event.target.setAttribute('aria-pressed', String(skeletonHelper.visible));
  event.target.textContent = skeletonHelper.visible ? 'Hide skeleton' : 'Show skeleton';
};
reducedMotion.addEventListener('change', event => { if (event.matches) { playing = false; document.querySelector('#play').textContent = 'Play'; } });
if (rigged && !params.has('capture') && !reducedMotion.matches) playAnimation('Idle');
function setView(azimuth = 0, elevation = 4) {
  const angle = THREE.MathUtils.degToRad(azimuth);
  const rise = THREE.MathUtils.degToRad(elevation);
  camera.position.set(Math.sin(angle) * 8 * Math.cos(rise), 1.75 + 8 * Math.sin(rise), Math.cos(angle) * 8 * Math.cos(rise));
  controls.target.set(0, 1.75, 0);
  camera.lookAt(controls.target);
  controls.update();
  renderer.render(scene, camera);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  const h = params.has('capture') ? 3.762 : 4.15;
  const w = h * innerWidth / innerHeight;
  Object.assign(camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
  camera.updateProjectionMatrix();
}
resize();
setView(Number(params.get('angle') || 0));
window.addEventListener('resize', resize);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05);
  if (playing) { mixer.update(delta); updateRig(model); }
  controls.update();
  renderer.render(scene, camera);
});
const initialPositions = new Map(model.children.map(o => [o, o.position.clone()]));
let exploded = false;
document.querySelector('#front').onclick = () => setView(0);
document.querySelector('#back').onclick = () => setView(180);
document.querySelector('#explode').onclick = () => {
  exploded = !exploded;
  for (const [o, original] of initialPositions) {
    o.position.copy(original);
    if (exploded) {
      const center = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      o.position.add(center.sub(new THREE.Vector3(0, 1.75, 0)).multiplyScalar(0.8));
    }
  }
};
const raycaster = new THREE.Raycaster();
renderer.domElement.addEventListener('pointerdown', event => {
  if (rigged) updateRig(model, true);
  raycaster.setFromCamera(new THREE.Vector2(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2), camera);
  const hit = raycaster.intersectObject(model)[0];
  if (hit && !params.has('capture')) document.querySelector('header p').textContent = hit.object.name;
});
window.avatar = {
  setView,
  model,
  clips: clips.map(clip => ({ name: clip.name, duration: clip.duration })),
  seek(name, time) { playAnimation(name, time, false); },
  probe(name) { if (!rigged) return; mixer.stopAllAction(); playing = false; applyRigProbe(model, name); },
  rigPayload() { return model.rigPayload || null; },
  showSkeleton(show) { if (skeletonHelper) skeletonHelper.visible = show; },
  closeup(target, height, azimuth = 25) {
    const a = THREE.MathUtils.degToRad(azimuth);
    controls.target.fromArray(target);
    camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(a) * 8, 0.7, Math.cos(a) * 8));
    camera.left = -height * innerWidth / innerHeight / 2;
    camera.right = -camera.left;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
  },
  stats() {
    if (rigged) updateRig(model, true);
    let triangles = 0;
    const meshes = [];
    const materials = new Set();
    model.traverseVisible(o => {
      if (!o.isMesh) return;
      const count = (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
      triangles += count;
      meshes.push({ name: o.name, triangles: count });
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m.uuid);
    });
    return { triangles, meshes, materialCount: materials.size, bounds: new THREE.Box3().setFromObject(model) };
  },
  async exportGLB() {
    const previous = { name: activeAction?.getClip().name || '', time: activeAction?.time || 0, playing };
    if (rigged) playAnimation('', 0, false);
    let exportRoot = model;
    const children = rigged ? [...model.children] : [];
    if (rigged) {
      exportRoot = new THREE.Scene();
      exportRoot.name = model.name;
      exportRoot.userData = model.userData;
      for (const child of children) exportRoot.attach(child);
      exportRoot.updateMatrixWorld(true);
    }
    let result;
    try {
      result = await new GLTFExporter().parseAsync(exportRoot, { binary: true, onlyVisible: true, trs: rigged, animations: clips, maxTextureSize: 2048 });
    } finally {
      if (rigged) { for (const child of children) model.attach(child); playAnimation(previous.name, previous.time, previous.playing); }
    }
    let data = '';
    const bytes = new Uint8Array(result);
    for (let start = 0; start < bytes.length; start += 32768) data += String.fromCharCode(...bytes.subarray(start, start + 32768));
    return btoa(data);
  }
};
window.avatarReady = true;
