import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind, ResponseError, ErrorCodes } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSdkProject } from './sdk-project.ts';
import { projectForFile, sourceFiles, within } from './projects.ts';
import { references, planExtraction } from './syntax.ts';
import { generateKey } from './keys.ts';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { exists } from './projects.ts';
import type { TextDocumentEdit } from 'vscode-languageserver/node';

// stdout belongs exclusively to JSON-RPC, including while the SDK is running.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let roots: string[] = [];
let supportsDocumentChanges = false;

function localPath(uri: string): string | undefined {
  try { return uri.startsWith('file:') ? fileURLToPath(uri) : undefined; } catch { return; }
}

connection.onInitialize(params => {
  supportsDocumentChanges = params.capabilities.workspace?.workspaceEdit?.documentChanges === true;
  roots = (params.workspaceFolders?.map(folder => localPath(folder.uri))
    ?? [params.rootUri ? localPath(params.rootUri) : params.rootPath ?? undefined])
    .filter((root): root is string => !!root);
  return { capabilities: { textDocumentSync: TextDocumentSyncKind.Full, hoverProvider: true, codeActionProvider: { codeActionKinds: ['refactor.extract'] }, renameProvider: { prepareProvider: true } },
    serverInfo: { name: 'Sherlock Zed SDK', version: '0.1.0' } };
});

connection.onHover(async params => {
  const document = documents.get(params.textDocument.uri);
  const file = localPath(params.textDocument.uri);
  if (!document || !file) return null;
  const offset = document.offsetAt(params.position);
  const reference = references(document.uri, document.getText()).find(ref => ref.start <= offset && offset < ref.end);
  if (!reference) return null;
  const projectPath = await projectForFile(file, roots);
  if (!projectPath) return null;
  const overlays = new Map(documents.all().flatMap(doc => {
    const file = localPath(doc.uri); return file ? [[file, doc.getText()] as const] : [];
  }));
  try {
    const project = await openSdkProject(projectPath, overlays);
    try {
      const message = await project.preview(reference.key);
      return message === undefined ? null : {
        contents: { kind: 'plaintext' as const, value: `${message}\n\n${reference.key} · ${project.baseLocale}` },
        range: { start: document.positionAt(reference.start), end: document.positionAt(reference.end) },
      };
    } finally { await project.close(); }
  } catch (error) {
    throw new ResponseError(ErrorCodes.InvalidParams, error instanceof Error ? error.message : String(error));
  }
});

function snapshot() {
  return new Map(documents.all().map(doc => [doc.uri, { text: doc.getText(), version: doc.version }]));
}

// Edit planning uses canonical SDK paths. Reject aliases rather than silently
// treating an open dirty buffer as a closed, unversioned file.
async function rejectAliases(captured: ReturnType<typeof snapshot>) {
  const files = [...roots, ...[...captured.keys()].flatMap(uri => { const file = localPath(uri); return file ? [file] : []; })];
  for (const file of files) {
    let canonical: string;
    try { canonical = await realpath(file); }
    catch { try { canonical = path.join(await realpath(path.dirname(file)), path.basename(file)); } catch { continue; } }
    if (canonical !== path.resolve(file)) {
      throw new ResponseError(ErrorCodes.InvalidParams, `Symlink or path alias is not supported for edits: ${file}. Reopen the workspace and documents using their canonical real paths (${canonical}).`);
    }
  }
}

async function catalogEdits(changes: { path: string; before: string; after: string }[], captured: ReturnType<typeof snapshot>): Promise<TextDocumentEdit[]> {
  await rejectAliases(snapshot());
  const result: TextDocumentEdit[] = [];
  for (const change of changes) {
    const uri = pathToFileURL(change.path).href;
    const old = captured.get(uri);
    const current = documents.get(uri);
    if (old ? !current || current.version !== old.version || old.text !== change.before : current || await readFile(change.path, 'utf8') !== change.before) {
      throw new ResponseError(-32801, 'Translation document changed; request the action again');
    }
    const doc = TextDocument.create(uri, 'json', old?.version ?? 0, change.before);
    result.push({ textDocument: { uri, version: old?.version ?? null }, edits: [{
      range: { start: { line: 0, character: 0 }, end: doc.positionAt(change.before.length) }, newText: change.after,
    }] });
  }
  return result;
}

async function defaultImport(file: string, root: string) {
  for (const [relative, kind] of [['app/i18n.ts', 'named'], ['app/i18n/public/paraglide/messages.js', 'namespace'], ['app/paraglide/messages.js', 'namespace']] as const) {
    const target = path.join(root, relative);
    if (await exists(target)) {
      let module = path.relative(path.dirname(file), target).split(path.sep).join('/');
      if (!module.startsWith('.')) module = `./${module}`;
      return { module, kind };
    }
  }
}

connection.onCodeAction(async params => {
  if (!supportsDocumentChanges || (params.context.only && !params.context.only.some(kind => 'refactor.extract'.startsWith(kind)))) return [];
  const current = documents.get(params.textDocument.uri);
  const file = localPath(params.textDocument.uri);
  if (!current || !file) return [];
  const doc = TextDocument.create(current.uri, current.languageId, current.version, current.getText());
  const captured = snapshot();
  await rejectAliases(captured);
  const projectPath = await projectForFile(file, roots);
  if (!projectPath) return [];
  const overlays = new Map([...captured].flatMap(([uri, value]) => { const file = localPath(uri); return file ? [[file, value.text] as const] : []; }));
  const project = await openSdkProject(projectPath, overlays);
  try {
    const fallback = await defaultImport(file, project.rootPath);
    const start = doc.offsetAt(params.range.start), end = doc.offsetAt(params.range.end);
    const selection = planExtraction(doc.uri, doc.getText(), start, end, 'message', fallback);
    if (!selection) return [];
    const key = generateKey(selection.message, project.keys);
    const plan = planExtraction(doc.uri, doc.getText(), start, end, key, fallback)!;
    const changes = await project.planInsert(key, plan.message);
    const catalogs = await catalogEdits(changes, captured);
    if (documents.get(doc.uri)?.version !== doc.version) throw new ResponseError(-32801, 'Source changed; request the action again');
    return [{ title: `Sherlock: Extract “${key}”`, kind: 'refactor.extract', isPreferred: true,
      edit: { documentChanges: [{ textDocument: { uri: doc.uri, version: doc.version },
        edits: plan.edits.map(edit => ({ range: { start: doc.positionAt(edit.start), end: doc.positionAt(edit.end) }, newText: edit.newText })) }, ...catalogs] },
    }];
  } finally { await project.close(); }
});

function referenceAt(doc: TextDocument, position: { line: number; character: number }) {
  const offset = doc.offsetAt(position);
  return references(doc.uri, doc.getText()).find(ref => ref.start <= offset && offset < ref.end);
}

connection.onPrepareRename(async params => {
  const doc = documents.get(params.textDocument.uri);
  const file = localPath(params.textDocument.uri);
  if (!doc || !file || !await projectForFile(file, roots)) return null;
  const ref = referenceAt(doc, params.position);
  return ref ? { range: { start: doc.positionAt(ref.start), end: doc.positionAt(ref.end) }, placeholder: ref.key } : null;
});

connection.onRenameRequest(async params => {
  if (!supportsDocumentChanges) throw new ResponseError(ErrorCodes.InvalidParams, 'Versioned document changes are required');
  if (!/^[A-Za-z_$][\w$]*$/.test(params.newName)) throw new ResponseError(ErrorCodes.InvalidParams, 'Use a valid identifier for the new key');
  const current = documents.get(params.textDocument.uri);
  const file = localPath(params.textDocument.uri);
  if (!current || !file) return null;
  const doc = TextDocument.create(current.uri, current.languageId, current.version, current.getText());
  const ref = referenceAt(doc, params.position);
  if (!ref) return null;
  const captured = snapshot();
  await rejectAliases(captured);
  const projectPath = await projectForFile(file, roots);
  if (!projectPath) return null;
  if (documents.get(doc.uri)?.version !== doc.version) throw new ResponseError(-32801, 'Source changed; request rename again');
  const overlays = new Map([...captured].flatMap(([uri, value]) => { const file = localPath(uri); return file ? [[file, value.text] as const] : []; }));
  const project = await openSdkProject(projectPath, overlays);
  try {
    if (!project.keys.has(ref.key)) throw new ResponseError(ErrorCodes.InvalidParams, 'Unknown message key');
    if (ref.key === params.newName) return { documentChanges: [] };
    const files = new Set(await sourceFiles(project.rootPath));
    for (const uri of captured.keys()) {
      const candidate = localPath(uri);
      if (candidate && within(candidate, project.rootPath) && /\.[cm]?[jt]sx?$/.test(candidate)
        && !candidate.split(path.sep).some(segment => segment === 'paraglide' || segment.endsWith('.inlang'))
        && await projectForFile(candidate, roots) === projectPath) files.add(candidate);
    }
    const sources: TextDocumentEdit[] = [];
    const before = new Map<string, string>();
    for (const candidate of files) {
      const uri = pathToFileURL(candidate).href;
      const old = captured.get(uri);
      const text = old?.text ?? await readFile(candidate, 'utf8');
      if (text.length > 2_000_000) throw new ResponseError(ErrorCodes.InvalidParams, 'Source file exceeds the rename size limit');
      const matches = references(uri, text).filter(r => r.key === ref.key);
      if (!matches.length) continue;
      const target = TextDocument.create(uri, 'typescript', old?.version ?? 0, text);
      before.set(candidate, text);
      sources.push({ textDocument: { uri, version: old?.version ?? null }, edits: matches.map(r => ({
        range: { start: target.positionAt(r.start), end: target.positionAt(r.end) }, newText: params.newName,
      })) });
    }
    const changes = await project.planRename(ref.key, params.newName);
    const catalogs = await catalogEdits(changes, captured);
    for (const [candidate, text] of before) {
      const uri = pathToFileURL(candidate).href;
      const old = captured.get(uri), now = documents.get(uri);
      if (old ? !now || now.version !== old.version : now || await readFile(candidate, 'utf8') !== text) {
        throw new ResponseError(-32801, 'Source changed; request rename again');
      }
    }
    if (documents.get(doc.uri)?.version !== doc.version) throw new ResponseError(-32801, 'Source changed; request rename again');
    return { documentChanges: [...sources, ...catalogs] };
  } finally { await project.close(); }
});

documents.listen(connection);
connection.listen();
