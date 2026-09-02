// Los tests no tocan tu ~/.claude real.
// Ojo: os.homedir() en Bun NO respeta $HOME, asi que aislar por HOME no vale.
// El aislamiento va por SPOCHIE_HOME, que es lo que lee src/paths.ts.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.SPOCHIE_HOME = mkdtempSync(join(tmpdir(), "spochie-test-"));
