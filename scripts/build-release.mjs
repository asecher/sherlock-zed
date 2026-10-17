import { mkdir, readdir, lstat, rm, writeFile, readFile, mkdtemp, cp, copyFile, access } from 'node:fs/promises';
import { join, basename, dirname, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export async function buildRelease({ root = fileURLToPath(new URL('../', import.meta.url)), output = join(root, 'release'), os = process.platform, arch = process.arch } = {}) {
  if (os !== process.platform || arch !== process.arch) throw new Error('Native release target must match the build host');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Release builds require Node 24');
  if (!isAbsolute(output)) throw new Error('--output must be absolute');
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source.version)) throw new Error('Invalid release version');
  for (const name of ['Cargo.toml', 'extension.toml']) {
    const text = await readFile(join(root, name), 'utf8');
    if (/^version\s*=\s*"([^"]+)"/m.exec(text)?.[1] !== source.version) throw new Error(`${name} version differs from package.json`);
  }
  await access(join(root, 'server/dist/main.js')); // Caller runs npm run build first.
  const scratch = join(homedir(), '.hermes/cache/scratch');
  await mkdir(scratch, { recursive: true });
  const stage = await mkdtemp(join(scratch, 'sherlock-package-'));
  try {
    await copyFile(join(root, 'package.json'), join(stage, 'package.json'));
    await copyFile(join(root, 'package-lock.json'), join(stage, 'package-lock.json'));
    const npmArgs = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
    // .cmd files cannot be executed directly by execFile on Windows.
    const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (process.platform === 'win32') execFileSync(process.execPath, [npmCli, ...npmArgs], { cwd: stage, stdio: 'inherit' });
    else execFileSync('npm', npmArgs, { cwd: stage, stdio: 'inherit' });
    await mkdir(join(stage, 'node_modules'), { recursive: true });
    await mkdir(join(stage, 'server'), { recursive: true });
    await cp(join(root, 'server/dist'), join(stage, 'server/dist'), { recursive: true, dereference: false });
    const runtime = { name: 'sherlock-language-server', version: source.version, private: true, type: 'module', engines: { node: '>=24.0.0' }, dependencies: source.dependencies ?? {} };
    await writeFile(join(stage, 'package.json'), JSON.stringify(runtime, null, 2) + '\n');
    // This artifact is already installed, not a source installation project.
    // Omitting the source lock avoids a misleading renamed root package entry.
    await rm(join(stage, 'package-lock.json'));
    return await packageRelease({ stage, output, version: source.version });
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: node scripts/build-release.mjs [--output ABSOLUTE_DIRECTORY]');
  const result = await buildRelease(args.length ? { output: args[1] } : {});
  console.log(JSON.stringify(result, null, 2));
}

export async function packageRelease({ stage, output, version }) {
  // npm's executable shims are unnecessary: Zed invokes Node directly.
  await rm(join(stage, 'node_modules/.bin'), { recursive: true, force: true });
  await writeFile(join(stage, 'release.json'), JSON.stringify({ format: 1, name: 'sherlock-language-server', version, os: process.platform, arch: process.arch, nodeMajor: 24, entrypoint: 'server/dist/main.js' }, null, 2) + '\n');
  async function validate(directory) {
    for (const name of await readdir(directory)) {
      const file = join(directory, name);
      const stat = await lstat(file);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new Error(`Release contains a link: ${file}`);
      if (stat.isDirectory()) await validate(file);
      else if (!stat.isFile()) throw new Error(`Release contains a special file: ${file}`);
    }
  }
  await validate(stage);
  await mkdir(output, { recursive: true });
  const archive = join(output, `sherlock-language-server-v${version}-${process.platform}-${process.arch}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', stage, ...(await readdir(stage)).sort()], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(archive + '.sha256', `${sha256}  ${basename(archive)}\n`);
  return { archive, sha256 };
}
