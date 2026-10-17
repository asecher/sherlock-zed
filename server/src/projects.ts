import path from 'node:path';
import { access, readdir, realpath } from 'node:fs/promises';

export function within(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export async function projectForFile(file: string, roots: readonly string[]): Promise<string | undefined> {
  let canonical: string;
  try { canonical = await realpath(file); }
  catch { try { canonical = path.join(await realpath(path.dirname(file)), path.basename(file)); } catch { return; } }
  const permitted: string[] = [];
  for (const root of roots) {
    try { const resolved = await realpath(root); if (within(canonical, resolved)) permitted.push(resolved); } catch { /* missing root */ }
  }
  const root = permitted.sort((a, b) => b.length - a.length)[0];
  if (!root) return;
  let directory = path.dirname(canonical);
  while (within(directory, root)) {
    const project = path.join(directory, 'project.inlang');
    if (await exists(path.join(project, 'settings.json'))) {
      if (!within(await realpath(project), directory)) throw new Error('Project configuration escapes its directory');
      return project;
    }
    if (directory === root) break;
    directory = path.dirname(directory);
  }
}

const skipped = new Set(['.git', '.hg', '.svn', 'node_modules', 'target', 'dist', 'build', 'coverage', 'paraglide', '.paraglide', '.svelte-kit', '.next']);
export async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (skipped.has(entry.name) || entry.name.endsWith('.inlang')) continue;
        if (await exists(path.join(file, 'project.inlang/settings.json'))) continue;
        await walk(file);
      } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
        files.push(file);
        if (files.length > 2000) throw new Error('Rename is limited to 2000 source files');
      }
    }
  }
  await walk(root);
  return files.sort();
}
