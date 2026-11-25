// A full-screen veil in the page's sky colour, drawn over a 3-D scene but under its blue dot.
// The street fades into it and the planet comes out of it, so the two scenes can swap unseen
// while both keep zooming out.
import * as THREE from 'three';

export function makeVeil(order) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { a: { value: 0 } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // #eef2f7 written as is (no tone mapping), so both canvases show exactly the same colour
    fragmentShader: 'uniform float a; void main(){ gl_FragColor = vec4(0.9333, 0.9490, 0.9686, a); }',
    transparent: true, depthTest: false, depthWrite: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.visible = false;
  return {
    mesh,
    set(a) { mesh.material.uniforms.a.value = a; mesh.visible = a > 0.002; },
  };
}
