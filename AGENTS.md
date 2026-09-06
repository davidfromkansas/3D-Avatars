# Avatar workflow

- `npm ci` installs pinned Three.js, Playwright, and Khronos glTF Validator dependencies.
- `npm run dev` serves the local avatar viewer on `http://127.0.0.1:4173` (loopback only).
- With the server running, `STAGE=1 npm run capture` captures an authoring pass. Stages are selected by the model factory.
- `npm run export` writes `assets/cat-operator/cat-operator.glb` and captures the authored model.
- `node scripts/capture.mjs --glb` reloads the exported GLB and captures front, rear, both sides, and a three-quarter view.
- Screenshot capture uses the locally installed Google Chrome through Playwright's `chrome` channel.
- `npm test` checks the GLB with Khronos glTF Validator, embedded resources, required feature names, absence of studio objects, and asset size/triangle budgets.
- Review fresh saved screenshots separately from structural validation. Neither a valid GLB nor a passing geometry test proves reference likeness.
- The cat operator is a stylized reconstruction, not a scan. Do not claim a skinning rig or animations unless the exported GLB actually contains them.
