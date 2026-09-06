import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { validateBytes } from 'gltf-validator';

const filename = new URL('../assets/cat-operator/cat-operator.glb', import.meta.url);
const bytes = await readFile(filename);
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(bytes.readUInt32LE(4), 2, 'glTF 2.0');
assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB byte length');
const length = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString());
const report = await validateBytes(new Uint8Array(bytes), { uri: 'cat-operator.glb', maxIssues: 10000 });
const problems = report.issues.messages.filter(issue => issue.severity < 2);
assert.equal(report.issues.numErrors, 0, JSON.stringify(problems));
assert.equal(report.issues.numWarnings, 0, JSON.stringify(problems));
assert.ok(gltf.meshes.length >= 50, 'Detailed multipart asset expected');
assert.ok(gltf.materials.length >= 10, 'Distinct materials expected');
assert.ok(!gltf.cameras?.length, 'No studio cameras exported');
assert.ok(!gltf.extensionsUsed?.includes('KHR_lights_punctual'), 'No studio lights exported');
assert.ok(gltf.buffers.every(b => !b.uri), 'Geometry must be embedded');
assert.ok((gltf.images || []).every(image => Number.isInteger(image.bufferView)), 'All textures must be embedded');
assert.ok(gltf.nodes.every(node => node.name), 'All nodes should be named');
const names = gltf.nodes.map(node => `${node.name} ${node.extras?.semanticName || ''}`).join('\n');
for (const feature of ['head', 'ear', 'eye', 'whisker', 'shirt', 'tie', 'badge', 'pocket', 'boot', 'headset', 'microphone']) {
  assert.match(names.toLowerCase(), new RegExp(feature), `Missing feature: ${feature}`);
}
let triangles = 0;
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4, 'Triangle mesh expected');
    triangles += gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3;
  }
}
assert.ok(triangles < 300000, `Triangle budget exceeded: ${triangles}`);
assert.ok(bytes.length < 30 * 1024 * 1024, 'GLB must remain below 30 MB');
const summary = { file: 'cat-operator.glb', bytes: bytes.length, triangles, meshes: gltf.meshes.length, nodes: gltf.nodes.length, materials: gltf.materials.length, embeddedImages: gltf.images?.length || 0, errors: report.issues.numErrors, warnings: report.issues.numWarnings, info: report.issues.messages, rigged: Boolean(gltf.skins?.length), animations: gltf.animations?.length || 0 };
await writeFile(new URL('../assets/cat-operator/validation.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
