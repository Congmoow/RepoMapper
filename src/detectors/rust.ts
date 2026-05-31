import path from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { DetectorContribution, ScanResult } from '../types/index.js';
import { isRecord, readTextFile } from '../utils/fs.js';
import { emptyContribution } from './node.js';

export async function detectRust(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const hasCargoToml = scan.files.includes('Cargo.toml');
  const hasRsFiles = scan.files.some((f) => f.endsWith('.rs'));

  if (!hasCargoToml && !hasRsFiles) {
    return emptyContribution();
  }

  const techStack = new Set<string>(['Rust']);
  const features = new Set<string>();
  const importantFiles: Array<{ path: string; reason: string }> = [];
  const entryPoints: Array<{ path: string; label: string }> = [];

  if (hasCargoToml) {
    importantFiles.push({ path: 'Cargo.toml', reason: 'Rust package manifest and dependencies' });
    const cargoContent = await readTextFile(path.join(rootPath, 'Cargo.toml'));
    if (cargoContent) {
      const info = parseCargoToml(cargoContent);
      if (info) {
        for (const dep of info.frameworks) techStack.add(dep);
        for (const feat of info.features) features.add(feat);
      }
    }
  }

  if (scan.files.includes('Cargo.lock')) {
    importantFiles.push({ path: 'Cargo.lock', reason: 'Rust dependency lock file' });
  }

  // Detect entry points
  if (scan.files.includes('src/main.rs')) {
    entryPoints.push({ path: 'src/main.rs', label: 'Rust binary entry point' });
  }
  if (scan.files.includes('src/lib.rs')) {
    entryPoints.push({ path: 'src/lib.rs', label: 'Rust library entry point' });
  }

  // Detect workspace members
  const memberMains = scan.files.filter(
    (f) => f !== 'src/main.rs' && f.endsWith('/src/main.rs'),
  );
  for (const main of memberMains.slice(0, 5)) {
    const crate = main.replace('/src/main.rs', '');
    entryPoints.push({ path: main, label: `Workspace binary: ${crate}` });
  }

  // Detect build script
  if (scan.files.includes('build.rs')) {
    importantFiles.push({ path: 'build.rs', reason: 'Rust build script' });
  }

  if (scan.files.includes('Makefile') || scan.files.includes('Makefile.toml')) {
    const makeFile = scan.files.includes('Makefile') ? 'Makefile' : 'Makefile.toml';
    importantFiles.push({ path: makeFile, reason: 'Build and task automation' });
  }

  return {
    detectedTechStack: [...techStack],
    detectedFeatures: [...features],
    entryPoints,
    importantFiles,
    scripts: [],
  };
}

interface CargoInfo {
  frameworks: string[];
  features: string[];
}

function parseCargoToml(content: string): CargoInfo | undefined {
  try {
    const parsed = parseToml(content);
    if (!isRecord(parsed)) return undefined;

    const frameworks: string[] = [];
    const features: string[] = [];

    const deps = {
      ...(isRecord(parsed.dependencies) ? parsed.dependencies : {}),
      ...(isRecord(parsed['dev-dependencies']) ? parsed['dev-dependencies'] : {}),
    };

    // Detect web frameworks
    if ('actix-web' in deps) frameworks.push('Actix Web');
    if ('axum' in deps) frameworks.push('Axum');
    if ('rocket' in deps) frameworks.push('Rocket');
    if ('warp' in deps) frameworks.push('Warp');
    if ('tokio' in deps) frameworks.push('Tokio');
    if ('serde' in deps) frameworks.push('Serde');
    if ('diesel' in deps) frameworks.push('Diesel');
    if ('sqlx' in deps) frameworks.push('SQLx');
    if ('clap' in deps) { frameworks.push('Clap'); features.push('CLI application'); }
    if ('tonic' in deps) frameworks.push('Tonic (gRPC)');

    // Detect if it's a web service
    if (frameworks.some((f) => ['Actix Web', 'Axum', 'Rocket', 'Warp'].includes(f))) {
      features.push('Backend');
    }

    // Detect workspace
    if (isRecord(parsed.workspace)) {
      features.push('Cargo workspace');
    }

    return { frameworks, features };
  } catch {
    return undefined;
  }
}
