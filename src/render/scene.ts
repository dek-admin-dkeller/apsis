/**
 * Renderer, camera, controls and bloom post-processing, plus the quality presets that
 * keep the frame rate smooth on a laptop.
 *
 * Scene units: 1 unit = 1,000 km, +Y = north pole. Everything expressed in the
 * Earth-centred inertial frame (satellites, orbit lines, the hash grid) lives inside
 * `eciGroup`, which converts ECI kilometres (z = north) into scene units.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export const KM = 0.001; // kilometres → scene units
export const EARTH_RADIUS_KM = 6371;
export const EARTH_RADIUS = EARTH_RADIUS_KM * KM;

/**
 * The expensive part of a frame is the number of pixels shaded: a Retina screen at full
 * resolution with 4× anti-aliasing is ~4× the work of "balanced" for little visible gain.
 */
export type Quality = 'high' | 'balanced' | 'fast';
const QUALITY: Record<Quality, { maxPixelRatio: number; samples: number }> = {
  high: { maxPixelRatio: 2, samples: 4 },
  balanced: { maxPixelRatio: 1.5, samples: 2 },
  fast: { maxPixelRatio: 1, samples: 0 },
};

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  eciGroup: THREE.Group;
  /** Current device-pixel ratio in use (changes with the quality preset). */
  pixelRatio: number;
  quality: Quality;
  setQuality(quality: Quality): void;
  setBloom(strength: number): void;
  render(): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneKit {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x02040a);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 6000);
  camera.position.set(0, 120, 380);

  // ECI (x, y, z-north) km → scene (x, z, −y) units: rotate −90° about X, scale by KM.
  const eciGroup = new THREE.Group();
  eciGroup.rotation.x = -Math.PI / 2;
  eciGroup.scale.setScalar(KM);
  eciGroup.updateMatrixWorld(true);
  scene.add(eciGroup);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.zoomToCursor = false;
  controls.minDistance = EARTH_RADIUS * 1.12;
  controls.maxDistance = 420;

  // Post-processing: render (MSAA, HDR) → bloom → tone/colour output.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Safety net. The bloom pass blurs the picture at many sizes, so ONE invalid pixel (a NaN
  // from some shader on some graphics driver) would spread until the whole screen is black.
  // This pass replaces any non-finite or absurd pixel with black before bloom ever sees it:
  // the worst case becomes a single dark dot instead of a blank screen.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        // every comparison with NaN is false, so a NaN fails this test; so does infinity
        bool sane = c.r > -1.0 && c.g > -1.0 && c.b > -1.0 && c.r < 1.0e4 && c.g < 1.0e4 && c.b < 1.0e4;
        gl_FragColor = sane ? vec4(max(c.rgb, 0.0), 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
      }`,
  }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const kit: SceneKit = {
    renderer, scene, camera, controls, eciGroup,
    pixelRatio: 1,
    quality: 'balanced',

    setQuality(quality) {
      const config = QUALITY[quality];
      kit.quality = quality;
      kit.pixelRatio = Math.min(window.devicePixelRatio, config.maxPixelRatio);
      renderer.setPixelRatio(kit.pixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      // Rebuild the off-screen buffers at the new resolution / anti-aliasing level.
      composer.reset(new THREE.WebGLRenderTarget(window.innerWidth * kit.pixelRatio, window.innerHeight * kit.pixelRatio, {
        type: THREE.HalfFloatType,
        samples: config.samples,
      }));
      composer.setPixelRatio(kit.pixelRatio);
      composer.setSize(window.innerWidth, window.innerHeight);
    },

    setBloom(strength) {
      bloom.strength = strength;
      bloom.enabled = strength > 0.01;
    },

    render() {
      // Keep the near plane proportional to the zoom level so depth precision stays good
      // both for the whole-Earth view and when the camera sits 50 km from a satellite.
      const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.02, 0.000004, 0.5);
      if (Math.abs(near - camera.near) > near * 0.05) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      composer.render();
    },
  };
  kit.setQuality('balanced');

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  return kit;
}
