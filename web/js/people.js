// Residents: one small figure with legs, arms, hair and shoes. Their walk happens in the vertex
// shader, so hundreds of people cost a single draw call and almost no CPU.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const peopleTime = { value: 0 };
const TOPS = ['#d97757', '#5b6170', '#9bb58e', '#e8b45a', '#8fb4d9', '#c4694a', '#f0e9dc', '#b08ad8', '#e8a0a8', '#5f8f8a', '#3f4a66'];
const LEGS = ['#3f4654', '#2f3440', '#5c5148', '#6d7482', '#8a7a64', '#39505e'];
const SKIN = ['#f3d3bb', '#e8c4a8', '#d8a98a', '#b98563', '#8d5f43', '#6a4633'];
const HAIR = ['#2f2723', '#4b3a32', '#7a5536', '#b58a55', '#d9c49a', '#8d8d8d', '#a4492f'];

function tag(geo, part, pivot = 0, sign = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv');
  const n = g.attributes.position.count, p = new Float32Array(n), s = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[i] = part; s[i * 3] = pivot; s[i * 3 + 1] = sign; }
  g.setAttribute('aPart', new THREE.BufferAttribute(p, 1)); g.setAttribute('aSwing', new THREE.BufferAttribute(s, 3));
  return g;
}
const capsule = (r, len, x, y, z, rx = 0) => { const g = new THREE.CapsuleGeometry(r, len, 2, 7); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };

// parts: 0 top, 1 trousers, 2 skin, 3 hair, 4 shoes
export function personGeometry(seated = false) {
  const list = [
    tag(capsule(0.031, 0.05, 0, 0.119, 0), 0),
    tag(new THREE.SphereGeometry(0.031, 16, 12).translate(0, 0.19, 0), 2),
    tag(new THREE.SphereGeometry(0.0328, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.56).rotateX(-0.3).translate(0, 0.19, 0), 3),
  ];
  for (const sd of [-1, 1]) {
    if (seated) {
      list.push(tag(capsule(0.0115, 0.05, sd * 0.016, 0.086, 0.034, Math.PI / 2), 1), tag(capsule(0.0105, 0.105, sd * 0.016, 0.03, 0.066), 1), tag(new THREE.BoxGeometry(0.022, 0.012, 0.036).translate(sd * 0.016, -0.034, 0.074), 4));
      list.push(tag(capsule(0.0088, 0.04, sd * 0.04, 0.122, 0.012, -0.35), 0), tag(new THREE.SphereGeometry(0.0095, 7, 5).translate(sd * 0.038, 0.092, 0.026), 2));
    } else {
      list.push(tag(capsule(0.0115, 0.056, sd * 0.016, 0.055, 0), 1, 0.088, sd), tag(new THREE.BoxGeometry(0.022, 0.012, 0.036).translate(sd * 0.016, 0.006, 0.006), 4, 0.088, sd));
      list.push(tag(capsule(0.0088, 0.044, sd * 0.04, 0.123, 0), 0, 0.152, -sd * 0.8), tag(new THREE.SphereGeometry(0.0095, 7, 5).translate(sd * 0.04, 0.09, 0), 2, 0.152, -sd * 0.8));
    }
  }
  const g = mergeGeometries(list, false);
  if (seated) g.translate(0, -0.055, 0);
  return g;
}

export function paintPeople(geo, count) {
  const make = (size) => new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
  const top = make(3), legs = make(3), skin = make(3), hair = make(3), phase = make(1), move = make(1), c = new THREE.Color();
  const pick = (attr, list, k, salt) => { c.set(list[Math.abs((k * 2654435761 + salt * 40503) >>> 7) % list.length]); attr.setXYZ(k, c.r, c.g, c.b); };
  for (let k = 0; k < count; k++) { pick(top, TOPS, k, 1); pick(legs, LEGS, k, 2); pick(skin, SKIN, k, 3); pick(hair, HAIR, k, 4); phase.setX(k, k * 2.399); }
  move.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTop', top); geo.setAttribute('aLegs', legs); geo.setAttribute('aSkin', skin); geo.setAttribute('aHair', hair); geo.setAttribute('aPhase', phase); geo.setAttribute('aMove', move);
  return move;
}

export function personMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.78 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPT = peopleTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float aPart; attribute vec3 aSwing; attribute vec3 aTop; attribute vec3 aLegs; attribute vec3 aSkin; attribute vec3 aHair; attribute float aPhase; attribute float aMove;
      uniform float uPT; varying vec3 vPC;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      if (aSwing.y != 0.0 && aMove > 0.001) {
        float sw = sin(uPT * 9.5 + aPhase) * 0.62 * aMove * aSwing.y, cs = cos(sw), sn = sin(sw), qy = transformed.y - aSwing.x, qz = transformed.z;
        transformed.y = aSwing.x + qy * cs - qz * sn; transformed.z = qy * sn + qz * cs;
      }
      vPC = aPart < 0.5 ? aTop : aPart < 1.5 ? aLegs : aPart < 2.5 ? aSkin : aPart < 3.5 ? aHair : vec3(0.82, 0.78, 0.7);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPC;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPC;');
  };
  return m;
}
