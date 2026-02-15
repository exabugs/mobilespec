// tests/helpers/mkSpec.ts
import fs from 'node:fs';
import path from 'node:path';

function mkdirp(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export function writeFile(p: string, content: string) {
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, content.trimStart(), 'utf-8');
}

export function mkSpecDir(root: string) {
  const l2 = path.join(root, 'L2.screenflows');
  const l3 = path.join(root, 'L3.ui');
  const l4 = path.join(root, 'L4.state');

  mkdirp(l2);
  mkdirp(l3);
  mkdirp(l4);

  return { l2, l3, l4 };
}
