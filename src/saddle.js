/**
 * saddle.js — the saddle, girth and stirrups: the last of the tack the horse
 * model never shipped.
 *
 * reins.js closed the gap between the rider's fists and the horse's mouth.
 * This closes the one under them: before it, the rider sat directly on the
 * animal's back and their boots hung in the air exactly where stirrups would
 * be, holding nothing.
 *
 * WHERE IT SITS. The seat rides the same point the rider does — horse.js's
 * saddle offset plus the live gait bob it samples off the horse's spine bone —
 * so the saddle stays under the rider through every stride instead of the two
 * drifting apart. It also shares the horse's bank through turns.
 *
 * WHERE THE STIRRUPS GO. Mounted, the iron is placed at the rider's own foot
 * bone, so the boot is in the stirrup rather than near it, and the leather
 * stretches to wherever the seated pose put the leg. Unmounted they hang
 * straight down at rest length. This is the same trick reins.js uses for the
 * hands, and the reason both look attached rather than approximately placed.
 */

import * as THREE from 'three';
import { HORSE, TACK } from './config-horse.js';
import { StrapMesh } from './strap.js';

const _seat = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Girth ring, two stirrup leathers. The seat itself is solid geometry, not a strap. */
const STRAPS = ['girth', 'leatherL', 'leatherR'];

export class Saddle {
  /**
   * @param {THREE.Scene} scene
   * @param {object} horse the Horse — read for position, yaw, lean and saddleBob
   * @param {{root: THREE.Object3D}} playerCharacter for the rider's foot bones
   */
  constructor(scene, horse, playerCharacter) {
    this.horse = horse;
    this.playerRoot = playerCharacter?.root ?? null;
    this.footL = this.playerRoot?.getObjectByName('FootL') ?? null;
    this.footR = this.playerRoot?.getObjectByName('FootR') ?? null;

    const leather = new THREE.MeshStandardMaterial({ color: TACK.saddleColor, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: TACK.ironColor, roughness: 0.5, metalness: 0.75 });

    // One group carried as a unit, so the whole saddle is placed with a single
    // position/quaternion write per frame rather than part by part.
    this.group = new THREE.Group();
    this.group.name = 'saddle';
    scene.add(this.group);

    const s = TACK.seat;
    // Seat, skirts and the two rises fore and aft. Merged into one geometry:
    // this is a handful of boxes and there is no reason to spend five draw
    // calls on it — see rig-merge.js for the same reasoning applied to bodies.
    const parts = [
      boxAt(s.length, s.thickness, s.width, 0, 0, 0),
      boxAt(s.pommel, s.riseHeight, s.width * 0.72, s.length * 0.42, s.riseHeight * 0.5, 0),
      boxAt(s.cantle, s.riseHeight * 1.25, s.width * 0.86, -s.length * 0.42, s.riseHeight * 0.6, 0),
      boxAt(s.skirt, s.thickness * 0.7, s.skirtWidth, 0, -s.thickness * 0.6, 0),
    ];
    this.seat = new THREE.Mesh(mergeBoxes(parts), leather);
    this.seat.castShadow = true;
    this.seat.receiveShadow = true;
    this.group.add(this.seat);

    this.irons = ['L', 'R'].map(() => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(TACK.stirrupRadius, TACK.stirrupThickness, 6, 10), iron);
      mesh.castShadow = false;
      scene.add(mesh);
      return mesh;
    });

    this.straps = new StrapMesh(scene, STRAPS, { color: TACK.color, name: 'saddleStraps' });
  }

  /**
   * @param {boolean} mounted whether the player is riding — decides whether the
   *   stirrups are carrying a boot or hanging free.
   */
  update(mounted) {
    const horse = this.horse;
    if (!horse) return;

    // The seat point, bob and all — the same one the rider is placed on, so the
    // two cannot drift apart. `saddleBob` is 0 on a horse with no skeleton.
    const yaw = horse.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    _fwd.set(-sin, 0, -cos); // the horse's own facing; yaw 0 looks down -Z
    _side.set(cos, 0, -sin);
    _seat.set(
      horse.position.x + _fwd.x * HORSE.saddleOffset.z + _side.x * HORSE.saddleOffset.x,
      horse.position.y + HORSE.saddleOffset.y + (horse.saddleBob ?? 0) + TACK.seat.drop,
      horse.position.z + _fwd.z * HORSE.saddleOffset.z + _side.z * HORSE.saddleOffset.x,
    );

    this.group.position.copy(_seat);
    // Yaw to face along the horse, then share its bank through turns — the same
    // lean the rider takes, so saddle and rider roll together.
    this.group.rotation.set(0, yaw + Math.PI / 2, horse.lean ?? 0, 'YXZ');

    if (this.playerRoot && mounted) this.playerRoot.updateMatrixWorld(true);

    // Girth: a ring around the barrel, just behind the elbow.
    const girthY = _seat.y - TACK.girthDrop;
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.straps.curve[i].set(
        _seat.x + _side.x * Math.sin(a) * TACK.girthHalfWidth,
        girthY + Math.cos(a) * TACK.girthHalfHeight,
        _seat.z + _side.z * Math.sin(a) * TACK.girthHalfWidth,
      );
    }
    this.straps.write('girth', TACK.strapRadius);

    // Stirrups: leather from the saddle's side down to the iron, and the iron
    // wherever the rider's boot actually is.
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? 1 : -1;
      const i = side === 'L' ? 0 : 1;
      _a.set(
        _seat.x + _side.x * TACK.stirrupHang * sign,
        _seat.y - TACK.seat.thickness,
        _seat.z + _side.z * TACK.stirrupHang * sign,
      );
      const foot = side === 'L' ? this.footL : this.footR;
      if (mounted && foot) {
        foot.getWorldPosition(_b);
        _b.y += TACK.stirrupUnderBoot; // the iron sits under the sole, not through it
      } else {
        _b.set(_a.x, _seat.y - TACK.stirrupRestDrop, _a.z);
      }
      this.straps.sag(_a, _b, 0.02);
      this.straps.write(side === 'L' ? 'leatherL' : 'leatherR', TACK.strapRadius);

      const iron = this.irons[i];
      iron.position.copy(_b);
      // Lying flat-ish under the boot, turned to face along the horse.
      iron.rotation.set(Math.PI / 2, 0, yaw, 'YXZ');
    }

    this.straps.flush();
  }
}

/** A box translated into place, ready to be merged with its siblings. */
function boxAt(length, height, width, x, y, z) {
  const geo = new THREE.BoxGeometry(length, height, width);
  geo.translate(x, y, z);
  return geo;
}

/** Concatenates box geometries without pulling in the merge util for four boxes. */
function mergeBoxes(geometries) {
  const merged = new THREE.BufferGeometry();
  let verts = 0;
  let indices = 0;
  for (const g of geometries) {
    verts += g.attributes.position.count;
    indices += g.index ? g.index.count : 0;
  }
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const index = new Uint16Array(indices);
  let vo = 0;
  let io = 0;
  for (const g of geometries) {
    position.set(g.attributes.position.array, vo * 3);
    normal.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) index[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  }
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}
