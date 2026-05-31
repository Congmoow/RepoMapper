import path from 'node:path';

import type { DetectorContribution, ScanResult } from '../types/index.js';
import { readTextFile } from '../utils/fs.js';
import { emptyContribution } from './node.js';

export async function detectGo(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const hasGoMod = scan.files.includes('go.mod');
  const hasGoFiles = scan.files.some((f) => f.endsWith('.go'));

  if (!hasGoMod && !hasGoFiles) {
    return emptyContribution();
  }

  const techStack = new Set<string>(['Go']);
  const features = new Set<string>();
  const importantFiles: Array<{ path: string; reason: string }> = [];
  const entryPoints: Array<{ path: string; label: string }> = [];

  if (hasGoMod) {
    importantFiles.push({ path: 'go.mod', reason: 'Go module definition and dependencies' });
    const modContent = await readTextFile(path.join(rootPath, 'go.mod'));
    if (modContent) {
      // Detect common frameworks from go.mod
      if (modContent.includes('github.com/gin-gonic/gin')) techStack.add('Gin');
      if (modContent.includes('github.com/gofiber/fiber')) techStack.add('Fiber');
      if (modContent.includes('github.com/labstack/echo')) techStack.add('Echo');
      if (modContent.includes('github.com/gorilla/mux')) techStack.add('Gorilla Mux');
      if (modContent.includes('google.golang.org/grpc')) techStack.add('gRPC');
      if (modContent.includes('gorm.io/gorm')) techStack.add('GORM');
      if (modContent.includes('github.com/jmoiron/sqlx')) techStack.add('sqlx');
    }
  }

  if (scan.files.includes('go.sum')) {
    importantFiles.push({ path: 'go.sum', reason: 'Go dependency checksums' });
  }

  // Detect main packages (entry points)
  const mainCandidates = ['main.go', 'cmd/main.go'];
  for (const candidate of mainCandidates) {
    if (scan.files.includes(candidate)) {
      entryPoints.push({ path: candidate, label: 'Go main entry point' });
    }
  }

  // Detect cmd/ pattern (multi-binary project)
  const cmdDirs = scan.directories.filter((d) => d.startsWith('cmd/') && d.split('/').length === 2);
  for (const cmdDir of cmdDirs) {
    const mainFile = scan.files.find((f) => f.startsWith(`${cmdDir}/`) && f.endsWith('.go'));
    if (mainFile) {
      entryPoints.push({ path: mainFile, label: `CLI binary: ${cmdDir.replace('cmd/', '')}` });
    }
  }

  // Detect internal/pkg structure
  if (scan.directories.includes('internal')) features.add('Go internal packages');
  if (scan.directories.includes('pkg')) features.add('Go public packages');

  // Detect if it's a web service
  if (techStack.has('Gin') || techStack.has('Fiber') || techStack.has('Echo') || techStack.has('Gorilla Mux')) {
    features.add('Backend');
  }

  // Detect Makefile
  if (scan.files.includes('Makefile')) {
    importantFiles.push({ path: 'Makefile', reason: 'Build and task automation' });
  }

  return {
    detectedTechStack: [...techStack],
    detectedFeatures: [...features],
    entryPoints,
    importantFiles,
    scripts: [],
  };
}
