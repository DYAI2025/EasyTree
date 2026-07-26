/** Schreibt `openapi/v1.json`. Aufruf: `pnpm --filter @easytree/contracts run openapi:write`. */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serializeOpenApiDocument } from "./document.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../../openapi/v1.json");
writeFileSync(target, serializeOpenApiDocument(), "utf8");
process.stdout.write(`openapi geschrieben: ${target}\n`);
