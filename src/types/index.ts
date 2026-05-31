export interface RepoMapperConfig {
  maxDepth: number;
  ignore: string[];
  includeTests: boolean;
  includeScripts: boolean;
  includeCi: boolean;
  includeDocker: boolean;
}

export interface ScanResult {
  rootPath: string;
  files: string[];
  directories: string[];
  keyFiles: string[];
}

export interface EntryPoint {
  path: string;
  label: string;
}

export interface ImportantFile {
  path: string;
  reason: string;
}

export interface ScriptInfo {
  name: string;
  command: string;
}

export interface WorkspacePackage {
  name: string;
  path: string;
  dependencies: string[];
  devDependencies: string[];
}

export interface DetectionResult {
  projectName?: string;
  detectedTechStack: string[];
  detectedFeatures: string[];
  entryPoints: EntryPoint[];
  importantFiles: ImportantFile[];
  scripts: ScriptInfo[];
  workspacePackages?: WorkspacePackage[];
}

export interface DetectorContribution {
  projectName?: string;
  detectedTechStack: string[];
  detectedFeatures: string[];
  entryPoints: EntryPoint[];
  importantFiles: ImportantFile[];
  scripts: ScriptInfo[];
  workspacePackages?: WorkspacePackage[];
}

export interface ProjectContext {
  projectName: string;
  rootPath: string;
  generatedAt: string;
  config: RepoMapperConfig;
  scan: ScanResult;
  detection: DetectionResult;
  directoryMap: string[];
  suggestedReadingOrder: string[];
  /** File-level import graph data for TS/JS, Python and Go projects */
  importGraph?: ImportGraphSummary | undefined;
  /** Exported symbols per file (only for TS/JS projects) */
  symbols?: FileSymbolsSummary[] | undefined;
}

export interface ImportGraphSummary {
  /** Most depended-on files (hub modules) */
  hubs: string[];
  /** Files that import many others but are rarely imported (likely entry points) */
  entryLike: string[];
  /** Total number of import edges */
  edgeCount: number;
}

export interface FileSymbolsSummary {
  file: string;
  exports: Array<{ name: string; kind: string }>;
}

export type DoctorStatus = 'pass' | 'warning' | 'fail';

export interface DoctorCheck {
  label: string;
  status: DoctorStatus;
  message: string;
}

export interface PackageMetadata {
  name?: string;
  scripts: ScriptInfo[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  allDependencies: Record<string, string>;
  workspaces: string[];
}
