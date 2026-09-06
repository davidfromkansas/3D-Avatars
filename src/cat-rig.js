import * as THREE from 'three';
import { createCatOperator } from './cat-operator.js';

const V = values => new THREE.Vector3(...values);
const smooth = (value, low, high) => THREE.MathUtils.smoothstep(value, low, high);

function mixWeights(a, b, t) {
  const result = {};
  for (const [name, value] of Object.entries(a)) result[name] = value * (1 - t);
  for (const [name, value] of Object.entries(b)) result[name] = (result[name] || 0) + value * t;
  return result;
}

function torsoWeights(p) {
  if (p.y < 1.53) return mixWeights({ Hips: 1 }, { Spine: 1 }, smooth(p.y, 1.24, 1.53));
  return mixWeights({ Spine: 1 }, { Chest: 1 }, smooth(p.y, 1.53, 1.83));
}

function legWeights(side, p) {
  const knee = smooth(p.y, 0.44, 0.90);
  const leg = mixWeights({ [`${side}LowerLeg`]: 1 }, { [`${side}UpperLeg`]: 1 }, knee);
  return mixWeights(leg, { Hips: 1 }, smooth(p.y, 0.86, 1.18));
}

function weightsFor(name, p) {
  if (/^(head$|headband|ear-|earcup|eye-|whisker|mouth|nose$|mic-)/.test(name)) return { Head: 1 };
  if (name === 'neck') return p.y < 2.02
    ? mixWeights({ Chest: 1 }, { Neck: 1 }, smooth(p.y, 1.88, 2.02))
    : mixWeights({ Neck: 1 }, { Head: 1 }, smooth(p.y, 2.02, 2.11));
  const tag = name.match(/(?:^|-)([lr])(?:-|$)/)?.[1];
  const side = tag ? (tag === 'l' ? 'Left' : 'Right') : (p.x >= 0 ? 'Left' : 'Right');
  if (/^boot/.test(name)) return mixWeights({ [`${side}Foot`]: 1 }, { [`${side}ToeBase`]: 1 }, smooth(p.z, 0.205, 0.33));
  if (/^(pant-leg|pant-hem|pant-front|pant-back|hip-pocket|cargo)/.test(name)) return legWeights(side, p);
  if (/^(belt|rear-|fly-)/.test(name)) return { Hips: 1 };
  if (name === 'pants-pelvis') {
    const t = (1 - smooth(p.y, 0.86, 1.18)) * smooth(Math.abs(p.x), 0.03, 0.21);
    return mixWeights({ Hips: 1 }, { [`${side}UpperLeg`]: 1 }, t);
  }
  if (/^(arm-|paw-|sleeve|cuff)/.test(name)) {
    if (/^cuff/.test(name)) return { [`${side}UpperArm`]: 1 };
    const fore = 1 - smooth(p.y, 1.375, 1.52), hand = 1 - smooth(p.y, 1.125, 1.255);
    let result = mixWeights({ [`${side}UpperArm`]: 1 }, { [`${side}ForeArm`]: 1 }, fore);
    result = mixWeights(result, { [`${side}Hand`]: 1 }, hand);
    if (/^sleeve/.test(name)) {
      const sign = side === 'Left' ? 1 : -1;
      const start = V([sign * 0.34, 1.82, 0]), axis = V([sign * 0.236, -0.375, 0.004]);
      const t = p.clone().sub(start).dot(axis) / axis.lengthSq();
      const proximal = 1 - smooth(t, -0.09, 0.36);
      result = mixWeights(result, { Chest: 0.72, [`${side}Shoulder`]: 0.28 }, proximal);
    }
    return result;
  }
  if (/^(id-|pen)/.test(name)) return torsoWeights(V([0, name.startsWith('id-') ? 1.49 : 1.71, 0]));
  let result = torsoWeights(p);
  if (name === 'shirt' || name.startsWith('shirt-back-yoke')) {
    const arm = smooth(Math.abs(p.x), 0.19, 0.37) * smooth(p.y, 1.51, 1.82) * 0.64;
    result = mixWeights(result, { [`${side}UpperArm`]: 0.75, [`${side}Shoulder`]: 0.25 }, arm);
  }
  return result;
}

export function resetRig(root) {
  root.traverse(o => {
    if (!o.isBone || !o.userData.restPosition) return;
    o.position.fromArray(o.userData.restPosition);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
  });
  updateRig(root);
}

export function updateRig(root, bounds = false) {
  root.updateMatrixWorld(true);
  const skeletons = new Set();
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    skeletons.add(o.skeleton);
    o.frustumCulled = false;
  });
  for (const skeleton of skeletons) skeleton.update();
  if (bounds) root.traverse(o => { if (o.isSkinnedMesh) { o.computeBoundingBox(); o.computeBoundingSphere(); } });
}

export function applyRigProbe(root, name) {
  resetRig(root);
  const set = (bone, x, y, z) => root.getObjectByName(bone).quaternion.setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
  if (name === 'shoulder-abduction') { set('LeftUpperArm', 0, 0, 1.05); set('RightUpperArm', 0, 0, -1.05); }
  if (name === 'elbow-flex') { set('LeftForeArm', -1.2, 0, 0.35); set('RightForeArm', -1.2, 0, -0.35); }
  if (name === 'hip-knee-flex') { set('LeftUpperLeg', -0.6, 0, 0); set('LeftLowerLeg', 1.1, 0, 0); set('LeftFoot', -0.5, 0, 0); }
  if (name === 'wrist-ankle') { set('LeftHand', -0.3, 0.3, 0.4); set('RightHand', 0.3, -0.3, -0.4); set('LeftFoot', -0.25, 0, 0); set('LeftToeBase', 0.2, 0, 0); }
  if (name === 'head-spine-turn') { set('Spine', 0.08, 0.22, 0); set('Chest', 0, 0, 0.08); set('Head', 0.05, 0.55, 0); }
  updateRig(root, true);
}

function createAnimations(root, bones, contract) {
  const restWorld = Object.fromEntries(contract.joints.map(j => [j.name, V(j.position)]));
  const set = (name, x = 0, y = 0, z = 0) => bones[name].quaternion.setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
  function plantLeg(side, target, pitch = 0, toe = 0) {
    const upper = bones[`${side}UpperLeg`], lower = bones[`${side}LowerLeg`], foot = bones[`${side}Foot`];
    root.updateMatrixWorld(true);
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const restUpper = restWorld[lower.name].clone().sub(restWorld[upper.name]);
    const restLower = restWorld[foot.name].clone().sub(restWorld[lower.name]);
    const a = restUpper.length(), b = restLower.length();
    const direction = target.clone().sub(hip), distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + 0.0001, a + b - 0.0001);
    direction.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a * a - along * along));
    const forward = V([0, 0, 1]).addScaledVector(direction, -direction.z).normalize();
    const knee = hip.clone().addScaledVector(direction, along).addScaledVector(forward, height);
    const ankle = hip.clone().addScaledVector(direction, distance);
    const upperWorld = new THREE.Quaternion().setFromUnitVectors(restUpper.normalize(), knee.clone().sub(hip).normalize());
    const lowerWorld = new THREE.Quaternion().setFromUnitVectors(restLower.normalize(), ankle.clone().sub(knee).normalize());
    const parentWorld = upper.parent.getWorldQuaternion(new THREE.Quaternion());
    upper.quaternion.copy(parentWorld.invert().multiply(upperWorld));
    lower.quaternion.copy(upperWorld.clone().invert().multiply(lowerWorld));
    foot.quaternion.copy(lowerWorld.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(V([1, 0, 0]), pitch)));
    bones[`${side}ToeBase`].quaternion.setFromAxisAngle(V([1, 0, 0]), toe);
  }
  function pose(name, u) {
    resetRig(root);
    const phase = u * Math.PI * 2;
    bones.Hips.position.y -= name === 'Walk' ? 0.071 + 0.014 * Math.cos(phase * 2) : 0.014 - 0.004 * Math.sin(phase);
    if (name === 'Walk') {
      set('Hips', 0, 0.025 * Math.sin(phase), 0.018 * Math.sin(phase));
      set('Spine', 0.012, -0.025 * Math.sin(phase), -0.014 * Math.sin(phase));
      set('Head', 0, 0.014 * Math.sin(phase), 0);
      for (const [side, offset] of [['Left', 0], ['Right', 0.5]]) {
        const cycle = (u + offset) % 1, stance = cycle < 0.55;
        const t = stance ? cycle / 0.55 : (cycle - 0.55) / 0.45;
        const z = stance ? 0.23 - 0.46 * t : -0.23 + 0.46 * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
        const lift = stance ? 0 : 0.125 * Math.sin(Math.PI * t) ** 2;
        const target = restWorld[`${side}Foot`].clone().add(V([0, lift, z]));
        plantLeg(side, target, stance ? 0 : -0.13 * Math.sin(Math.PI * t), stance ? 0 : -0.08 * Math.sin(Math.PI * t));
        const sign = side === 'Left' ? 1 : -1;
        set(`${side}UpperArm`, sign * 0.30 * Math.cos(phase), 0, sign * 0.035);
        set(`${side}ForeArm`, -0.12 - 0.05 * Math.cos(phase + offset * Math.PI * 2), 0, sign * 0.035);
      }
    } else {
      set('Spine', 0.006 * Math.sin(phase), 0, 0.008 * Math.sin(phase));
      set('Chest', 0.009 * Math.sin(phase), 0, 0);
      set('Head', 0, 0.018 * Math.sin(phase), 0.010 * Math.sin(phase));
      for (const side of ['Left', 'Right']) plantLeg(side, restWorld[`${side}Foot`].clone());
      if (name === 'Wave') {
        const envelope = smooth(u, 0, 0.18) * (1 - smooth(u, 0.80, 1));
        set('LeftShoulder', 0, 0, 0.12 * envelope);
        set('LeftUpperArm', -0.08 * envelope, 0, 1.10 * envelope);
        set('LeftForeArm', -0.08 * envelope, 0, 1.05 * envelope);
        set('LeftHand', 0, 0.12 * envelope, 0.28 * Math.sin(phase * 3) * envelope);
        set('Head', 0, -0.05 * envelope, -0.035 * envelope);
      }
    }
    updateRig(root);
  }
  const animations = [];
  for (const [name, info] of Object.entries(contract.animations)) {
    const frames = Math.round(info.duration * 40), times = [], rotations = Object.fromEntries(Object.keys(bones).map(name => [name, []])), positions = [];
    for (let i = 0; i <= frames; i++) {
      const u = i === frames ? 0 : i / frames;
      pose(name, u);
      times.push(i / frames * info.duration);
      for (const [boneName, bone] of Object.entries(bones)) {
        const q = bone.quaternion.clone().normalize(), values = rotations[boneName];
        if (values.length && q.dot(new THREE.Quaternion().fromArray(values, values.length - 4)) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        values.push(...q.toArray());
      }
      positions.push(...bones.Hips.position.toArray());
    }
    const tracks = Object.entries(rotations).filter(([bone]) => bone !== 'Root').map(([bone, values]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, positions));
    animations.push(new THREE.AnimationClip(name, info.duration, tracks));
  }
  resetRig(root);
  return animations;
}

export async function createRiggedCatOperator() {
  const response = await fetch(new URL('../assets/cat-operator/rig-contract.json', import.meta.url));
  if (!response.ok) throw new Error('Could not load rig contract');
  const contract = await response.json(), source = createCatOperator();
  source.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.name = 'Cat-Operator-Rigged';
  root.userData = { description: 'Skinned cat operator with idle, in-place walk and wave clips', frontAxis: '+Z', units: 'meters', rig: contract, sculptRuntime: { version: 2, skinning: true, staticPose: false, maxInfluences: 4 } };
  const bones = {}, ordered = [], prepared = [], skinIndex = [], skinWeight = [];
  for (const joint of contract.joints) {
    if (bones[joint.name] || (joint.parent && !bones[joint.parent])) throw new Error(`Invalid joint ordering: ${joint.name}`);
    const bone = new THREE.Bone();bone.name = joint.name;
    bone.position.copy(V(joint.position));
    if (joint.parent) bone.position.sub(V(contract.joints.find(j => j.name === joint.parent).position));
    bone.userData = { restPosition: bone.position.toArray(), role: joint.role || 'deform' };
    (joint.parent ? bones[joint.parent] : root).add(bone);
    bones[joint.name] = bone;ordered.push(bone);
  }
  const lookup = Object.fromEntries(ordered.map((bone, i) => [bone.name, i]));
  source.traverseVisible(o => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld), p = geometry.attributes.position, indices = [], weights = [];
    for (let i = 0; i < p.count; i++) {
      const influences = Object.entries(weightsFor(o.name, new THREE.Vector3().fromBufferAttribute(p, i))).filter(([, w]) => w > 1e-8).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = influences.reduce((sum, [, w]) => sum + w, 0), ids = [0, 0, 0, 0], ws = [0, 0, 0, 0];
      if (!Number.isFinite(total) || total <= 0) throw new Error(`Unweighted vertex: ${o.name}:${i}`);
      influences.forEach(([name, w], j) => { if (lookup[name] === undefined) throw new Error(`Unknown bone ${name}`); ids[j] = lookup[name];ws[j] = w / total; });
      indices.push(...ids);weights.push(...ws);skinIndex.push(ids);skinWeight.push(ws);
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    prepared.push({ name: o.name, geometry, material: o.material, userData: o.userData });
  });
  root.updateMatrixWorld(true);
  const payload = { schemaVersion: 1, coordinateSystem: contract.coordinateSystem, joints: contract.joints.map(j => j.position), parents: contract.joints.map(j => j.parent ? lookup[j.parent] : null), names: ordered.map(b => b.name), matrix_local: ordered.map(b => b.matrix.clone().transpose().toArray()), skinIndex, skinWeight };
  if (skinIndex.length !== skinWeight.length || skinWeight.some(ws => Math.abs(ws.reduce((a, b) => a + b, 0) - 1) > 1e-5)) throw new Error('Invalid packed skin payload');
  const skeleton = new THREE.Skeleton(ordered);
  for (const part of prepared) {
    const mesh = new THREE.SkinnedMesh(part.geometry, part.material);mesh.name = part.name;mesh.userData = { ...part.userData, rigged: true };
    mesh.frustumCulled = false;root.add(mesh);mesh.bind(skeleton, new THREE.Matrix4());
  }
  root.animations = createAnimations(root, bones, contract);
  root.rigPayload = payload;
  updateRig(root, true);
  return root;
}
