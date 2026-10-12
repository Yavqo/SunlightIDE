'use strict';
const ts = require('typescript');
const path = require('path');

class LanguageService {
  constructor() { this.root = null; this.files = new Map(); this.revision = 0; }
  configure(root) {
    const config = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json') || ts.findConfigFile(root, ts.sys.fileExists, 'jsconfig.json');
    const stamp = config ? `${config}:${ts.sys.getModifiedTime(config)?.getTime()}` : '';
    if (root === this.root && this.service && stamp === this.configStamp) return;
    this.configStamp = stamp;
    this.service?.dispose();
    this.root = root;
    const defaults = { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true };
    const parsed = config ? ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} }) : null;
    this.options = { ...defaults, ...parsed?.options, noEmit: true };
    this.projectFiles = (parsed?.fileNames || ts.sys.readDirectory(root, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'], ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'], undefined, 8)).slice(0, 3000);
    const host = {
      getCompilationSettings: () => this.options,
      getScriptFileNames: () => [...new Set([...this.projectFiles, ...this.files.keys()])],
      getScriptVersion: (file) => String(this.files.get(file)?.version ?? ts.sys.getModifiedTime(file)?.getTime() ?? 0),
      getProjectVersion: () => String(this.revision),
      getScriptSnapshot: (file) => { const text = this.files.get(file)?.text ?? ts.sys.readFile(file); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
      getCurrentDirectory: () => this.root,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (file) => this.files.has(file) || ts.sys.fileExists(file),
      readFile: (file) => this.files.get(file)?.text ?? ts.sys.readFile(file),
      readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    };
    this.service = ts.createLanguageService(host);
  }
  run(method, request) {
    if (!['completion', 'hover', 'definition', 'diagnostics', 'rename'].includes(method)) throw new Error('Unknown language request.');
    if (!request || !path.isAbsolute(request.file || '') || !Array.isArray(request.documents) || request.documents.length > 100) throw new Error('Invalid language request.');
    let bytes = 0;
    const files = new Map();
    const originals = new Map();
    const canonical = (file) => ts.normalizePath(path.resolve(file));
    for (const doc of request.documents) {
      if (!path.isAbsolute(doc.file || '') || typeof doc.text !== 'string') throw new Error('Invalid document.');
      bytes += Buffer.byteLength(doc.text);
      if (bytes > 10 * 1024 * 1024) throw new Error('Open documents exceed the language service limit (10 MB).');
      const filename = canonical(doc.file);
      originals.set(filename, doc.file);
      const previous = this.files.get(filename);
      files.set(filename, { text: doc.text, version: previous?.text === doc.text ? previous.version : this.revision + 1 });
    }
    this.files = files;
    this.configure(canonical(request.root && path.isAbsolute(request.root) ? request.root : path.dirname(request.file)));
    this.revision++;
    const file = canonical(request.file), text = files.get(file)?.text;
    if (text === undefined) throw new Error('Document is not open.');
    const pos = Math.max(0, Math.min(text.length, Number(request.offset) || 0));
    const service = this.service;
    const source = (fileName) => service.getProgram()?.getSourceFile(fileName);
    const location = (fileName, span) => {
      const sf = source(fileName);
      if (!sf) return null;
      const start = sf.getLineAndCharacterOfPosition(span.start);
      const end = sf.getLineAndCharacterOfPosition(span.start + span.length);
      return { file: originals.get(canonical(fileName)) || path.normalize(fileName), start: { line: start.line, col: start.character }, end: { line: end.line, col: end.character } };
    };
    if (method === 'completion') {
      const prefix = /[\w$]*$/.exec(text.slice(0, pos))[0].toLowerCase();
      const info = service.getCompletionsAtPosition(file, pos, { includeCompletionsForModuleExports: false, includeCompletionsWithInsertText: false });
      return (info?.entries || []).filter((e) => e.name.toLowerCase().startsWith(prefix) && !e.hasAction && !e.isSnippet)
        .sort((a, b) => a.sortText.localeCompare(b.sortText) || a.name.localeCompare(b.name)).slice(0, 30)
        .map((e) => ({ label: e.name, kind: e.kind }));
    }
    if (method === 'hover') {
      const info = service.getQuickInfoAtPosition(file, pos);
      return info ? { signature: ts.displayPartsToString(info.displayParts), documentation: ts.displayPartsToString(info.documentation) } : null;
    }
    if (method === 'definition') return (service.getDefinitionAtPosition(file, pos) || []).map((d) => location(d.fileName, d.textSpan)).filter(Boolean);
    if (method === 'rename') {
      const info = service.getRenameInfo(file, pos, { allowRenameOfImportPath: false });
      if (!info.canRename) throw new Error(info.localizedErrorMessage || 'This symbol cannot be renamed.');
      return (service.findRenameLocations(file, pos, false, false, true) || []).map((d) => ({ ...location(d.fileName, d.textSpan), prefix: d.prefixText || '', suffix: d.suffixText || '', oldText: source(d.fileName)?.text.slice(d.textSpan.start, d.textSpan.start + d.textSpan.length) })).filter((d) => d.file);
    }
    return [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)].slice(0, 200).map((d) => ({
      ...location(file, { start: d.start || 0, length: d.length || 0 }), message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning', code: d.code,
    }));
  }
}
module.exports = { LanguageService };
