import { NodeIO } from '@gltf-transform/core';
import { readdirSync, statSync } from 'node:fs';

const io = new NodeIO();
for (const f of readdirSync('models').filter(n => n.endsWith('.glb'))) {
  const p = `models/${f}`;
  try {
    const root = (await io.read(p)).getRoot();
    console.log(f, {
      kb: Math.round(statSync(p).size / 1024),
      meshes: root.listMeshes().length,
      skins: root.listSkins().length,
      clips: root.listAnimations().map(a => a.getName()),
    });
  } catch (e) { console.log(f, 'UNREADABLE:', e.message); }
}
