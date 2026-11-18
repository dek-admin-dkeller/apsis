/** The selected object's full orbit, drawn as a glowing line that fades behind the satellite. */

import * as THREE from 'three';
import { json2satrec, sgp4, type OMMJsonObject, type SatRec } from 'satellite.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Satellite } from '../data/types.ts';
import { minutesSinceEpoch } from '../worker/propagate.ts';

const SEGMENTS = 360;

export class OrbitLine {
  /** Display setting: draw the path or not. */
  enabled = true;
  private readonly line: Line2;
  private satrec: SatRec | null = null;
  private periodMin = 0;
  private lastBuild = -Infinity;

  constructor(parent: THREE.Object3D) {
    const material = new LineMaterial({
      linewidth: 1.5, // pixels
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.line = new Line2(new LineGeometry(), material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.renderOrder = 1;
    parent.add(this.line);
  }

  setSatellite(sat: Satellite | null): void {
    this.satrec = sat ? json2satrec(sat.omm as unknown as OMMJsonObject) : null;
    this.periodMin = sat ? sat.periodMin : 0;
    this.line.visible = false;
    this.lastBuild = -Infinity;
  }

  /** SGP4 for the selected object only (exact position + velocity for the info panel). */
  stateAt(timeMs: number) {
    return this.satrec ? sgp4(this.satrec, minutesSinceEpoch(this.satrec, timeMs)) : null;
  }

  /** Rebuild the path (one full revolution starting at the satellite) every ~1.5 s of real time. */
  update(simTime: number, realSeconds: number): void {
    if (!this.enabled) {
      this.line.visible = false;
      this.lastBuild = -Infinity; // rebuild straight away when switched back on
      return;
    }
    if (!this.satrec || realSeconds - this.lastBuild < 1.5) return;
    this.lastBuild = realSeconds;
    const positions: number[] = [];
    const colors: number[] = [];
    const start = minutesSinceEpoch(this.satrec, simTime);
    for (let s = 0; s <= SEGMENTS; s++) {
      const p = sgp4(this.satrec, start + (this.periodMin * s) / SEGMENTS)?.position;
      if (!p || !Number.isFinite(p.x + p.y + p.z)) continue;
      positions.push(p.x, p.y, p.z);
      const fade = 1.05 * Math.pow(1 - s / SEGMENTS, 1.6) + 0.12; // bright ahead of the satellite, dim at the far end
      colors.push(0.35 * fade, 0.85 * fade, 1.0 * fade);
    }
    if (positions.length < 6) {
      this.line.visible = false;
      return;
    }
    this.line.geometry.dispose();
    this.line.geometry = new LineGeometry();
    this.line.geometry.setPositions(positions);
    this.line.geometry.setColors(colors);
    this.line.visible = true;
  }
}
