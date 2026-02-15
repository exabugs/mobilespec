// tests/helpers/mkTemp.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function mkTempDir(prefix = "mobilespec-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
