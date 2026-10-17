import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const supportedTargets = new Set(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64']);

export function validateRelease({ packageVersion, cargoVersion, extensionVersion, target, expectedTarget, refType, refName }) {
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) throw new Error('Release version must be stable MAJOR.MINOR.PATCH');
  if (packageVersion !== cargoVersion || packageVersion !== extensionVersion) throw new Error('Package, Cargo and extension versions must match');
  if (!supportedTargets.has(target)) throw new Error(`Unsupported release platform: ${target}`);
  if (expectedTarget && expectedTarget !== target) throw new Error(`Native platform ${target} does not match expected target ${expectedTarget}`);
  const tag = `v${packageVersion}`;
  if (refType === 'tag' && refName !== tag) throw new Error(`Tag must be ${tag}`);
  return tag;
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const tomlVersion = async file => {
    const text = await readFile(path.join(root, file), 'utf8');
    const version = /^version\s*=\s*"([^"]+)"\s*$/m.exec(text)?.[1];
    if (!version) throw new Error(`Cannot read version from ${file}`);
    return version;
  };
  const tag = validateRelease({
    packageVersion: metadata.version, cargoVersion: await tomlVersion('Cargo.toml'), extensionVersion: await tomlVersion('extension.toml'),
    target: `${process.platform}-${process.arch}`, expectedTarget: process.env.EXPECTED_TARGET,
    refType: process.env.REF_TYPE, refName: process.env.REF_NAME,
  });
  if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error('The linux release targets require glibc; musl is not supported');
  }
  console.log(`Release metadata verified: ${tag}, ${process.platform}-${process.arch}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
