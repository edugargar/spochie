// Los tests no tocan tu ~/.claude real.
// Ojo: os.homedir() en Bun NO respeta $HOME, asi que aislar por HOME no vale.
// El aislamiento va por SPOOCHIE_HOME, que es lo que lee src/paths.ts.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.SPOOCHIE_HOME = mkdtempSync(join(tmpdir(), "spoochie-test-"));
// Y no abren dialogos de macOS: el aviso va a la terminal salvo que un test diga otra cosa.
process.env.SPOOCHIE_AVISO ??= "terminal";
