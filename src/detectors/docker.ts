import type { DetectorContribution, ScanResult } from '../types/index.js';
import { emptyContribution } from './node.js';

const DOCKER_FILES = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

export function detectDocker(scan: ScanResult): DetectorContribution {
  const files = DOCKER_FILES.filter((file) => scan.files.includes(file));

  if (files.length === 0) {
    return emptyContribution();
  }

  return {
    detectedTechStack: ['Docker'],
    detectedFeatures: ['Docker'],
    entryPoints: [],
    importantFiles: files.map((file) => ({
      path: file,
      reason: file === 'Dockerfile' ? 'Container image build config' : 'Container orchestration config',
    })),
    scripts: [],
  };
}
