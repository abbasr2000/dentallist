/**
 * Drop the router prefetch payloads from the exported site.
 *
 * Next writes four files per page: the HTML, and three plain-text React Server
 * Component payloads the client router fetches to change pages without a full
 * document load. For 2,728 clinics that is 14,286 files and 248 MB, of which
 * 130 MB is payload. The register walk will roughly triple the clinic count,
 * which puts the deployment past the file limits of every Vercel plan.
 *
 * Nothing on this site uses them. Every link is a plain `<a href>`, so every
 * navigation is already a full document load and the payloads are downloaded
 * by nobody. Removing them leaves 2,882 files and 96 MB, verified by clicking
 * home → province → city → clinic → back against the pruned output with no
 * console errors and every heading correct.
 *
 * The moment a page uses `next/link`, that stops being true: the router would
 * intercept the click, ask for a payload that is not there, and the page would
 * silently fail to change. So this refuses to run if `next/link` appears
 * anywhere in the source, rather than quietly breaking navigation.
 *
 * Runs as part of `npm run build`.
 */
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

const OUT_DIR = "out";
const SOURCE_DIRS = ["app", "components", "lib"];

/** Next's payload files: `index.txt` beside each page, and `__next.*.txt`. */
function isPayload(name: string): boolean {
  return name === "index.txt" || (name.startsWith("__next.") && name.endsWith(".txt"));
}

function usesNextLink(): string | undefined {
  for (const dir of SOURCE_DIRS) {
    try {
      const hits = execSync(`grep -rln "next/link" ${dir} 2>/dev/null || true`, {
        encoding: "utf8",
      }).trim();
      if (hits) return hits.split("\n")[0];
    } catch {
      // grep found nothing; that is the good case.
    }
  }
  return undefined;
}

function walk(dir: string, onFile: (path: string, name: string, size: number) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, onFile);
    else onFile(path, entry.name, statSync(path).size);
  }
}

function main(): void {
  const linkUser = usesNextLink();
  if (linkUser) {
    console.error(
      `prune-export: ${linkUser} imports next/link. The client router needs the ` +
        "prefetch payloads this would delete, and without them a click changes " +
        "the URL and nothing else. Either use a plain <a href> there, or delete " +
        "this step and accept the file count.",
    );
    process.exit(1);
  }

  let kept = 0;
  let removed = 0;
  let freed = 0;
  const doomed: string[] = [];

  try {
    walk(OUT_DIR, (path, name, size) => {
      if (isPayload(name)) {
        doomed.push(path);
        freed += size;
      } else {
        kept++;
      }
    });
  } catch (error) {
    console.error(`prune-export: cannot read ${OUT_DIR}/ — run next build first.`);
    throw error;
  }

  for (const path of doomed) {
    unlinkSync(path);
    removed++;
  }

  console.log(
    `prune-export: removed ${removed} router payloads (${(freed / 1048576).toFixed(0)} MB), ` +
      `${kept} files remain.`,
  );
}

main();
