# Avatar workflow

- `npm ci` installs pinned Three.js, Playwright, and Khronos glTF Validator dependencies.
- `npm run dev` serves the local avatar viewer on `http://127.0.0.1:4173` (loopback only).
- With the server running, `STAGE=1 npm run capture` captures an authoring pass. Stages are selected by the model factory.
- `npm run export` writes `assets/cat-operator/cat-operator.glb` and captures the authored model.
- `node scripts/capture.mjs --glb` reloads the exported GLB and captures front, rear, both sides, and a three-quarter view.
- Screenshot capture uses the locally installed Google Chrome through Playwright's `chrome` channel.
- `npm test` checks the GLB with Khronos glTF Validator, embedded resources, required feature names, absence of studio objects, and asset size/triangle budgets.
- Review fresh saved screenshots separately from structural validation. Neither a valid GLB nor a passing geometry test proves reference likeness.
- The cat operator is a stylized reconstruction, not a scan. The original `cat-operator.glb` stays static; `cat-operator-rigged.glb` contains the 22-bone body rig and Idle/Walk/Wave clips. Neither contains a finger or facial rig.
- `npm run export:rig` exports the rigged asset and captures bind, animation, and stress poses; `npm run capture:rig` captures the reloaded rigged GLB.
- `npm test` validates both GLBs. `npm run test:motion` additionally requires the running server and Chrome, and compares source/re-import deformation, loop continuity, planted-foot height, and bind-pose appearance.
- `npm run preview:rig` generates walking and waving GIFs from the exported GLB and additionally requires FFmpeg.
- Keep skinned meshes at glTF scene roots alongside the skeleton root when exporting; placing them under an Object3D parent causes Khronos `NODE_SKINNED_MESH_NON_ROOT` warnings.
- Rig skin weights are authored in baked bind-pose world coordinates. The unweighted `Root` bone is an intentional global control, not a missing skin assignment.
