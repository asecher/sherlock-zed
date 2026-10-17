import fs from 'node:fs/promises';
import path from 'node:path';
import { createFsFromVolume, Volume } from 'memfs';
import { loadProjectFromDirectory } from '@inlang/sdk';
import messageFormat45 from '@inlang/plugin-message-format';
// @ts-expect-error The pinned 4.4.0 npm alias ships no declarations; its plugin contract matches 4.5.0.
import messageFormat44 from 'message-format-4-4';

export interface SdkProject {
  projectPath: string;
  rootPath: string;
  baseLocale: string;
  sourcePath: string;
  sourceText: string;
  keys: ReadonlySet<string>;
  preview(key: string): Promise<string | undefined>;
  planInsert(key: string, text: string): Promise<{ path: string; before: string; after: string }[]>;
  planRename(oldKey: string, newKey: string): Promise<{ path: string; before: string; after: string }[]>;
  close(): Promise<void>;
}

/**
 * Opens only allowlisted settings/catalog snapshots in a fresh memfs volume.
 * The SDK never receives the host filesystem, caches, local modules or .env files.
 * Plans are relative to the opening snapshot; open one instance per LSP request.
 */
export async function openSdkProject(projectPath: string, overlays: ReadonlyMap<string, string> = new Map()): Promise<SdkProject> {
  projectPath = path.resolve(projectPath);
  const rootPath = path.dirname(projectPath);
  async function checkPath(target: string) {
    const relative = path.relative(rootPath, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe path escapes project root');
    let current = rootPath;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Unsafe symlink: ${current}`);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  await checkPath(path.join(projectPath, 'settings.json'));
  const settings = JSON.parse(await fs.readFile(path.join(projectPath, 'settings.json'), 'utf8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Unsupported project settings');
  const allowedFields = new Set(['$schema', 'baseLocale', 'locales', 'modules', 'plugin.inlang.messageFormat']);
  if (Object.keys(settings).some(key => !allowedFields.has(key))) throw new Error('Unsupported plugin or project setting');
  if (!Array.isArray(settings.locales) || !settings.locales.length || settings.locales.some((locale: unknown) => typeof locale !== 'string' || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(locale)) || new Set(settings.locales).size !== settings.locales.length || !settings.locales.includes(settings.baseLocale)) throw new Error('Unsafe or unsupported locales');
  const format = settings['plugin.inlang.messageFormat'];
  const pattern = format?.pathPattern;
  if (!format || Object.keys(format).some(key => key !== 'pathPattern') || typeof pattern !== 'string' || !/^\.\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*\{locale\}[A-Za-z0-9_-]*\.json$/.test(pattern)) throw new Error('Unsafe or unsupported message pathPattern');
  const modules = settings.modules;
  const official = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@inlang\/plugin-message-format@(4\.4\.0|4\.5\.0)\/dist\/index\.js$/;
  const matcher = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@inlang\/plugin-m-function-matcher@(latest|2\.3\.0)\/dist\/index\.js$/;
  if (!Array.isArray(modules) || modules.some((module: unknown) => typeof module !== 'string' || (!official.test(module) && !matcher.test(module))) || modules.filter((module: string) => official.test(module)).length !== 1 || modules.filter((module: string) => matcher.test(module)).length > 1) throw new Error('Unsupported or untrusted plugin module');
  const sandbox = createFsFromVolume(new Volume());
  sandbox.mkdirSync(projectPath, { recursive: true });
  sandbox.writeFileSync(path.join(projectPath, 'settings.json'), JSON.stringify({ ...settings, modules: [] }));
  const texts = new Map<string, string>();
  for (const locale of settings.locales) {
    const target = path.resolve(rootPath, settings['plugin.inlang.messageFormat'].pathPattern.replace('{locale}', locale));
    await checkPath(target);
    let text = overlays.get(target);
    if (text === undefined) {
      try { text = await fs.readFile(target, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    if (text !== undefined) {
      texts.set(target, text);
      sandbox.mkdirSync(path.dirname(target), { recursive: true }); sandbox.writeFileSync(target, text);
    }
  }
  const plugin = modules.some((module: string) => module === 'https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4.4.0/dist/index.js') ? messageFormat44 : messageFormat45;
  const project = await loadProjectFromDirectory({ path: projectPath, fs: sandbox as unknown as typeof import('node:fs'), providePlugins: [plugin] });
  const keys = new Set((await project.db.selectFrom('inlang_bundle').select('id').execute()).map(row => row.id));
  const sourcePath = path.resolve(rootPath, settings['plugin.inlang.messageFormat'].pathPattern.replace('{locale}', settings.baseLocale));
  function validateKey(key: string) {
    if (typeof key !== 'string' || !key.length || /[\u0000-\u001f\u007f]/.test(key) || key.split('.').some(segment => !segment || ['$schema', '__proto__', 'constructor', 'prototype'].includes(segment))) throw new Error('Unsafe or reserved message key');
  }
  function checkCollision(key: string, oldKey?: string) {
    for (const existing of keys) {
      if (existing !== oldKey && (existing === key || existing.startsWith(key + '.') || key.startsWith(existing + '.'))) throw new Error(`Key already exists or namespace collision: ${key}`);
    }
  }
  const dirtyLocales = new Set<string>();
  async function exportChanges() {
    const files = [...texts].map(([filePath, text]) => ({ path: './' + path.relative(rootPath, filePath).split(path.sep).join('/'), locale: settings.locales.find((locale: string) => path.resolve(rootPath, settings['plugin.inlang.messageFormat'].pathPattern.replace('{locale}', locale)) === filePath)!, content: new TextEncoder().encode(text), imported: true }));
    const exported = await project.exportFiles({ pluginKey: plugin.key, files });
    return exported.flatMap(file => {
      if (!settings.locales.includes(file.locale)) throw new Error('Unsafe exported locale');
      if (!dirtyLocales.has(file.locale)) return [];
      const target = path.resolve(rootPath, settings['plugin.inlang.messageFormat'].pathPattern.replace('{locale}', file.locale));
      const before = texts.get(target) ?? '';
      const after = new TextDecoder().decode(file.content);
      return before === after ? [] : [{ path: target, before, after }];
    });
  }
  return {
    projectPath, rootPath, baseLocale: settings.baseLocale, sourcePath, sourceText: texts.get(sourcePath) ?? '', keys,
    async preview(key) {
      const messages = await project.db.selectFrom('inlang_message').selectAll().where('bundle_id', '=', key).where('locale', '=', settings.baseLocale).execute();
      if (!messages[0]) return undefined;
      const variants = await project.db.selectFrom('inlang_variant').selectAll().where('message_id', '=', messages[0].id).execute();
      const variant = variants.find(v => v.matches.every(m => m.type === 'catchall-match')) ?? variants[0];
      return variant?.pattern.map(part => part.type === 'text' ? part.value : part.type === 'expression' && part.arg.type === 'variable-reference' ? `{${part.arg.name}}` : '{…}').join('');
    },
    async planInsert(key, text) {
      validateKey(key);
      checkCollision(key);
      const pattern: import('@inlang/sdk').Pattern = [];
      const names = new Set<string>();
      let offset = 0;
      for (const match of text.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)) {
        if (match.index! > offset) pattern.push({ type: 'text', value: text.slice(offset, match.index) });
        pattern.push({ type: 'expression', arg: { type: 'variable-reference', name: match[1] } });
        names.add(match[1]); offset = match.index! + match[0].length;
      }
      if (offset < text.length || !pattern.length) pattern.push({ type: 'text', value: text.slice(offset) });
      await project.db.insertInto('inlang_bundle').values({ id: key, declarations: [...names].map(name => ({ type: 'input-variable' as const, name })) }).execute();
      const message = await project.db.insertInto('inlang_message').values({ bundle_id: key, locale: settings.baseLocale }).returning('id').executeTakeFirstOrThrow();
      await project.db.insertInto('inlang_variant').values({ message_id: message.id, matches: [], pattern }).execute();
      keys.add(key); dirtyLocales.add(settings.baseLocale);
      return exportChanges();
    },
    async planRename(oldKey, newKey) {
      validateKey(newKey);
      if (!keys.has(oldKey)) throw new Error(`Key not found: ${oldKey}`);
      if (oldKey === newKey) return [];
      checkCollision(newKey, oldKey);
      for (const message of await project.db.selectFrom('inlang_message').select('locale').where('bundle_id', '=', oldKey).execute()) dirtyLocales.add(message.locale);
      const bundle = await project.db.selectFrom('inlang_bundle').selectAll().where('id', '=', oldKey).executeTakeFirstOrThrow();
      await project.db.insertInto('inlang_bundle').values({ id: newKey, declarations: bundle.declarations, lixcol_metadata: bundle.lixcol_metadata }).execute();
      await project.db.updateTable('inlang_message').set({ bundle_id: newKey }).where('bundle_id', '=', oldKey).execute();
      await project.db.deleteFrom('inlang_bundle').where('id', '=', oldKey).execute();
      keys.delete(oldKey); keys.add(newKey);
      return exportChanges();
    },
    close: () => project.close(),
  };
}
