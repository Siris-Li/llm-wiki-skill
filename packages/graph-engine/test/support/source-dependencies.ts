import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export type SourceDependencyKind = "import" | "dynamic-import" | "import-type" | "re-export" | "require";

export interface SourceDependencyEdge {
  source: string;
  target: string;
  specifier: string;
  kind: SourceDependencyKind;
  typeOnly?: boolean;
}

export interface GraphDependencyBaseline {
  legacyReferences: SourceDependencyEdge[];
  internalModelBarrelReferences: SourceDependencyEdge[];
  rendererRouteBypasses?: SourceDependencyEdge[];
}

export interface GraphDependencyFinding {
  rule:
    | "legacy-reference-growth"
    | "internal-model-barrel-growth"
    | "renderer-route-bypasses-shared-snapshot"
    | "stale-legacy-reference"
    | "stale-internal-model-barrel-reference"
    | "stale-renderer-route-bypass";
  edge: SourceDependencyEdge;
}

export interface TypeScriptModuleGraph {
  root: string;
  edges: SourceDependencyEdge[];
}

const MODULE_RESOLUTION_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  allowImportingTsExtensions: true
};

export async function readTypeScriptModuleGraph(root: string): Promise<TypeScriptModuleGraph> {
  const absoluteRoot = path.resolve(root);
  const files = await listTypeScriptFiles(absoluteRoot);
  const edges: SourceDependencyEdge[] = [];

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    const source = relativeModulePath(absoluteRoot, file);

    const addEdge = (specifier: string, kind: SourceDependencyKind, typeOnly = false): void => {
      const resolved = ts.resolveModuleName(specifier, file, MODULE_RESOLUTION_OPTIONS, ts.sys).resolvedModule;
      if (!resolved) return;
      const targetFile = path.resolve(resolved.resolvedFileName);
      if (!isInside(absoluteRoot, targetFile)) return;
      edges.push({ source, target: relativeModulePath(absoluteRoot, targetFile), specifier, kind, typeOnly });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const typeOnly = Boolean(clause?.isTypeOnly) || Boolean(
          clause?.namedBindings
          && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0
          && clause.namedBindings.elements.every((element) => element.isTypeOnly)
        );
        addEdge(node.moduleSpecifier.text, "import", typeOnly);
      } else if (
        ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression
        && ts.isStringLiteral(node.moduleReference.expression)
      ) {
        addEdge(node.moduleReference.expression.text, "import", node.isTypeOnly);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.exportClause;
        const typeOnly = node.isTypeOnly || Boolean(
          clause
          && ts.isNamedExports(clause)
          && clause.elements.length > 0
          && clause.elements.every((element) => element.isTypeOnly)
        );
        addEdge(node.moduleSpecifier.text, "re-export", typeOnly);
      } else if (ts.isImportTypeNode(node)) {
        const specifier = importTypeSpecifier(node);
        if (specifier) addEdge(specifier, "import-type", true);
      } else if (
        ts.isCallExpression(node)
        && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1
        && ts.isStringLiteral(node.arguments[0])
      ) {
        addEdge(node.arguments[0].text, "dynamic-import");
      } else if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "require"
        && node.arguments.length === 1
        && ts.isStringLiteral(node.arguments[0])
      ) {
        addEdge(node.arguments[0].text, "require");
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { root: absoluteRoot, edges };
}

export function auditGraphSourceDependencies(
  graph: TypeScriptModuleGraph,
  baseline: GraphDependencyBaseline
): GraphDependencyFinding[] {
  const findings: GraphDependencyFinding[] = [];
  const legacyBaseline = new Set(baseline.legacyReferences.map(edgeKey));
  const barrelBaseline = new Set(baseline.internalModelBarrelReferences.map(edgeKey));
  const rendererBypassBaseline = new Set((baseline.rendererRouteBypasses ?? []).map(edgeKey));
  const currentLegacy = new Set(graph.edges.filter(isLegacyReference).map(edgeKey));
  const currentBarrel = new Set(graph.edges.filter(isInternalModelBarrelReference).map(edgeKey));
  const currentRendererBypass = new Set(graph.edges.filter(isRendererRouteBypass).map(edgeKey));

  for (const edge of graph.edges) {
    if (isLegacyReference(edge) && !legacyBaseline.has(edgeKey(edge))) {
      findings.push({ rule: "legacy-reference-growth", edge });
    }
    if (isInternalModelBarrelReference(edge) && !barrelBaseline.has(edgeKey(edge))) {
      findings.push({ rule: "internal-model-barrel-growth", edge });
    }
    if (isRendererRouteBypass(edge) && !rendererBypassBaseline.has(edgeKey(edge))) {
      findings.push({ rule: "renderer-route-bypasses-shared-snapshot", edge });
    }
  }
  for (const edge of baseline.legacyReferences) {
    if (!currentLegacy.has(edgeKey(edge))) findings.push({ rule: "stale-legacy-reference", edge });
  }
  for (const edge of baseline.internalModelBarrelReferences) {
    if (!currentBarrel.has(edgeKey(edge))) findings.push({ rule: "stale-internal-model-barrel-reference", edge });
  }
  for (const edge of baseline.rendererRouteBypasses ?? []) {
    if (!currentRendererBypass.has(edgeKey(edge))) findings.push({ rule: "stale-renderer-route-bypass", edge });
  }

  return findings.sort((left, right) => {
    const ruleOrder = findingRuleOrder(left.rule) - findingRuleOrder(right.rule);
    if (ruleOrder) return ruleOrder;
    return edgeKey(left.edge).localeCompare(edgeKey(right.edge));
  });
}

function findingRuleOrder(rule: GraphDependencyFinding["rule"]): number {
  if (rule === "legacy-reference-growth") return 0;
  if (rule === "internal-model-barrel-growth") return 1;
  if (rule === "renderer-route-bypasses-shared-snapshot") return 2;
  if (rule === "stale-legacy-reference") return 3;
  if (rule === "stale-internal-model-barrel-reference") return 4;
  return 5;
}

function edgeKey(edge: SourceDependencyEdge): string {
  const usage = edge.typeOnly === true ? "type" : "value";
  return `${edge.source}\u0000${edge.kind}\u0000${usage}\u0000${edge.target}`;
}

function isRendererRoute(source: string): boolean {
  return source.startsWith("graph-routes/") || /^render\/[^/]*renderer\.(?:ts|tsx|mts|cts)$/.test(source);
}

function importTypeSpecifier(node: ts.ImportTypeNode): string | null {
  return ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)
    ? node.argument.literal.text
    : null;
}

function isLegacyReference(edge: SourceDependencyEdge): boolean {
  return edge.target === "model/legacy-helpers.ts";
}

function isInternalModelBarrelReference(edge: SourceDependencyEdge): boolean {
  return edge.target === "model/index.ts" && edge.source !== "index.ts";
}

function isRendererRouteBypass(edge: SourceDependencyEdge): boolean {
  return isRendererRoute(edge.source)
    && !edge.typeOnly
    && (edge.target.startsWith("model/") || edge.target === "render/model.ts");
}

async function listTypeScriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && /\.(?:ts|tsx|mts|cts)$/.test(entry.name)) files.push(absolute);
    }
  };
  await visit(root);
  return files;
}

function relativeModulePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/").replace(/\.d\.ts$/, ".ts");
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
