import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V = p => new THREE.Vector3(...p);
const signedPower = (n, p) => Math.sign(n) * Math.abs(n) ** p;

function surface(fn, columns = 96, rows = 56) {
  const positions = [], uvs = [], indices = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      positions.push(...fn(i / columns, j / rows));
      uvs.push(i / columns, j / rows);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const a = j * (columns + 1) + i, b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;
  for (let j = 0; j <= rows; j++) {
    const first = j * (columns + 1), last = first + columns;
    const n = new THREE.Vector3().fromBufferAttribute(normal, first).add(new THREE.Vector3().fromBufferAttribute(normal, last)).normalize();
    normal.setXYZ(first, n.x, n.y, n.z);
    normal.setXYZ(last, n.x, n.y, n.z);
  }
  return geometry;
}

function headPoint(u, v) {
  const lon = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
  const s = Math.sin(lat), c = Math.max(0, Math.cos(lat));
  const y = 2.625 + 0.585 * signedPower(s, 0.87);
  const x = 0.754 * c ** 0.73 * Math.sin(lon) * (1 - 0.10 * Math.max(s, 0));
  let z = 0.565 * c ** 0.83 * Math.cos(lon);
  if (z > 0) z += 0.066 * Math.exp(-(((y - 2.33) / 0.21) ** 2)) * Math.exp(-((x / 0.48) ** 4)) * Math.cos(lon) ** 2;
  return [x, y, z];
}

function loft(rings, segments = 56, steps = 54, power = 1) {
  const curves = [0, 1, 2, 3, 4].map(k => new THREE.SplineCurve(rings.map((r, i) => new THREE.Vector2(i, r[k] || 0))));
  return surface((u, v) => {
    const sample = curves.map(c => c.getPoint(v).y);
    const [y, rx, rz, x, z] = sample;
    const a = u * Math.PI * 2 - Math.PI;
    return [x + Math.max(0.00001, rx) * signedPower(Math.sin(a), power), y, z + Math.max(0.00001, rz) * signedPower(Math.cos(a), power)];
  }, segments, steps);
}

export function createCatOperator({ stage = 4 } = {}) {
  const root = new THREE.Group();
  root.name = 'Cat-Operator';
  root.userData = { description: 'Stylized four-view reconstruction; static standing pose; no skeletal skinning', units: 'meters', frontAxis: '+Z', sculptRuntime: { version: 1, staticPose: true, selectableParts: true, rigidPartPivots: true, skinning: false } };
  const materials = {};
  function material(name, color, roughness, metalness = 0, extras = {}) {
    const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness, ...extras });
    m.name = name;
    materials[name] = m;
    return m;
  }
  const orange = material('Orange satin fur', '#f68b25', 0.58);
  const cream = material('Warm white fur', '#f6eee6', 0.67);
  const shirt = material('Ivory cotton', '#eee7e3', 0.83);
  const pants = material('Charcoal twill', '#343438', 0.9);
  const rubber = material('Soft black rubber', '#171719', 0.69);
  const clay = material('Blockout clay', '#a4a2a0', 0.82);
  function group(name, pivot = [0, 0, 0], parent = root) {
    const g = new THREE.Group();
    g.name = name;
    g.position.copy(V(pivot));
    parent.add(g);
    g.userData.pivot = pivot;
    return g;
  }
  function mesh(parent, name, geometry, mat, pos = [0, 0, 0]) {
    const o = new THREE.Mesh(geometry, stage === 1 ? clay : mat);
    o.name = name;
    o.position.copy(V(pos));
    parent.updateWorldMatrix(true, false);
    o.position.sub(parent.getWorldPosition(new THREE.Vector3()));
    parent.add(o);
    return o;
  }
  function ellipsoid(parent, name, pos, scale, mat, segments = 48) {
    const o = mesh(parent, name, new THREE.SphereGeometry(1, segments, 32), mat, pos);
    o.scale.copy(V(scale));
    return o;
  }
  function box(parent, name, pos, size, radius, mat) {
    return mesh(parent, name, new RoundedBoxGeometry(...size, 3, radius), mat, pos);
  }
  function tube(parent, name, points, radius, mat, segments = 48, sides = 10) {
    return mesh(parent, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(V)), segments, radius, sides, false), mat);
  }
  function capsule(parent, name, start, end, radiusA, radiusB, mat) {
    const a = V(start), b = V(end), length = a.distanceTo(b);
    const o = mesh(parent, name, new THREE.CylinderGeometry(radiusA, radiusB, length, 48, 12), mat, a.clone().add(b).multiplyScalar(0.5).toArray());
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().sub(b).normalize());
    return o;
  }
  const head = group('head-pivot', [0, 2.06, 0]);
  mesh(head, 'head', surface(headPoint), orange);
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'r' : 'l';
    const shape = new THREE.Shape();
    shape.moveTo(sign * 0.31, 3.025);
    shape.bezierCurveTo(sign * 0.38, 3.22, sign * 0.59, 3.42, sign * 0.685, 3.49);
    shape.bezierCurveTo(sign * 0.724, 3.52, sign * 0.755, 3.30, sign * 0.753, 3.17);
    shape.bezierCurveTo(sign * 0.76, 2.98, sign * 0.714, 2.84, sign * 0.654, 2.80);
    shape.bezierCurveTo(sign * 0.55, 2.79, sign * 0.38, 2.92, sign * 0.31, 3.025);
    const ear = new THREE.ExtrudeGeometry(shape, { depth: 0.115, bevelEnabled: true, bevelSize: 0.026, bevelThickness: 0.032, bevelSegments: 5, steps: 2, curveSegments: 18 });
    mesh(head, `ear-${side}`, ear, orange, [0, 0, -0.11]);
  }
  ellipsoid(root, 'neck', [0, 2.015, 0], [0.16, 0.19, 0.16], cream);
  const torso = group('shirt-pivot', [0, 1.27, 0]);
  mesh(torso, 'shirt', loft([[1.245,0.01,0.01],[1.255,0.37,0.235],[1.29,0.415,0.263],[1.39,0.397,0.269],[1.60,0.371,0.245],[1.79,0.335,0.208],[1.91,0.235,0.154],[1.961,0.11,0.105],[1.965,0.01,0.01]], 64, 56, 0.83), shirt);
  const pelvis = group('pants-pelvis-pivot', [0, 1.23, 0]);
  ellipsoid(pelvis, 'pants-pelvis', [0, 1.145, 0], [0.418, 0.192, 0.249], pants);
  mesh(pelvis, 'belt', loft([[1.20,0.403,0.25],[1.25,0.409,0.257],[1.30,0.4,0.25]], 64, 10, 0.84), rubber);
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'r' : 'l';
    const arm = group(`arm-${side}-pivot`, [sign * 0.34, 1.82, 0]);
    capsule(arm, `arm-${side}`, [sign * 0.40, 1.80, 0], [sign * 0.755, 1.11, 0.015], 0.142, 0.117, orange);
    capsule(arm, `sleeve-${side}`, [sign * 0.37, 1.82, 0], [sign * 0.583, 1.475, 0.004], 0.18, 0.16, shirt);
    ellipsoid(arm, `sleeve-shoulder-${side}`, [sign * 0.366, 1.787, 0], [0.18,0.188,0.18], shirt);
    ellipsoid(arm, `paw-${side}`, [sign * 0.755, 1.09, 0.012], [0.145, 0.188, 0.143], cream);
    const leg = group(`pant-leg-${side}-pivot`, [sign * 0.225, 1.16, 0]);
    mesh(leg, `pant-leg-${side}`, loft([[0.30,0.185,0.173,sign*0.313],[0.36,0.195,0.186,sign*0.307],[0.44,0.199,0.191,sign*0.310],[0.50,0.211,0.201,sign*0.310],[0.58,0.199,0.185,sign*0.30],[0.79,0.201,0.199,sign*0.281],[0.98,0.215,0.224,sign*0.245],[1.16,0.205,0.227,sign*0.214],[1.21,0.10,0.12,sign*0.20]], 56, 64, 0.86), pants);
    const boot = ellipsoid(leg, `boot-${side}`, [sign*0.353,0.18,0.095], [0.22,0.177,0.325], rubber);
    boot.rotation.y = sign * 0.16;
    const sole = box(leg, `boot-sole-${side}`, [sign*0.353,0.0425,0.095], [0.44,0.085,0.63], 0.061, rubber);
    sole.rotation.y = sign * 0.16;
  }
  if (stage < 2) return root;
  const pink = material('Rose inner ear', '#e98f91', 0.74);
  const noseMat = material('Pink nose leather', '#e97885', 0.42);
  const ivory = material('Eye sclera', '#fffaf4', 0.25);
  const black = material('Eye pupil gloss', '#100e0e', 0.13, 0, { clearcoat: 0.8, clearcoatRoughness: 0.12 });
  const iris = material('Brown iris', '#4c2c19', 0.24, 0, { clearcoat: 0.5 });
  const ink = material('Eyelids and smile', '#261b18', 0.66);
  const navy = material('Navy woven tie', '#24354e', 0.8);
  const webbing = material('Black lanyard webbing', '#202021', 0.9);
  const plastic = material('Headset charcoal housing', '#27272b', 0.46);
  const steel = material('Satin silver hardware', '#a8a9ad', 0.32, 0.8);
  const seam = material('Charcoal seam thread', '#29292d', 0.93);
  const whiteThread = material('Cotton seam thread', '#d5ccc7', 0.93);
  const leather = material('Boot leather', '#232324', 0.49);
  const highlight = material('Eye catchlights', '#ffffff', 0.10, 0, { emissive: '#ffffff', emissiveIntensity: 0.35 });
  function panel(parent, name, points, thickness, mat, bevel = 0.01) {
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, steps: 1, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
    return mesh(parent, name, geometry, mat, [0, 0, points[0][2]]);
  }
  function ribbon(parent, name, points, width, thickness, mat) {
    const curve = new THREE.CatmullRomCurve3(points.map(V));
    const half = width / 2;
    const shape = new THREE.Shape([new THREE.Vector2(-half,-thickness/2),new THREE.Vector2(half,-thickness/2),new THREE.Vector2(half,thickness/2),new THREE.Vector2(-half,thickness/2)]);
    return mesh(parent, name, new THREE.ExtrudeGeometry(shape, { steps: 72, bevelEnabled: false, extrudePath: curve }), mat);
  }
  function roundedFrame(parent, name, center, size, width, mat) {
    const [x,y,z] = center, [w,h] = size, r = Math.min(0.018,w/6,h/6);
    const pts = [[x-w/2+r,y-h/2,z],[x+w/2-r,y-h/2,z],[x+w/2,y-h/2+r,z],[x+w/2,y+h/2-r,z],[x+w/2-r,y+h/2,z],[x-w/2+r,y+h/2,z],[x-w/2,y+h/2-r,z],[x-w/2,y-h/2+r,z],[x-w/2+r,y-h/2,z]];
    return tube(parent,name,pts,width,mat,64,8);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const u = x/(canvas.width-1), v = 1-y/(canvas.height-1);
      const [px,py] = headPoint(u,v), lon = (u-0.5)*Math.PI*2;
      const boundary = 3.21 - 1.08 * Math.abs(px) ** 0.65 - 0.23 * (1-Math.cos(lon));
      const white = Math.cos(lon) > 0.04 ? THREE.MathUtils.smoothstep(boundary-py,-0.003,0.003) : 0;
      const orangeRGB = stage>=4 ? [255,105,18] : [246,139,37], creamRGB = [247,238,228];
      const i = (y*canvas.width+x)*4;
      for (let k=0;k<3;k++) image.data[i+k] = orangeRGB[k]*(1-white)+creamRGB[k]*white;
      image.data[i+3]=255;
    }
  }
  ctx.putImageData(image,0,0);
  const faceMap = new THREE.CanvasTexture(canvas);
  faceMap.name = 'Authored orange fur and white blaze';
  faceMap.colorSpace = THREE.SRGBColorSpace;
  const faceMat = orange.clone();
  faceMat.name = 'Orange and white face coat';
  faceMat.color.set('#ffffff'); faceMat.map = faceMap;
  root.getObjectByName('head').material = faceMat;
  root.getObjectByName('head').userData.surfaceFeatures = ['face-blaze'];
  for (const sign of [-1,1]) {
    const side = sign < 0 ? 'r' : 'l';
    const shape = new THREE.Shape();
    shape.moveTo(sign*0.375,3.015);
    shape.bezierCurveTo(sign*0.46,3.21,sign*0.63,3.42,sign*0.680,3.45);
    shape.bezierCurveTo(sign*0.727,3.27,sign*0.724,2.99,sign*0.646,2.865);
    shape.bezierCurveTo(sign*0.54,2.89,sign*0.43,2.96,sign*0.375,3.015);
    mesh(head,`ear-inset-${side}`,new THREE.ExtrudeGeometry(shape,{depth:0.008,bevelEnabled:true,bevelSize:0.008,bevelThickness:0.009,bevelSegments:3,curveSegments:24}),pink,[0,0,0.016]);
    ellipsoid(head,`eye-upper-rim-${side}`,[sign*0.307,2.535,0.517],[0.178,0.182,0.069],ink);
    ellipsoid(head,`eye-sclera-${side}`,[sign*0.307,2.525,0.539],[0.164,0.169,0.072],ivory);
    ellipsoid(head,`eye-iris-${side}`,[sign*0.295,2.521,0.598],[0.119,0.155,0.038],iris);
    ellipsoid(head,`eye-pupil-${side}`,[sign*0.291,2.539,0.624],[0.088,0.125,0.027],black);
    ellipsoid(head,`eye-catchlight-${side}`,[sign*0.291-0.031,2.601,0.649],[0.022,0.024,0.007],highlight,24);
    const whiskers = group(`whiskers-${side}`,[0,0,0],head);
    for (let i=0;i<3;i++) {
      tube(whiskers,`whisker-${side}-${i+1}`,[[sign*0.47,2.315-i*0.018,0.458],[sign*0.63,2.34-i*0.043,0.413],[sign*(0.85-i*0.046),2.34-i*0.085,0.365]],0.0053-i*0.00045,cream,32,7);
    }
    const arm=root.getObjectByName(`arm-${side}-pivot`);
    const cuff=mesh(arm,`cuff-${side}`,loft([[-0.062,0.156,0.156],[-0.052,0.183,0.183],[0.040,0.184,0.184],[0.057,0.170,0.170]],48,16),shirt,[sign*0.583,1.478,0.004]);
    cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),V([sign*0.51,-0.86,0]));
    panel(torso,`collar-${side}`,[[sign*0.045,1.873,0.18],[sign*0.148,2.016,0.18],[sign*0.274,1.955,0.18],[sign*0.164,1.786,0.18]],0.046,shirt,0.012);
    const leg=root.getObjectByName(`pant-leg-${side}-pivot`);
    box(leg,`pant-hem-${side}`,[sign*0.310,0.340,0],[0.392,0.109,0.382],0.035,pants).rotation.z=sign*0.055;
    const pocket=box(leg,`cargo-pocket-${side}`,[sign*0.458,0.82,0.016],[0.096,0.31,0.253],0.03,pants);
    pocket.rotation.z=sign*0.065;
    box(leg,`cargo-flap-${side}`,[sign*0.469,0.962,0.016],[0.108,0.112,0.27],0.020,pants).rotation.z=sign*0.065;
    box(pelvis,`rear-welt-${side}`,[sign*0.212,1.081,-0.248],[0.214,0.058,0.026],0.012,pants);
    const boot=root.getObjectByName(`boot-${side}`);
    boot.material=leather;
    ellipsoid(leg,`boot-ankle-${side}`,[sign*0.319,0.255,-0.066],[0.182,0.157,0.180],leather);
    tube(leg,`boot-toe-seam-${side}`,[[sign*0.15,0.103,0.193],[sign*0.192,0.244,0.206],[sign*0.34,0.290,0.233],[sign*0.51,0.216,0.201],[sign*0.553,0.096,0.177]],0.006,seam,48,8);
    const laces=group(`boot-laces-${side}`,[0,0,0],leg);
    for(let i=0;i<3;i++) tube(laces,`boot-lace-${side}-${i+1}`,[[sign*0.241,0.324-i*0.011,0.009+i*0.06],[sign*0.327,0.348-i*0.016,0.025+i*0.056],[sign*0.405,0.321-i*0.015,0.039+i*0.054]],0.010,webbing,18,7);
  }
  const noseShape=new THREE.Shape();
  noseShape.moveTo(-0.066,2.397);
  noseShape.bezierCurveTo(-0.079,2.428,0.079,2.428,0.066,2.397);
  noseShape.bezierCurveTo(0.042,2.359,0.015,2.343,0,2.344);
  noseShape.bezierCurveTo(-0.018,2.346,-0.048,2.365,-0.066,2.397);
  mesh(head,'nose',new THREE.ExtrudeGeometry(noseShape,{depth:0.024,bevelEnabled:true,bevelSize:0.009,bevelThickness:0.013,bevelSegments:5,curveSegments:18}),noseMat,[0,0,0.592]);
  const mouth=group('mouth',[0,0,0],head);
  tube(mouth,'mouth-philtrum',[[0,2.349,0.623],[0,2.314,0.625],[0,2.300,0.625]],0.005,ink,18,7);
  for(const sign of [-1,1]) tube(mouth,`mouth-smile-${sign}`,[[0,2.302,0.625],[sign*0.045,2.269,0.619],[sign*0.105,2.272,0.608],[sign*0.149,2.308,0.592]],0.005,ink,30,8);
  panel(torso,'tie',[[0,1.799,0.285],[-0.071,1.745,0.285],[-0.10,1.337,0.285],[0,1.283,0.285],[0.10,1.337,0.285],[0.071,1.745,0.285]],0.012,navy,0.006);
  panel(torso,'tie-knot',[[-0.074,1.857,0.260],[0.074,1.857,0.260],[0.054,1.755,0.260],[-0.052,1.755,0.260]],0.057,navy,0.016);
  const lanyard=group('lanyard',[0,0,0],torso);
  for(const sign of [-1,1]) ribbon(lanyard,`lanyard-strap-${sign}`,[[sign*0.232,1.980,0.081],[sign*0.253,1.933,0.173],[sign*0.182,1.806,0.280],[sign*0.089,1.641,0.303],[0,1.50,0.319]],0.033,0.010,webbing);
  ribbon(lanyard,'lanyard-neck',[[0.232,1.98,0.08],[0.205,1.973,-0.134],[0,1.957,-0.185],[-0.205,1.973,-0.134],[-0.232,1.98,0.08]],0.026,0.012,webbing);
  ellipsoid(torso,'id-clip',[0,1.5,0.341],[0.023,0.036,0.017],steel,24);
  box(torso,'id-clip-loop',[0,1.456,0.343],[0.018,0.052,0.025],0.007,steel);
  box(torso,'id-badge-frame',[0,1.357,0.338],[0.168,0.200,0.035],0.014,webbing);
  box(torso,'id-badge',[0,1.358,0.360],[0.128,0.162,0.010],0.004,ivory);
  panel(torso,'shirt-pocket',[[0.166,1.685,0.249],[0.344,1.685,0.249],[0.345,1.506,0.249],[0.261,1.479,0.249],[0.176,1.505,0.249]],0.020,shirt,0.006);
  box(torso,'shirt-pocket-hem',[0.257,1.666,0.278],[0.176,0.023,0.014],0.004,shirt);
  box(torso,'pen',[0.279,1.714,0.249],[0.034,0.140,0.033],0.013,plastic);
  box(torso,'pen-clip',[0.294,1.726,0.271],[0.009,0.073,0.009],0.004,steel);
  roundedFrame(pelvis,'belt-buckle',[0,1.205,0.272],[0.123,0.096],0.014,steel);
  for(const [i,a] of [-0.63,0.63,1.67,Math.PI,-1.67].entries()) {
    const loop=box(pelvis,`belt-loop-${i+1}`,[Math.sin(a)*0.409,1.247,Math.cos(a)*0.260],[0.055,0.123,0.026],0.006,pants);
    loop.rotation.y=a;
  }
  const headset=group('headset',[0,0,0],head);
  const bandPoints=[];
  for(let i=0;i<=40;i++) {
    const a=-Math.PI/2 + Math.PI*i/40;
    bandPoints.push([0.754*signedPower(Math.sin(a),0.73)*(1-0.10*Math.cos(a))+0.025*Math.sin(a),2.625+0.612*Math.cos(a)**0.87,0.068]);
  }
  ribbon(headset,'headband',bandPoints,0.106,0.032,plastic);
  ribbon(headset,'headband-pad',bandPoints.map(([x,y,z])=>[x*0.99,y-0.015,z]),0.095,0.020,rubber);
  for(const sign of [-1,1]) {
    const side=sign<0?'r':'l';
    const cup=new THREE.Group(); cup.name=`earcup-${side}-assembly`; headset.add(cup);
    for(const [name,offset,radius,depth,mat] of [[`earcup-pad-${side}`,0.745,0.192,0.088,rubber],[`earcup-${side}`,0.794,0.183,0.065,plastic],[`earcup-rim-${side}`,0.834,0.163,0.018,steel],[`earcup-face-${side}`,0.847,0.150,0.020,plastic]]) {
      const o=mesh(cup,name,new THREE.CylinderGeometry(radius,radius,depth,64,1),mat,[sign*offset,2.536,0.035]);
      o.rotation.z=Math.PI/2;
    }
    box(headset,`headband-slider-${side}`,[sign*0.713,2.826,0.054],[0.059,0.164,0.115],0.011,plastic).rotation.z=sign*0.27;
  }
  tube(headset,'mic-boom',[[0.846,2.47,0.112],[0.806,2.363,0.291],[0.660,2.259,0.481],[0.469,2.207,0.600],[0.318,2.21,0.651]],0.0195,plastic,64,12);
  ellipsoid(headset,'mic-capsule',[0.295,2.209,0.655],[0.092,0.059,0.058],rubber);
  root.getObjectByName('mic-capsule').userData.semanticName='microphone';
  function replaceGeometry(object, geometry) {
    object.geometry.dispose();
    object.geometry = geometry;
    object.scale.set(1,1,1);
  }
  for(const sign of [-1,1]) {
    const side=sign<0?'r':'l';
    const outer=root.getObjectByName(`ear-${side}`);
    let outline=outer.geometry.parameters.shapes.getSpacedPoints(96);
    if(!THREE.ShapeUtils.isClockWise(outline)) outline=outline.reverse();
    function earAt(u,r,z) {
      const f=u*(outline.length-1), i=Math.min(outline.length-2,Math.floor(f)), t=f-i;
      const p=outline[i].clone().lerp(outline[i+1],t);
      const x=sign*0.585+(p.x-sign*0.585)*r, y=3.123+(p.y-3.123)*r;
      return [x,y,z-(y-2.92)*0.22];
    }
    replaceGeometry(outer,surface((u,v)=> {
      if(v<0.45) { const r=v/0.45; return earAt(u,r,-0.005+0.105*r*r); }
      if(v<0.55) return earAt(u,1,0.1-(v-0.45)*1.3);
      const r=(1-v)/0.45; return earAt(u,r,-0.03-0.14*(1-r*r));
    },96,64));
    outer.position.z=0;
    const inset=root.getObjectByName(`ear-inset-${side}`);
    replaceGeometry(inset,surface((u,v)=>{const r=v*0.80;return earAt(u,r,0.001+0.105*r*r);},96,24));
    inset.position.z=0;
    const upper=root.getObjectByName(`eye-upper-rim-${side}`);
    upper.visible=true;
    upper.position.y=2.525-2.06; upper.position.z=0.509;
    upper.scale.set(0.187,0.179,0.054);
    const sc=root.getObjectByName(`eye-sclera-${side}`);
    sc.position.z=0.516;
    sc.scale.set(0.180,0.170,0.057);
    const ir=root.getObjectByName(`eye-iris-${side}`);
    ir.position.z=0.565; ir.scale.set(0.128,0.153,0.031);
    const pu=root.getObjectByName(`eye-pupil-${side}`);
    pu.position.z=0.590; pu.scale.set(0.097,0.126,0.022);
    root.getObjectByName(`eye-catchlight-${side}`).position.z=0.614;
    const lidPts=[];
    for(let i=0;i<=32;i++) {
      const a=0.05+Math.PI*0.94*i/32;
      lidPts.push([sign*0.307+0.169*Math.cos(a),2.525+0.160*Math.sin(a),0.518+0.018*Math.sin(a)]);
    }
    tube(head,`eye-upper-rim-${side}-contour`,lidPts,0.012,ink,40,8).visible=false;
    const arm=root.getObjectByName(`arm-${side}-pivot`);
    root.getObjectByName(`sleeve-shoulder-${side}`).visible=false;
    const sleeve=root.getObjectByName(`sleeve-${side}`);
    const start=V([sign*0.302,1.866,-0.004]), end=V([sign*0.60,1.44,0.002]);
    const length=start.distanceTo(end), rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),end.clone().sub(start).normalize());
    const sleeveGeometry=loft([[0,0.015,0.015],[0.055,0.148,0.150],[0.13,0.187,0.180],[0.24,0.181,0.174],[length-0.03,0.168,0.164],[length,0.161,0.159]],56,40);
    sleeveGeometry.applyQuaternion(rotation); sleeveGeometry.translate(...start.toArray());
    replaceGeometry(sleeve,sleeveGeometry);
    sleeve.position.copy(arm.getWorldPosition(new THREE.Vector3())).negate(); sleeve.quaternion.identity();
    const leg=root.getObjectByName(`pant-leg-${side}-pivot`);
    const boot=root.getObjectByName(`boot-${side}`);
    replaceGeometry(boot,loft([[0.037,0.001,0.001,sign*0.35,0.09],[0.046,0.213,0.306,sign*0.35,0.09],[0.095,0.219,0.314,sign*0.351,0.085],[0.168,0.212,0.292,sign*0.35,0.075],[0.23,0.193,0.236,sign*0.337,0.02],[0.294,0.175,0.167,sign*0.320,-0.062],[0.366,0.172,0.156,sign*0.312,-0.065],[0.38,0.001,0.001,sign*0.312,-0.065]],64,56,0.83));
    boot.position.copy(leg.getWorldPosition(new THREE.Vector3())).negate(); boot.quaternion.identity();
    root.getObjectByName(`boot-ankle-${side}`).visible=false;
    const sole=root.getObjectByName(`boot-sole-${side}`);
    replaceGeometry(sole,loft([[0,0.001,0.001,sign*0.351,0.088],[0.001,0.220,0.315,sign*0.351,0.088],[0.014,0.225,0.322,sign*0.351,0.088],[0.065,0.224,0.322,sign*0.351,0.088],[0.078,0.212,0.309,sign*0.351,0.088]],64,16,0.80));
    sole.position.copy(leg.getWorldPosition(new THREE.Vector3())).negate(); sole.quaternion.identity();
    const hem=root.getObjectByName(`pant-hem-${side}`);
    replaceGeometry(hem,loft([[0.287,0.181,0.173,sign*0.313],[0.295,0.200,0.191,sign*0.313],[0.377,0.206,0.195,sign*0.305],[0.393,0.196,0.187,sign*0.305]],56,16,0.88));
    hem.position.copy(leg.getWorldPosition(new THREE.Vector3())).negate(); hem.quaternion.identity();
    root.getObjectByName(`boot-toe-seam-${side}`).visible=false;
    tube(leg,`boot-toe-cap-stitch-${side}`,[[sign*0.158,0.106,0.21],[sign*0.203,0.197,0.237],[sign*0.350,0.225,0.261],[sign*0.495,0.192,0.233],[sign*0.545,0.10,0.204]],0.004,seam,48,7);
    root.getObjectByName(`boot-laces-${side}`).visible=false;
    const laceGroup=group(`boot-laces-visible-${side}`,[0,0,0],leg);
    for(let i=0;i<3;i++) tube(laceGroup,`boot-lace-row-${side}-${i}`,[[sign*0.261,0.267-i*0.02,0.115+i*0.044],[sign*0.339,0.280-i*0.020,0.126+i*0.044],[sign*0.415,0.266-i*0.02,0.116+i*0.044]],0.008,webbing,20,7);
  }
  function frontDepth(x,y) {
    const s=signedPower(THREE.MathUtils.clamp((y-2.625)/0.585,-1,1),1/0.87);
    const lat=Math.asin(s), c=Math.cos(lat), w=0.754*c**0.73*(1-0.10*Math.max(s,0));
    const lon=Math.asin(THREE.MathUtils.clamp(x/w,-1,1));
    return headPoint(0.5+lon/(2*Math.PI),0.5+lat/Math.PI)[2];
  }
  mouth.traverse(o=>{
    if(!o.isMesh)return;
    const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++)p.setZ(i,frontDepth(p.getX(i),p.getY(i))+0.004+(p.getZ(i)-0.618)*0.07);
    p.needsUpdate=true;o.geometry.computeVertexNormals();
  });
  root.getObjectByName('nose').position.z=frontDepth(0,2.39)-0.006;
  mesh(torso,'collar-stand',loft([[1.93,0.17,0.156],[1.98,0.174,0.160],[2.035,0.145,0.14]],56,20),shirt);
  if(stage<3)return root;
  const ray = new THREE.Raycaster();
  root.updateMatrixWorld(true);
  function surfaceLine(parent,name,host,points,radius,mat,back=false,direction=null) {
    host.updateWorldMatrix(true,false);
    const spline=new THREE.CatmullRomCurve3(points.map(V));
    const d=direction||new THREE.Vector3(0,0,back?1:-1);
    const seated=spline.getPoints(64).flatMap(p=>{
      ray.set(p.clone().addScaledVector(d,-2),d);
      const hit=ray.intersectObject(host,false)[0];
      return hit ? [hit.point.addScaledVector(hit.face.normal.clone().transformDirection(host.matrixWorld),radius*0.7).toArray()] : [];
    });
    if(seated.length<2)return null;
    const o=tube(parent,name,seated,radius,mat,96,6);
    o.userData.explodeWithParent=true;
    return o;
  }
  for(const sign of [-1,1]) {
    const side=sign<0?'r':'l',arm=root.getObjectByName(`arm-${side}-pivot`),leg=root.getObjectByName(`pant-leg-${side}-pivot`);
    const oldCollar=root.getObjectByName(`collar-${side}`);
    oldCollar.name=`blockout-collar-${side}`; oldCollar.visible=false;
    const collar=panel(torso,`collar-${side}`,[[sign*0.04,1.910,0.18],[sign*0.135,2.014,0.18],[sign*0.266,1.951,0.18],[sign*0.143,1.810,0.18]],0.016,shirt,0.011);
    const cp=collar.geometry.attributes.position;
    for(let i=0;i<cp.count;i++)cp.setZ(i,cp.getZ(i)+(1.94-cp.getY(i))*0.62);
    collar.geometry.computeVertexNormals();
    surfaceLine(torso,`collar-edge-stitch-${side}`,collar,[[sign*0.065,1.906,0.2],[sign*0.143,1.832,0.27],[sign*0.240,1.946,0.19]],0.0019,whiteThread);
    const armGeometry=loft([[0.912,0.001,0.001,sign*0.758,0.010],[0.936,0.083,0.091,sign*0.758,0.010],[0.990,0.129,0.129,sign*0.758,0.010],[1.083,0.145,0.143,sign*0.750,0.010],[1.177,0.132,0.131,sign*0.724,0.010],[1.26,0.123,0.125,sign*0.693,0.008],[1.40,0.132,0.129,sign*0.62,0.004],[1.58,0.140,0.132,sign*0.515,0],[1.76,0.142,0.140,sign*0.40,0]],56,72);
    const colors=[],apos=armGeometry.attributes.position;
    const orangeColor=new THREE.Color('#f68b25'),creamColor=new THREE.Color('#f6eee6');
    for(let i=0;i<apos.count;i++) {
      const x=apos.getX(i),y=apos.getY(i),z=apos.getZ(i);
      const boundary=1.287+0.035*Math.sin((x*sign-0.68)*16)+0.025*Math.cos(z*18);
      const white=THREE.MathUtils.smoothstep(boundary-y,-0.007,0.007);
      colors.push(...orangeColor.clone().lerp(creamColor,white).toArray());
    }
    armGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const armMat=orange.clone();armMat.name=`Orange-white arm coat ${side}`;armMat.color.set('#ffffff');armMat.vertexColors=true;
    const indices=[[],[]];
    for(let i=0;i<armGeometry.index.count;i+=3) {
      const tri=[0,1,2].map(k=>armGeometry.index.getX(i+k));
      const slot=tri.reduce((n,id)=>n+apos.getY(id),0)/3<1.225?0:1;
      indices[slot].push(...tri);
    }
    for(const [idx,name] of [`paw-${side}`,`arm-${side}`].entries()) {
      const part=root.getObjectByName(name),geometry=armGeometry.clone();geometry.setIndex(indices[idx]);
      replaceGeometry(part,geometry);part.material=armMat;part.position.copy(arm.getWorldPosition(new THREE.Vector3())).negate();part.quaternion.identity();
      part.userData.continuousSurface='Shared arm/paw topology and vertex normals';
    }
    const pant=root.getObjectByName(`pant-leg-${side}`);
    surfaceLine(leg,`pant-front-seam-${side}`,pant,[[sign*0.295,1.13,0.24],[sign*0.327,0.96,0.25],[sign*0.37,0.76,0.23],[sign*0.393,0.53,0.23],[sign*0.370,0.38,0.21]],0.0023,seam);
    surfaceLine(leg,`pant-back-seam-${side}`,pant,[[sign*0.295,1.13,-0.24],[sign*0.327,0.96,-0.25],[sign*0.354,0.71,-0.23],[sign*0.367,0.4,-0.20]],0.0022,seam,true);
    surfaceLine(leg,`hip-pocket-opening-${side}`,pant,[[sign*0.329,1.18,0.23],[sign*0.395,1.055,0.23],[sign*0.437,1.017,0.21]],0.004,seam);
    const sleeve=root.getObjectByName(`sleeve-${side}`);
    surfaceLine(arm,`sleeve-seam-${side}`,sleeve,[[sign*0.33,1.874,0.14],[sign*0.45,1.803,0.17],[sign*0.49,1.692,0.18],[sign*0.55,1.555,0.18]],0.0021,whiteThread);
    const cuffAxis=V([sign*0.51,-0.86,0]).normalize(),q=new THREE.Quaternion().setFromUnitVectors(V([0,1,0]),cuffAxis);
    for(const [j,offset] of [-0.034,0.029].entries()) {
      const pts=[];
      for(let i=0;i<=64;i++){const a=2*Math.PI*i/64;pts.push(new THREE.Vector3(0.184*Math.sin(a),offset,0.184*Math.cos(a)).applyQuaternion(q).add(V([sign*0.583,1.478,0.004])).toArray());}
      tube(arm,`cuff-rolled-edge-${side}-${j}`,pts,0.0034,whiteThread,64,6);
    }
    const boot=root.getObjectByName(`boot-${side}`);
    root.getObjectByName(`boot-toe-cap-stitch-${side}`).visible=false;
    surfaceLine(leg,`boot-toe-seam-${side}-seated`,boot,[[sign*0.160,0.100,0.23],[sign*0.221,0.18,0.25],[sign*0.35,0.223,0.25],[sign*0.479,0.18,0.25],[sign*0.539,0.10,0.22]],0.0032,seam);
    root.getObjectByName(`boot-laces-visible-${side}`).visible=false;
    for(let i=0;i<3;i++) {
      const y=0.287-i*0.023;
      surfaceLine(leg,`boot-laces-${side}-seated-${i}`,boot,[[sign*0.253,y,0.20],[sign*0.339,y+0.005,0.24],[sign*0.425,y,0.20]],0.007,webbing);
    }
    surfaceLine(leg,`boot-quarter-seam-${side}`,boot,[[sign*0.178,0.08,0.2],[sign*0.205,0.17,0.2],[sign*0.234,0.273,0.17],[sign*0.28,0.31,0.15]],0.0025,seam);
    const pocketX=sign*0.518;
    surfaceLine(leg,`cargo-pocket-stitch-${side}`,root.getObjectByName(`cargo-pocket-${side}`),[[pocketX,0.92,-0.088],[pocketX,0.70,-0.088],[pocketX,0.690,0.080],[pocketX,0.920,0.080]],0.0022,seam,false,V([-sign,0,0]));
    surfaceLine(leg,`cargo-flap-stitch-${side}`,root.getObjectByName(`cargo-flap-${side}`),[[sign*0.527,0.942,-0.096],[sign*0.527,0.937,0],[sign*0.527,0.942,0.096]],0.002,seam,false,V([-sign,0,0]));
    surfaceLine(pelvis,`rear-pocket-stitch-${side}`,root.getObjectByName('pants-pelvis'),[[sign*0.12,1.07,-0.26],[sign*0.12,1.016,-0.26],[sign*0.29,1.016,-0.25],[sign*0.29,1.07,-0.25]],0.002,seam,true);
  }
  for(const [i,a] of [-0.63,0.63,1.67,Math.PI,-1.67].entries()) {
    const loop=root.getObjectByName(`belt-loop-${i+1}`);
    loop.position.x=0.414*signedPower(Math.sin(a),0.84)+0.012*Math.sin(a);
    loop.position.z=0.259*signedPower(Math.cos(a),0.84)+0.020*Math.cos(a);
  }
  const shirtShell=root.getObjectByName('shirt');
  surfaceLine(torso,'shirt-back-yoke',shirtShell,[[-0.28,1.78,-0.22],[-0.15,1.765,-0.24],[0,1.76,-0.25],[0.15,1.765,-0.24],[0.28,1.78,-0.22]],0.0023,whiteThread,true);
  surfaceLine(torso,'shirt-back-center',shirtShell,[[0,1.76,-0.25],[0,1.54,-0.27],[0,1.33,-0.28]],0.0019,whiteThread,true);
  surfaceLine(torso,'shirt-front-placket',shirtShell,[[0.022,1.89,0.2],[0.018,1.64,0.27],[0.014,1.31,0.27]],0.002,whiteThread);
  surfaceLine(torso,'shirt-pocket-stitch',root.getObjectByName('shirt-pocket'),[[0.185,1.661,0.3],[0.192,1.52,0.3],[0.26,1.496,0.3],[0.332,1.52,0.3],[0.331,1.663,0.3]],0.002,whiteThread);
  surfaceLine(pelvis,'fly-stitch',root.getObjectByName('pants-pelvis'),[[0.045,1.20,0.27],[0.041,1.10,0.27],[0.022,1.027,0.26],[-0.002,1.02,0.26]],0.0031,seam);
  if(stage<4)return root;
  orange.color.set('#ff6912');
  pink.color.set('#d66870');
  pants.color.set('#3c3b40');
  seam.color.set('#353439');
  leather.color.set('#303030');
  leather.roughness=0.68;
  rubber.roughness=0.80;
  steel.roughness=0.37;
  function texture(name,w,h,pixel,color=false) {
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const context=c.getContext('2d'),pixels=context.createImageData(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.data.set([...pixel(x,y),255],(y*w+x)*4);
    context.putImageData(pixels,0,0);
    const t=new THREE.CanvasTexture(c);t.name=name;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.anisotropy=8;
    return t;
  }
  for(const sign of [-1,1]) {
    const side=sign<0?'r':'l',part=root.getObjectByName(`arm-${side}`),positions=part.geometry.attributes.position;
    const map=texture(`Filtered orange-white arm coat ${side}`,1024,512,(x,y)=>{
      const u=x/1023*56,v=(1-y/511)*72,i=Math.min(55,Math.floor(u)),j=Math.min(71,Math.floor(v)),fu=u-i,fv=v-j;
      const p=new THREE.Vector3();
      for(const [di,dj,weight] of [[0,0,(1-fu)*(1-fv)],[1,0,fu*(1-fv)],[0,1,(1-fu)*fv],[1,1,fu*fv]])p.addScaledVector(new THREE.Vector3().fromBufferAttribute(positions,(j+dj)*57+i+di),weight);
      const boundary=1.287+0.035*Math.sin((p.x*sign-0.68)*16)+0.025*Math.cos(p.z*18);
      const white=THREE.MathUtils.smoothstep(boundary-p.y,-0.003,0.003);
      return [255,105,18].map((value,k)=>value*(1-white)+[246,238,230][k]*white);
    },true);
    part.material.map=map;part.material.vertexColors=false;part.material.needsUpdate=true;
  }
  const weave=texture('Cotton twill tangent normal',256,256,(x,y)=>{
    const nx=0.24*Math.sin(x*Math.PI/2)*Math.cos(y*Math.PI/8),ny=0.24*Math.sin(y*Math.PI/2)*Math.cos(x*Math.PI/8);
    return [128+127*nx,128+127*ny,128+127*Math.sqrt(1-nx*nx-ny*ny)];
  });
  weave.wrapS=weave.wrapT=THREE.RepeatWrapping;weave.repeat.set(9,7);
  const weaveRoughness=texture('Independent woven roughness',256,256,(x,y)=>{const value=232+10*Math.sin(x*Math.PI/4)*Math.cos(y*Math.PI/4);return [value,value,value];});
  weaveRoughness.wrapS=weaveRoughness.wrapT=THREE.RepeatWrapping;weaveRoughness.repeat.set(9,7);
  for(const mat of [shirt,pants,navy,webbing]) {
    mat.normalMap=weave;mat.normalScale.set(0.12,0.12);mat.roughnessMap=weaveRoughness;
    mat.sheen=0.10;mat.sheenRoughness=0.85;mat.sheenColor.copy(mat.color).multiplyScalar(0.6);
    mat.needsUpdate=true;
  }
  root.userData.materialNotes='Authored solid colors and coat masks with independent normal/roughness cloth textures; no photo lighting baked into materials.';
  for(const sign of [-1,1]) {
    const side=sign<0?'r':'l',inset=root.getObjectByName(`ear-inset-${side}`),g=inset.geometry;
    const count=g.attributes.position.count,positions=Array.from(g.attributes.position.array),normals=Array.from(g.attributes.normal.array),uvs=Array.from(g.attributes.uv.array),indices=Array.from(g.index.array);
    for(let i=0;i<count;i++) {
      const n=new THREE.Vector3().fromBufferAttribute(g.attributes.normal,i).normalize();
      positions.push(g.attributes.position.getX(i)-n.x*0.005,g.attributes.position.getY(i)-n.y*0.005,g.attributes.position.getZ(i)-n.z*0.005);
      normals.push(-n.x,-n.y,-n.z);uvs.push(g.attributes.uv.getX(i),g.attributes.uv.getY(i));
    }
    for(let i=0;i<g.index.count;i+=3)indices.push(g.index.getX(i)+count,g.index.getX(i+2)+count,g.index.getX(i+1)+count);
    const border=24*97;
    for(let i=0;i<96;i++){const a=border+i,b=a+1;indices.push(a,b,b+count,a,b+count,a+count);}
    const closed=new THREE.BufferGeometry();closed.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));closed.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));closed.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));closed.setIndex(indices);
    replaceGeometry(inset,closed);
    const points=[];
    for(let i=0;i<96;i++){const a=i/96*Math.PI*2;points.push(new THREE.Vector2(0.218*signedPower(Math.sin(a),0.8),0.315*signedPower(Math.cos(a),0.8)));}
    const soleGeometry=new THREE.ExtrudeGeometry(new THREE.Shape(points),{depth:0.052,steps:1,bevelEnabled:true,bevelThickness:0.012,bevelSize:0.006,bevelSegments:3});
    soleGeometry.rotateX(-Math.PI/2).translate(sign*0.351,0.012,0.088);
    replaceGeometry(root.getObjectByName(`boot-sole-${side}`),soleGeometry);
    root.getObjectByName(`boot-toe-seam-${side}`).name=`blockout-boot-toe-seam-${side}`;
    root.getObjectByName(`boot-toe-seam-${side}-seated`).name=`boot-toe-seam-${side}`;
    root.getObjectByName(`boot-laces-${side}`).name=`blockout-boot-laces-${side}`;
    const leg=root.getObjectByName(`pant-leg-${side}-pivot`),laces=group(`boot-laces-${side}`,[0,0,0],leg);
    root.updateMatrixWorld(true);
    for(let i=0;i<3;i++)laces.attach(root.getObjectByName(`boot-laces-${side}-seated-${i}`));
  }
  root.traverse(o=>{
    if(!o.isMesh)return;
    const geometry=o.geometry,mat=o.material;
    if(!mat.vertexColors)geometry.deleteAttribute('color');
    if(!mat.map&&!mat.normalMap&&!mat.roughnessMap)geometry.deleteAttribute('uv');
    if(mat.normalMap) {
      if(!geometry.index)geometry.setIndex(Array.from({length:geometry.attributes.position.count},(_,i)=>i));
      geometry.computeTangents();
      const tangent=geometry.attributes.tangent,normal=geometry.attributes.normal;
      for(let i=0;i<tangent.count;i++) {
        const n=new THREE.Vector3().fromBufferAttribute(normal,i).normalize(),t=new THREE.Vector3().fromBufferAttribute(tangent,i);
        if(!Number.isFinite(t.lengthSq())||t.lengthSq()<0.01)t.crossVectors(Math.abs(n.x)<0.8?V([1,0,0]):V([0,1,0]),n);
        t.normalize();tangent.setXYZW(i,t.x,t.y,t.z,tangent.getW(i)<0?-1:1);
      }
    }
  });
  return root;
}
