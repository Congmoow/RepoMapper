import path from 'node:path';

import type { DetectorContribution, ScanResult } from '../types/index.js';
import { readTextFile } from '../utils/fs.js';
import { emptyContribution } from './node.js';

export async function detectJava(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const hasPom = scan.files.includes('pom.xml');
  const hasBuildGradle = scan.files.includes('build.gradle') || scan.files.includes('build.gradle.kts');
  const hasJavaFiles = scan.files.some((f) => f.endsWith('.java'));
  const hasKotlinFiles = scan.files.some((f) => f.endsWith('.kt') || f.endsWith('.kts'));

  if (!hasPom && !hasBuildGradle && !hasJavaFiles && !hasKotlinFiles) {
    return emptyContribution();
  }

  const techStack = new Set<string>();
  const features = new Set<string>();
  const importantFiles: Array<{ path: string; reason: string }> = [];
  const entryPoints: Array<{ path: string; label: string }> = [];

  if (hasJavaFiles) techStack.add('Java');
  if (hasKotlinFiles) techStack.add('Kotlin');

  // Build tool detection
  if (hasPom) {
    techStack.add('Maven');
    importantFiles.push({ path: 'pom.xml', reason: 'Maven project configuration' });
    const pomContent = await readTextFile(path.join(rootPath, 'pom.xml'));
    if (pomContent) {
      detectMavenFrameworks(pomContent, techStack, features);
    }
  }

  if (hasBuildGradle) {
    techStack.add('Gradle');
    const gradleFile = scan.files.includes('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle';
    importantFiles.push({ path: gradleFile, reason: 'Gradle build configuration' });
    const gradleContent = await readTextFile(path.join(rootPath, gradleFile));
    if (gradleContent) {
      detectGradleFrameworks(gradleContent, techStack, features);
    }
  }

  // Settings files
  if (scan.files.includes('settings.gradle') || scan.files.includes('settings.gradle.kts')) {
    const settingsFile = scan.files.includes('settings.gradle.kts') ? 'settings.gradle.kts' : 'settings.gradle';
    importantFiles.push({ path: settingsFile, reason: 'Gradle multi-project settings' });
    features.add('Multi-module project');
  }

  // Detect entry points
  const mainCandidates = scan.files.filter(
    (f) => (f.endsWith('Application.java') || f.endsWith('Application.kt') || f.endsWith('Main.java') || f.endsWith('Main.kt')),
  );
  for (const candidate of mainCandidates.slice(0, 3)) {
    entryPoints.push({ path: candidate, label: 'Application entry point' });
  }

  // Detect common structure
  if (scan.directories.some((d) => d.includes('src/main/java') || d.includes('src/main/kotlin'))) {
    features.add('Standard Maven/Gradle layout');
  }

  // Detect application config
  const configFiles = ['src/main/resources/application.yml', 'src/main/resources/application.yaml', 'src/main/resources/application.properties'];
  for (const configFile of configFiles) {
    if (scan.files.includes(configFile)) {
      importantFiles.push({ path: configFile, reason: 'Application configuration' });
      break;
    }
  }

  return {
    detectedTechStack: [...techStack],
    detectedFeatures: [...features],
    entryPoints,
    importantFiles,
    scripts: [],
  };
}

function detectMavenFrameworks(content: string, techStack: Set<string>, features: Set<string>): void {
  if (content.includes('spring-boot')) { techStack.add('Spring Boot'); features.add('Backend'); }
  if (content.includes('spring-cloud')) techStack.add('Spring Cloud');
  if (content.includes('quarkus')) { techStack.add('Quarkus'); features.add('Backend'); }
  if (content.includes('micronaut')) { techStack.add('Micronaut'); features.add('Backend'); }
  if (content.includes('hibernate')) techStack.add('Hibernate');
  if (content.includes('mybatis')) techStack.add('MyBatis');
  if (content.includes('junit') || content.includes('testng')) features.add('Tests');
}

function detectGradleFrameworks(content: string, techStack: Set<string>, features: Set<string>): void {
  if (content.includes('spring-boot') || content.includes('org.springframework.boot')) {
    techStack.add('Spring Boot');
    features.add('Backend');
  }
  if (content.includes('quarkus')) { techStack.add('Quarkus'); features.add('Backend'); }
  if (content.includes('ktor')) { techStack.add('Ktor'); features.add('Backend'); }
  if (content.includes('android') || content.includes('com.android')) {
    techStack.add('Android');
    features.add('Mobile');
  }
  if (content.includes('compose')) techStack.add('Jetpack Compose');
}
