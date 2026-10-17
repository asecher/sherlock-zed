import ts from 'typescript';

export interface Reference { key: string; start: number; end: number; binding: string }

function parse(uri: string, text: string): ts.SourceFile {
  return ts.createSourceFile(uri, text, ts.ScriptTarget.Latest, true,
    /\.[jt]sx$/i.test(uri) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function imports(file: ts.SourceFile): Set<string> {
  const result = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    if (!/(?:^|\/)paraglide\/messages(?:\.[cm]?[jt]s)?$/.test(module) && !/(?:^|\/)i18n(?:\.[cm]?[jt]s)?$/.test(module)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) result.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if (!item.isTypeOnly && (item.propertyName ?? item.name).text === 'm') result.add(item.name.text);
      }
    }
  }
  return result;
}

function checkerFor(file: ts.SourceFile): ts.TypeChecker {
  const options = { noLib: true, noResolve: true, allowJs: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === file.fileName ? file : undefined;
  host.fileExists = name => name === file.fileName;
  return ts.createProgram([file.fileName], options, host).getTypeChecker();
}

function isImportSymbol(symbol: ts.Symbol | undefined): boolean {
  return symbol?.declarations?.some(d => ts.isNamespaceImport(d) || ts.isImportSpecifier(d)) ?? false;
}

function safeLiteral(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): boolean {
  const parent = node.parent;
  if (ts.isJsxAttribute(parent)) return !node.text.includes('&') && /^(?:title|alt|placeholder|label|aria-label|aria-description)$/.test(parent.name.getText());
  return (ts.isVariableDeclaration(parent) && parent.initializer === node)
    || (ts.isReturnStatement(parent) && parent.expression === node)
    || ts.isJsxExpression(parent);
}

export function references(uri: string, text: string): Reference[] {
  const file = parse(uri, text);
  const bindings = imports(file);
  const checker = checkerFor(file);
  const result: Reference[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && bindings.has(expr.expression.text) && isImportSymbol(checker.getSymbolAtLocation(expr.expression))) {
        result.push({ key: expr.name.text, start: expr.name.getStart(file), end: expr.name.end, binding: expr.expression.text });
      } else if (ts.isElementAccessExpression(expr) && ts.isIdentifier(expr.expression) && bindings.has(expr.expression.text)
          && ts.isStringLiteral(expr.argumentExpression) && isImportSymbol(checker.getSymbolAtLocation(expr.expression))) {
        result.push({ key: expr.argumentExpression.text, start: expr.argumentExpression.getStart(file) + 1,
          end: expr.argumentExpression.end - 1, binding: expr.expression.text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

export interface OffsetEdit { start: number; end: number; newText: string }
export interface Extraction { message: string; edits: OffsetEdit[] }
export interface ImportOption { module: string; kind: 'namespace' | 'named' }

export function planExtraction(uri: string, text: string, start: number, end: number, key: string,
  fallback?: ImportOption): Extraction | undefined {
  if (end <= start) return;
  const file = parse(uri, text);
  const imported = imports(file);
  let location: ts.Node = file;
  function locate(node: ts.Node): void {
    if (node.getFullStart() <= start && node.end >= end) {
      location = node;
      ts.forEachChild(node, locate);
    }
  }
  locate(file);
  const checker = checkerFor(file);
  const symbols = checker.getSymbolsInScope(location, ts.SymbolFlags.Value | ts.SymbolFlags.Alias);
  let binding = [...imported].find(name => isImportSymbol(symbols.find(symbol => symbol.name === name)));
  const extra: OffsetEdit[] = [];
  if (!binding) {
    if (imported.size || !fallback || !fallback.module.startsWith('.')) return;
    const used = new Set<string>();
    function identifiers(node: ts.Node): void {
      if (ts.isIdentifier(node)) used.add(node.text);
      ts.forEachChild(node, identifiers);
    }
    identifiers(file);
    binding = 'm';
    for (let i = 2; used.has(binding); i++) binding = `m${i}`;
    const clause = fallback.kind === 'namespace' ? `* as ${binding}` : binding === 'm' ? '{ m }' : `{ m as ${binding} }`;
    const preceding = file.statements.filter(s => ts.isImportDeclaration(s) || (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)));
    const offset = preceding.at(-1)?.end ?? (text.startsWith('#!') ? text.indexOf('\n') + 1 : 0);
    extra.push({ start: offset, end: offset, newText: `${offset ? '\n' : ''}import ${clause} from ${JSON.stringify(fallback.module)};\n` });
  }
  let result: Extraction | undefined;
  const call = /^[A-Za-z_$][\w$]*$/.test(key) ? `${binding}.${key}()` : `${binding}[${JSON.stringify(key)}]()`;
  function visit(node: ts.Node): void {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && ((start === node.getStart(file) && end === node.end)
          || (start === node.getStart(file) + 1 && end === node.end - 1))
        && safeLiteral(node) && !/\{[A-Za-z_$][\w$]*\}/.test(node.text)) {
      const attribute = ts.isJsxAttribute(node.parent);
      result = { message: node.text, edits: [...extra, { start: node.getStart(file), end: node.end,
        newText: attribute ? `{${call}}` : call }] };
    }
    if (ts.isJsxText(node) && start >= node.pos && end <= node.end
      && text.slice(node.pos, start).trim() === '' && text.slice(end, node.end).trim() === '') {
      const message = text.slice(start, end);
      if (message.trim() && !/[\r\n&]/.test(message) && !/\{[A-Za-z_$][\w$]*\}/.test(message)) {
        const call = /^[A-Za-z_$][\w$]*$/.test(key) ? `${binding}.${key}()` : `${binding}[${JSON.stringify(key)}]()`;
        result = { message, edits: [...extra, { start, end, newText: `{${call}}` }] };
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}
