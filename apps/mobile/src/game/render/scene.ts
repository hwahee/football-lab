/**
 * The 3D field, seen from straight above.
 *
 * Plain three.js with no React and no React Native in it: the app feeds it a
 * WebGL context from expo-gl (FieldView.tsx), and the same module renders in a
 * browser canvas, which is how it is checked without a device.
 *
 * WORLD SPACE (yards): x across the field, y up, z along it. The home team
 * defends z = +50 and attacks toward -z, which is UP on screen. Everything is
 * built from flat-colored geometry — no textures, no text — because expo-gl
 * has no canvas to rasterize them from; yard numbers are seven-segment quads.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  type WebGLRenderer,
} from 'three';

import { END_ZONE, HALF_WIDTH, type TeamId } from '../engine/types';
import { PALETTE, TEAM_COLOR, TEAM_EDGE, hexNumber } from '../palette';

export interface TokenView {
  /** Stable id (`home:QB`) — a mesh is kept per key. */
  key: string;
  team: TeamId;
  x: number;
  z: number;
  /** Linemen are drawn bigger. */
  big: boolean;
  hasBall: boolean;
  selected: boolean;
  /** Knocked down / out of the play. */
  down: boolean;
}

export type Overlay =
  | { kind: 'path'; points: readonly (readonly [number, number])[]; color: string; arrow: boolean }
  | { kind: 'circle'; x: number; z: number; radius: number; color: string };

export interface SceneFrame {
  tokens: readonly TokenView[];
  ball: { x: number; z: number; height: number } | null;
  scrimmageZ: number | null;
  firstDownZ: number | null;
  overlays: readonly Overlay[];
  /** Changes when `overlays` does — the geometry is rebuilt only then. */
  overlayKey: string;
  /** Where the camera should look (z). */
  focusZ: number;
  /** Jump the camera instead of gliding (new play, first frame). */
  snapCamera: boolean;
}

const FOV = 28;
/** Yards of width the camera always shows: the field plus a little apron. */
const VIEW_WIDTH = HALF_WIDTH * 2 + 5;
const MIN_VIEW_DEPTH = 34;
const FIELD_END = 50 + END_ZONE;

/** Which of the 7 segments (top, upper-left, upper-right, middle, lower-left, lower-right, bottom) light up. */
const SEGMENTS: Record<string, string> = {
  '0': '1110111',
  '1': '0010010',
  '2': '1011101',
  '3': '1011011',
  '4': '0111010',
  '5': '1101011',
};

class QuadBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly scratch = new Color();

  /** An axis-aligned rectangle lying on the ground. */
  rect(cx: number, cz: number, width: number, depth: number, y: number, color: string): void {
    const x0 = cx - width / 2;
    const x1 = cx + width / 2;
    const z0 = cz - depth / 2;
    const z1 = cz + depth / 2;
    this.tri(x0, z0, x0, z1, x1, z1, y, color);
    this.tri(x0, z0, x1, z1, x1, z0, y, color);
  }

  /** A line segment of the given thickness. */
  segment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    thickness: number,
    y: number,
    color: string,
  ): void {
    // prettier-ignore
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.001) return;
    const nx = ((bz - az) / length) * (thickness / 2);
    const nz = (-(bx - ax) / length) * (thickness / 2);
    this.tri(ax + nx, az + nz, ax - nx, az - nz, bx - nx, bz - nz, y, color);
    this.tri(ax + nx, az + nz, bx - nx, bz - nz, bx + nx, bz + nz, y, color);
  }

  tri(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    y: number,
    color: string,
  ): void {
    // prettier-ignore
    this.positions.push(ax, y, az, bx, y, bz, cx, y, cz);
    this.scratch.set(color);
    for (let i = 0; i < 3; i++) this.colors.push(this.scratch.r, this.scratch.g, this.scratch.b);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    return geometry;
  }
}

function drawNumber(quads: QuadBuilder, text: string, cx: number, cz: number): void {
  const height = 2.6;
  const width = 1.5;
  const stroke = 0.34;
  const gap = 0.6;
  const total = text.length * width + (text.length - 1) * gap;
  let x = cx - total / 2 + width / 2;
  for (const char of text) {
    const on = [...(SEGMENTS[char] ?? '')].map((bit) => bit === '1');
    const half = height / 2;
    const y = 0.03;
    const c = PALETTE.chalk;
    if (on[0]) quads.rect(x, cz - half, width, stroke, y, c);
    if (on[1]) quads.rect(x - width / 2, cz - half / 2, stroke, half + stroke, y, c);
    if (on[2]) quads.rect(x + width / 2, cz - half / 2, stroke, half + stroke, y, c);
    if (on[3]) quads.rect(x, cz, width, stroke, y, c);
    if (on[4]) quads.rect(x - width / 2, cz + half / 2, stroke, half + stroke, y, c);
    if (on[5]) quads.rect(x + width / 2, cz + half / 2, stroke, half + stroke, y, c);
    if (on[6]) quads.rect(x, cz + half, width, stroke, y, c);
    x += width + gap;
  }
}

function buildField(): Mesh {
  const q = new QuadBuilder();
  // Apron around the field, then the turf in 5-yard mowing stripes.
  q.rect(0, 0, 120, 200, -0.02, PALETTE.apron);
  for (let i = 0; i < 20; i++) {
    q.rect(0, -50 + i * 5 + 2.5, HALF_WIDTH * 2, 5, 0, i % 2 === 0 ? PALETTE.turfA : PALETTE.turfB);
  }
  // End zones in team colors: home defends +z, away defends -z.
  q.rect(0, 50 + END_ZONE / 2, HALF_WIDTH * 2, END_ZONE, 0, TEAM_EDGE.home);
  q.rect(0, -50 - END_ZONE / 2, HALF_WIDTH * 2, END_ZONE, 0, TEAM_EDGE.away);
  for (const side of [1, -1]) {
    const color = side === 1 ? TEAM_COLOR.home : TEAM_COLOR.away;
    for (let i = -3; i <= 3; i++) {
      q.segment(i * 6 - 2, side * (51.5 + 0), i * 6 + 2, side * (58.5 + 0), 1.1, 0.01, color);
    }
  }

  const chalk = PALETTE.chalk;
  const y = 0.02;
  // Border, goal lines, yard lines.
  q.rect(-HALF_WIDTH, 0, 0.35, FIELD_END * 2 + 0.35, y, chalk);
  q.rect(HALF_WIDTH, 0, 0.35, FIELD_END * 2 + 0.35, y, chalk);
  q.rect(0, FIELD_END, HALF_WIDTH * 2, 0.35, y, chalk);
  q.rect(0, -FIELD_END, HALF_WIDTH * 2, 0.35, y, chalk);
  for (let yard = 0; yard <= 100; yard += 5) {
    const goal = yard === 0 || yard === 100;
    q.rect(0, 50 - yard, HALF_WIDTH * 2, goal ? 0.45 : yard % 10 === 0 ? 0.2 : 0.12, y, chalk);
  }
  // Hash marks every yard.
  for (let yard = 1; yard < 100; yard++) {
    if (yard % 5 === 0) continue;
    for (const x of [-HALF_WIDTH + 0.6, -5, 5, HALF_WIDTH - 0.6]) q.rect(x, 50 - yard, 0.7, 0.1, y, chalk); // prettier-ignore
  }
  // Yard numbers, readable from the bottom of the screen.
  for (let yard = 10; yard <= 90; yard += 10) {
    const label = String(yard <= 50 ? yard : 100 - yard);
    drawNumber(q, label, -12.5, 50 - yard);
    drawNumber(q, label, 12.5, 50 - yard);
  }
  // Goal posts, seen from above: a crossbar and two uprights.
  for (const side of [1, -1]) {
    q.rect(0, side * FIELD_END, 6.2, 0.4, 0.05, PALETTE.firstDown);
    q.rect(-3.1, side * (FIELD_END + 0.5), 0.4, 1.2, 0.05, PALETTE.firstDown);
    q.rect(3.1, side * (FIELD_END + 0.5), 0.4, 1.2, 0.05, PALETTE.firstDown);
  }
  return new Mesh(q.build(), new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
}

interface Token {
  group: Group;
  ring: Mesh;
  ringMaterial: MeshBasicMaterial;
  lastX: number;
  lastZ: number;
  heading: number;
}

export class FieldScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 1, 400);

  private readonly tokens = new Map<string, Token>();
  private readonly ball = new Group();
  private readonly ballShadow: Mesh;
  private readonly scrimmage: Mesh;
  private readonly firstDown: Mesh;
  private readonly overlayMesh: Mesh;
  private overlayKey = '';
  private cameraZ = 0;
  private cameraHeight = 60;
  private aspect = 1;
  private clock = 0;

  // Shared geometry/materials: 14 tokens reuse them.
  private readonly bodyGeometry = new CylinderGeometry(0.62, 0.72, 0.9, 20);
  private readonly padsGeometry = new SphereGeometry(0.6, 16, 10);
  private readonly helmetGeometry = new SphereGeometry(0.36, 16, 12);
  private readonly shadowGeometry = new CircleGeometry(0.95, 20);
  private readonly ringGeometry = new RingGeometry(1.0, 1.28, 28);
  private readonly shadowMaterial = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }); // prettier-ignore
  private readonly teamMaterials: Record<TeamId, { body: MeshLambertMaterial; pads: MeshLambertMaterial; helmet: MeshLambertMaterial }>; // prettier-ignore

  constructor() {
    this.scene.background = new Color(PALETTE.night);
    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(12, 40, 18);
    this.scene.add(sun);
    this.scene.add(buildField());

    const material = (hex: string) => new MeshLambertMaterial({ color: hexNumber(hex) });
    this.teamMaterials = {
      home: { body: material(TEAM_COLOR.home), pads: material(TEAM_EDGE.home), helmet: material('#e9f1ff') }, // prettier-ignore
      away: { body: material(TEAM_COLOR.away), pads: material(TEAM_EDGE.away), helmet: material('#fff3c4') }, // prettier-ignore
    };

    const line = (hex: string) => {
      const mesh = new Mesh(
        new PlaneGeometry(HALF_WIDTH * 2, 0.32),
        new MeshBasicMaterial({ color: hexNumber(hex), side: DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.04;
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    };
    this.scrimmage = line(PALETTE.scrimmage);
    this.firstDown = line(PALETTE.firstDown);

    this.overlayMesh = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }), // prettier-ignore
    );
    this.scene.add(this.overlayMesh);

    const leather = new Mesh(
      new SphereGeometry(0.42, 14, 10),
      new MeshLambertMaterial({ color: hexNumber(PALETTE.ballLeather) }),
    );
    leather.scale.set(0.72, 0.72, 1.25);
    this.ball.add(leather);
    this.ball.visible = false;
    this.scene.add(this.ball);
    this.ballShadow = new Mesh(new CircleGeometry(0.4, 14), this.shadowMaterial);
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.05;
    this.ballShadow.visible = false;
    this.scene.add(this.ballShadow);

    this.camera.up.set(0, 0, -1);
    this.setViewport(1, 1);
  }

  /** Call when the drawing surface changes size. */
  setViewport(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    const tan = Math.tan((FOV * Math.PI) / 360);
    // Fit the field's width; on a wide surface, keep a minimum depth instead.
    this.cameraHeight = Math.max(VIEW_WIDTH / 2 / (tan * this.aspect), MIN_VIEW_DEPTH / 2 / tan);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.placeCamera();
  }

  /** Half the ground area the camera sees, in yards. */
  private halfExtent(): { x: number; z: number } {
    const z = this.cameraHeight * Math.tan((FOV * Math.PI) / 360);
    return { x: z * this.aspect, z };
  }

  private placeCamera(): void {
    this.camera.position.set(0, this.cameraHeight, this.cameraZ);
    this.camera.lookAt(0, 0, this.cameraZ);
  }

  /** Ground point under a view position (0…1 from the top-left corner). */
  viewToWorld(u: number, v: number): { x: number; z: number } {
    const half = this.halfExtent();
    return { x: (u * 2 - 1) * half.x, z: this.cameraZ + (v * 2 - 1) * half.z };
  }

  /** View position (0…1) of a ground point — for labels laid over the canvas. */
  worldToView(x: number, z: number): { u: number; v: number } {
    const half = this.halfExtent();
    return { u: (x / half.x + 1) / 2, v: ((z - this.cameraZ) / half.z + 1) / 2 };
  }

  private token(view: TokenView): Token {
    let token = this.tokens.get(view.key);
    if (token) return token;
    const materials = this.teamMaterials[view.team];
    const group = new Group();
    const shadow = new Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0.18, 0.03, 0.22);
    const body = new Mesh(this.bodyGeometry, materials.body);
    body.position.y = 0.45;
    const pads = new Mesh(this.padsGeometry, materials.pads);
    pads.scale.set(1.45, 0.5, 0.8);
    pads.position.y = 0.95;
    const helmet = new Mesh(this.helmetGeometry, materials.helmet);
    helmet.position.set(0, 1.35, -0.08);
    const ringMaterial = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, transparent: true, depthWrite: false }); // prettier-ignore
    const ring = new Mesh(this.ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.visible = false;
    group.add(shadow, body, pads, helmet, ring);
    this.scene.add(group);
    token = { group, ring, ringMaterial, lastX: view.x, lastZ: view.z, heading: view.team === 'home' ? 0 : Math.PI }; // prettier-ignore
    this.tokens.set(view.key, token);
    return token;
  }

  private rebuildOverlays(overlays: readonly Overlay[]): void {
    const q = new QuadBuilder();
    const y = 0.05;
    for (const overlay of overlays) {
      if (overlay.kind === 'circle') {
        // A ring, so the turf stays readable underneath.
        const steps = 40;
        for (let i = 0; i < steps; i++) {
          if (i % 2 === 1) continue;
          const a = (i / steps) * Math.PI * 2;
          const b = ((i + 1) / steps) * Math.PI * 2;
          q.segment(
            overlay.x + Math.cos(a) * overlay.radius,
            overlay.z + Math.sin(a) * overlay.radius,
            overlay.x + Math.cos(b) * overlay.radius,
            overlay.z + Math.sin(b) * overlay.radius,
            0.28,
            y,
            overlay.color,
          );
        }
        continue;
      }
      const { points } = overlay;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        q.segment(a[0], a[1], b[0], b[1], 0.3, y, overlay.color);
      }
      const tip = points[points.length - 1];
      const from = points[points.length - 2];
      if (overlay.arrow && tip && from) {
        const length = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
        const dx = (tip[0] - from[0]) / length;
        const dz = (tip[1] - from[1]) / length;
        q.tri(
          tip[0] + dx * 1.1,
          tip[1] + dz * 1.1, // prettier-ignore
          tip[0] - dz * 0.7,
          tip[1] + dx * 0.7, // prettier-ignore
          tip[0] + dz * 0.7,
          tip[1] - dx * 0.7, // prettier-ignore
          y,
          overlay.color,
        );
      }
    }
    this.overlayMesh.geometry.dispose();
    this.overlayMesh.geometry = q.build();
  }

  /** Moves everything to match `frame`. `dt` (seconds) drives camera glide and ring pulses. */
  update(frame: SceneFrame, dt: number): void {
    this.clock += dt;
    const pulse = 0.72 + 0.28 * Math.sin(this.clock * 6);

    const seen = new Set<string>();
    for (const view of frame.tokens) {
      seen.add(view.key);
      const token = this.token(view);
      const { group } = token;
      group.visible = true;
      // Face the way he is moving.
      const dx = view.x - token.lastX;
      const dz = view.z - token.lastZ;
      if (Math.hypot(dx, dz) > 0.02) {
        const target = Math.atan2(-dx, -dz);
        let diff = target - token.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        token.heading += diff * Math.min(1, dt * 12);
      }
      token.lastX = view.x;
      token.lastZ = view.z;
      group.position.set(view.x, 0, view.z);
      group.rotation.y = token.heading;
      // Drawn larger than life (a yard is ~9pt on a phone) so tokens stay readable.
      const size = view.big ? 1.45 : 1.25;
      group.scale.set(size, view.down ? 0.4 : 1, size);
      token.ring.visible = view.selected || view.hasBall;
      if (token.ring.visible) {
        token.ringMaterial.color.set(view.hasBall ? PALETTE.led : PALETTE.ink);
        token.ringMaterial.opacity = pulse;
        token.ring.scale.setScalar(view.selected ? 1.05 + 0.08 * pulse : 1);
      }
    }
    for (const [key, token] of this.tokens) {
      if (!seen.has(key)) token.group.visible = false;
    }

    if (frame.ball) {
      this.ball.visible = true;
      this.ballShadow.visible = true;
      this.ball.position.set(frame.ball.x, 1.2 + frame.ball.height, frame.ball.z);
      this.ball.rotation.y += dt * (frame.ball.height > 1.2 ? 9 : 0);
      this.ballShadow.position.set(frame.ball.x, 0.05, frame.ball.z);
    } else {
      this.ball.visible = false;
      this.ballShadow.visible = false;
    }

    this.scrimmage.visible = frame.scrimmageZ !== null;
    if (frame.scrimmageZ !== null) this.scrimmage.position.z = frame.scrimmageZ;
    this.firstDown.visible = frame.firstDownZ !== null;
    if (frame.firstDownZ !== null) this.firstDown.position.z = frame.firstDownZ;

    if (frame.overlayKey !== this.overlayKey) {
      this.overlayKey = frame.overlayKey;
      this.rebuildOverlays(frame.overlays);
    }

    // Keep the view on the field: never scroll far past an end line.
    const half = this.halfExtent();
    const limit = Math.max(0, FIELD_END + 3 - half.z);
    const focus = Math.max(-limit, Math.min(limit, frame.focusZ));
    this.cameraZ = frame.snapCamera ? focus : this.cameraZ + (focus - this.cameraZ) * Math.min(1, dt * 4); // prettier-ignore
    this.placeCamera();
  }

  render(renderer: WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}
