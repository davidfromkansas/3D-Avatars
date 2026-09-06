import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { validateBytes } from 'gltf-validator';

const directory = new URL('../assets/cat-operator/', import.meta.url);
const expectedHash = 'c797ac3a857d31576c6665d778dcee9fcf401b73';
const tolerance = 1e-4;
const boneNames = [
  'Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToeBase',
];
const componentTypes = new Map([
  [5120, { bytes: 1, read: 'readInt8', divisor: 127, signed: true }],
  [5121, { bytes: 1, read: 'readUInt8', divisor: 255 }],
  [5122, { bytes: 2, read: 'readInt16LE', divisor: 32767, signed: true }],
  [5123, { bytes: 2, read: 'readUInt16LE', divisor: 65535 }],
  [5125, { bytes: 4, read: 'readUInt32LE', divisor: 4294967295 }],
  [5126, { bytes: 4, read: 'readFloatLE' }],
]);
const shapes = { SCALAR: [1, 1], VEC2: [1, 2], VEC3: [1, 3], VEC4: [1, 4], MAT2: [2, 2], MAT3: [3, 3], MAT4: [4, 4] };

function integer(value, label, minimum = 0) {
  assert.ok(Number.isSafeInteger(value) && value >= minimum, `${label}: invalid integer ${value}`);
  return value;
}

function item(array, index, label) {
  integer(index, `${label} index`);
  assert.ok(Array.isArray(array) && index < array.length, `${label}: index ${index} out of range`);
  return array[index];
}

function parseGlb(bytes, label) {
  assert.ok(bytes.length >= 20, `${label}: truncated GLB`);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${label}: GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${label}: glTF 2.0`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${label}: GLB byte length`);
  const chunks = [];
  let offset = 12;
  while (offset < bytes.length) {
    assert.ok(offset + 8 <= bytes.length, `${label}: truncated chunk header`);
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    assert.equal(length % 4, 0, `${label}: chunk alignment`);
    assert.ok(offset + 8 + length <= bytes.length, `${label}: truncated chunk`);
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  assert.equal(chunks[0]?.type, 0x4e4f534a, `${label}: JSON must be first chunk`);
  assert.equal(chunks.length, 2, `${label}: expected JSON and embedded BIN chunks only`);
  assert.equal(chunks[1].type, 0x004e4942, `${label}: embedded BIN chunk required`);
  const gltf = JSON.parse(chunks[0].data.toString('utf8'));
  const binary = chunks[1].data;
  assert.equal(gltf.buffers?.length, 1, `${label}: one embedded buffer required`);
  assert.ok(gltf.buffers.every(buffer => buffer.uri === undefined), `${label}: buffers must be embedded`);
  const byteLength = integer(gltf.buffers[0].byteLength, `${label}: buffer byteLength`, 1);
  assert.ok(byteLength <= binary.length && binary.length - byteLength <= 3, `${label}: BIN byte length`);
  return { gltf, binary: binary.subarray(0, byteLength) };
}

function accessorReader(gltf, binary) {
  const cache = new Map();
  return index => {
    if (cache.has(index)) return cache.get(index);
    const accessor = item(gltf.accessors, index, 'Accessor');
    const label = `Accessor ${index}`;
    assert.equal(accessor.sparse, undefined, `${label}: sparse accessors are unsupported`);
    const count = integer(accessor.count, `${label} count`, 1);
    const component = componentTypes.get(accessor.componentType);
    const shape = shapes[accessor.type];
    assert.ok(component && shape, `${label}: unsupported component or accessor type`);
    assert.ok(accessor.normalized === undefined || typeof accessor.normalized === 'boolean', `${label}: normalized must be boolean`);
    if (accessor.normalized) {
      assert.ok([5120, 5121, 5122, 5123].includes(accessor.componentType), `${label}: invalid normalized component type`);
    }
    const [columns, rows] = shape;
    const columnBytes = columns > 1 ? Math.ceil(rows * component.bytes / 4) * 4 : rows * component.bytes;
    const elementBytes = columns * columnBytes;
    const view = item(gltf.bufferViews, accessor.bufferView, `${label} bufferView`);
    assert.equal(view.buffer, 0, `${label}: buffer must be embedded`);
    const viewOffset = integer(view.byteOffset ?? 0, `${label} bufferView offset`);
    const viewLength = integer(view.byteLength, `${label} bufferView length`, 1);
    const accessorOffset = integer(accessor.byteOffset ?? 0, `${label} offset`);
    const stride = integer(view.byteStride ?? elementBytes, `${label} stride`, elementBytes);
    assert.equal(stride % component.bytes, 0, `${label}: component stride alignment`);
    assert.equal((viewOffset + accessorOffset) % component.bytes, 0, `${label}: component offset alignment`);
    if (columns > 1) {
      assert.equal((viewOffset + accessorOffset) % 4, 0, `${label}: matrix alignment`);
      assert.equal(stride % 4, 0, `${label}: matrix stride alignment`);
    }
    assert.ok(viewOffset + viewLength <= binary.length, `${label}: bufferView exceeds BIN`);
    assert.ok(accessorOffset + (count - 1) * stride + elementBytes <= viewLength, `${label}: accessor exceeds bufferView`);
    const values = new Float64Array(count * columns * rows);
    for (let vertex = 0; vertex < count; vertex++) {
      for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
          const offset = viewOffset + accessorOffset + vertex * stride + column * columnBytes + row * component.bytes;
          let value = binary[component.read](offset);
          if (accessor.normalized) value = component.signed ? Math.max(value / component.divisor, -1) : value / component.divisor;
          assert.ok(Number.isFinite(value), `${label}: non-finite value at element ${vertex}`);
          values[vertex * columns * rows + column * rows + row] = value;
        }
      }
    }
    const result = { ...accessor, components: columns * rows, values };
    cache.set(index, result);
    return result;
  };
}

async function main() {
  let bytes;
  try {
    bytes = await readFile(new URL('cat-operator-rigged.glb', directory));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Missing assets/cat-operator/cat-operator-rigged.glb; export the rigged asset before validating.');
    throw error;
  }
  assert.ok(bytes.length < 30 * 1024 * 1024, 'Rigged GLB must remain below 30 MB');
  const { gltf, binary } = parseGlb(bytes, 'Rigged asset');
  const originalBytes = await readFile(new URL('cat-operator.glb', directory));
  const originalHash = createHash('sha1').update(`blob ${originalBytes.length}\0`).update(originalBytes).digest('hex');
  assert.equal(originalHash, expectedHash, 'Original static GLB git blob hash changed');
  const { gltf: original } = parseGlb(originalBytes, 'Original asset');
  assert.equal(original.skins?.length ?? 0, 0, 'Original asset must remain unrigged');
  assert.equal(original.animations?.length ?? 0, 0, 'Original asset must remain unanimated');
  assert.ok(original.nodes.every(node => node.skin === undefined), 'Original nodes must remain unskinned');
  assert.ok(original.meshes.every(mesh => mesh.primitives.every(primitive =>
    Object.keys(primitive.attributes).every(name => !/^(JOINTS|WEIGHTS)_/.test(name)))), 'Original geometry must remain unskinned');
  assert.equal(gltf.cameras?.length ?? 0, 0, 'No cameras allowed');
  assert.ok(!gltf.nodes.some(node => node.camera !== undefined), 'No camera nodes allowed');
  assert.ok(!gltf.extensionsUsed?.includes('KHR_lights_punctual') && !gltf.extensionsRequired?.includes('KHR_lights_punctual'), 'No lights allowed');
  assert.ok(!gltf.extensions?.KHR_lights_punctual && !gltf.nodes.some(node => node.extensions?.KHR_lights_punctual), 'No light definitions or nodes allowed');
  for (const image of gltf.images ?? []) {
    assert.equal(image.uri, undefined, 'Images must be embedded bufferViews');
    item(gltf.bufferViews, image.bufferView, 'Image bufferView');
  }
  for (const accessor of gltf.accessors ?? []) assert.equal(accessor.sparse, undefined, 'Sparse accessors are unsupported');
  const report = await validateBytes(new Uint8Array(bytes), { uri: 'cat-operator-rigged.glb', maxIssues: 10000 });
  const problems = JSON.stringify(report.issues.messages.filter(issue => issue.severity < 2));
  assert.equal(report.issues.numErrors, 0, `Khronos errors: ${problems}`);
  assert.equal(report.issues.numWarnings, 0, `Khronos warnings: ${problems}`);
  const readAccessor = accessorReader(gltf, binary);
  assert.ok(gltf.skins?.length >= 1, 'At least one skin required');
  const bones = boneNames.map(name => {
    const matches = gltf.nodes.flatMap((node, index) => node.name === name ? [index] : []);
    assert.equal(matches.length, 1, `Expected exactly one bone named ${name}`);
    return { name, node: matches[0] };
  });
  const boneNodes = new Set(bones.map(bone => bone.node));
  for (const [index, skin] of gltf.skins.entries()) {
    assert.equal(skin.joints?.length, boneNames.length, `Skin ${index}: expected all 22 bones`);
    assert.equal(new Set(skin.joints).size, boneNames.length, `Skin ${index}: duplicate joints`);
    assert.ok(skin.joints.every(joint => boneNodes.has(joint)), `Skin ${index}: joint node set must match the common bones`);
    if (skin.skeleton !== undefined) item(gltf.nodes, skin.skeleton, `Skin ${index} skeleton`);
    const matrices = readAccessor(skin.inverseBindMatrices);
    assert.equal(matrices.type, 'MAT4', `Skin ${index}: inverse bind matrices must be MAT4`);
    assert.equal(matrices.componentType, 5126, `Skin ${index}: inverse bind matrices must be floats`);
    assert.equal(matrices.count, skin.joints.length, `Skin ${index}: inverse bind matrix count`);
  }
  const meshNodes = gltf.nodes.filter(node => node.mesh !== undefined);
  const originalMeshNodes = original.nodes.filter(node => node.mesh !== undefined);
  assert.equal(gltf.meshes?.length, original.meshes.length, 'All original meshes must be retained');
  assert.equal(meshNodes.length, originalMeshNodes.length, 'All original mesh nodes must be retained');
  assert.ok(meshNodes.length > 0, 'Skinned meshes required');
  const referencedMeshes = new Set();
  let triangles = 0;
  let weightedVertexCount = 0;
  let maxWeightError = 0;
  for (const node of meshNodes) {
    const mesh = item(gltf.meshes, node.mesh, `Node ${node.name} mesh`);
    const skin = item(gltf.skins, node.skin, `Node ${node.name} skin`);
    referencedMeshes.add(node.mesh);
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      const label = `${node.name}, primitive ${primitiveIndex}`;
      assert.equal(primitive.mode ?? 4, 4, `${label}: triangle mesh required`);
      const position = readAccessor(primitive.attributes.POSITION);
      assert.equal(position.type, 'VEC3', `${label}: POSITION must be VEC3`);
      const joints = readAccessor(primitive.attributes.JOINTS_0);
      const weights = readAccessor(primitive.attributes.WEIGHTS_0);
      assert.equal(joints.type, 'VEC4', `${label}: JOINTS_0 must be VEC4`);
      assert.equal(weights.type, 'VEC4', `${label}: WEIGHTS_0 must be VEC4`);
      assert.ok([5121, 5123].includes(joints.componentType) && !joints.normalized, `${label}: joints must be unsigned, unnormalized integers`);
      assert.ok(weights.componentType === 5126 || ([5121, 5123].includes(weights.componentType) && weights.normalized), `${label}: weights must be floats or normalized unsigned integers`);
      assert.equal(joints.count, position.count, `${label}: joint count must match positions`);
      assert.equal(weights.count, position.count, `${label}: weight count must match positions`);
      assert.ok(Object.keys(primitive.attributes).every(name => !/^(JOINTS|WEIGHTS)_/.test(name) || name === 'JOINTS_0' || name === 'WEIGHTS_0'), `${label}: maximum four influences per vertex`);
      for (let vertex = 0; vertex < position.count; vertex++) {
        let sum = 0;
        for (let influence = 0; influence < 4; influence++) {
          const index = vertex * 4 + influence;
          const joint = joints.values[index];
          const weight = weights.values[index];
          assert.ok(Number.isInteger(joint) && joint >= 0 && joint < skin.joints.length, `${label}: vertex ${vertex} joint outside skin range`);
          assert.ok(weight >= 0 && weight <= 1, `${label}: vertex ${vertex} weight outside [0, 1]`);
          sum += weight;
        }
        const error = Math.abs(sum - 1);
        maxWeightError = Math.max(maxWeightError, error);
        assert.ok(error <= tolerance, `${label}: vertex ${vertex} weights sum to ${sum}`);
      }
      weightedVertexCount += position.count;
      let indexCount = position.count;
      if (primitive.indices !== undefined) {
        const indices = readAccessor(primitive.indices);
        assert.ok(indices.type === 'SCALAR' && [5121, 5123, 5125].includes(indices.componentType) && !indices.normalized, `${label}: invalid triangle indices`);
        assert.ok(indices.values.every(index => Number.isInteger(index) && index >= 0 && index < position.count), `${label}: triangle index outside position range`);
        indexCount = indices.count;
      }
      assert.equal(indexCount % 3, 0, `${label}: incomplete triangle`);
      triangles += indexCount / 3;
    }
  }
  assert.equal(referencedMeshes.size, gltf.meshes.length, 'Every mesh must have a skinned node');
  assert.ok(triangles < 300000, `Triangle budget exceeded: ${triangles}`);
  assert.deepEqual((gltf.animations ?? []).map(animation => animation.name).sort(), ['Idle', 'Walk', 'Wave'], 'Exactly Idle, Walk and Wave clips required');
  const animations = gltf.animations.map(animation => {
    assert.ok(animation.channels?.length > 0 && animation.samplers?.length > 0, `${animation.name}: animation must contain channels and samplers`);
    const samplers = animation.samplers.map((sampler, index) => {
      const label = `${animation.name} sampler ${index}`;
      const input = readAccessor(sampler.input);
      const output = readAccessor(sampler.output);
      assert.ok(input.type === 'SCALAR' && input.componentType === 5126, `${label}: input must be scalar float times`);
      assert.equal(input.values[0], 0, `${label}: times must start at zero`);
      for (let key = 1; key < input.count; key++) assert.ok(input.values[key] > input.values[key - 1], `${label}: times must strictly increase`);
      assert.equal(output.componentType, 5126, `${label}: output must be floats`);
      const interpolation = sampler.interpolation ?? 'LINEAR';
      assert.ok(['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation), `${label}: unsupported interpolation`);
      const multiplier = interpolation === 'CUBICSPLINE' ? 3 : 1;
      assert.equal(output.count, input.count * multiplier, `${label}: output count must match input keys`);
      return { input, output, interpolation, multiplier, duration: input.values[input.count - 1] };
    });
    const targets = new Set();
    const usedSamplers = new Set();
    for (const channel of animation.channels) {
      const { node, path } = channel.target;
      assert.ok(boneNodes.has(node), `${animation.name}: every animation target must be a bone node`);
      assert.ok(['translation', 'rotation', 'scale'].includes(path), `${animation.name}: unsupported bone animation path ${path}`);
      const target = `${node}:${path}`;
      assert.ok(!targets.has(target), `${animation.name}: duplicate channel target ${target}`);
      targets.add(target);
      const sampler = item(samplers, channel.sampler, `${animation.name} channel sampler`);
      usedSamplers.add(channel.sampler);
      const { input, output, multiplier } = sampler;
      assert.equal(output.type, path === 'rotation' ? 'VEC4' : 'VEC3', `${animation.name}: invalid ${path} output type`);
      const valueOffset = key => (key * multiplier + (multiplier === 3 ? 1 : 0)) * output.components;
      if (path === 'rotation') {
        for (let key = 0; key < input.count; key++) {
          const offset = valueOffset(key);
          const norm = Math.hypot(...output.values.subarray(offset, offset + 4));
          assert.ok(Math.abs(norm - 1) <= tolerance, `${animation.name}: non-unit quaternion at key ${key}`);
        }
      }
      if (animation.name === 'Walk') {
        const first = valueOffset(0);
        const last = valueOffset(input.count - 1);
        let directError = 0;
        let negatedError = 0;
        for (let component = 0; component < output.components; component++) {
          directError = Math.max(directError, Math.abs(output.values[first + component] - output.values[last + component]));
          negatedError = Math.max(negatedError, Math.abs(output.values[first + component] + output.values[last + component]));
        }
        const error = path === 'rotation' ? Math.min(directError, negatedError) : directError;
        assert.ok(error <= tolerance, `Walk: ${gltf.nodes[node].name} ${path} endpoints do not loop (${error})`);
      }
    }
    assert.equal(usedSamplers.size, samplers.length, `${animation.name}: all samplers must be used by bone channels`);
    const duration = Math.max(...samplers.map(sampler => sampler.duration));
    assert.ok(duration > 0, `${animation.name}: duration must be positive`);
    return { name: animation.name, channelCount: animation.channels.length, samplerCount: samplers.length, duration, loopingEndpoints: animation.name === 'Walk' ? true : undefined };
  });
  const summary = {
    file: 'cat-operator-rigged.glb', bytes: bytes.length, triangles,
    bones, skinCount: gltf.skins.length, meshCount: gltf.meshes.length,
    meshNodeCount: meshNodes.length, weightedVertexCount, maxWeightError,
    embeddedImages: gltf.images?.length ?? 0, animations,
    original: { file: 'cat-operator.glb', gitBlobHash: originalHash, rigged: false, meshCount: original.meshes.length, meshNodeCount: originalMeshNodes.length },
    errors: report.issues.numErrors, warnings: report.issues.numWarnings, info: report.issues.messages,
  };
  await writeFile(new URL('rig-validation.json', directory), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(`Rig validation failed: ${error.message}`);
  process.exitCode = 1;
}
