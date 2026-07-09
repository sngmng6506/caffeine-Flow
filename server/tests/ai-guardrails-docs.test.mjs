import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AI 수정 가드레일 문서 연결', () => {
  it('AI_CHANGE_GUARDRAILS.md 문서가 존재한다', () => {
    expect(existsSync(path.join(root, 'docs/AI_CHANGE_GUARDRAILS.md'))).toBe(true);
  });

  it('README와 AGENTS가 가드레일 문서를 참조한다', () => {
    expect(readRepoFile('README.md')).toContain('docs/AI_CHANGE_GUARDRAILS.md');
    expect(readRepoFile('AGENTS.md')).toContain('docs/AI_CHANGE_GUARDRAILS.md');
  });

  it('도구별 포인터 파일이 가드레일 문서를 참조한다', () => {
    expect(readRepoFile('CLAUDE.md')).toContain('docs/AI_CHANGE_GUARDRAILS.md');
    expect(readRepoFile('GEMINI.md')).toContain('docs/AI_CHANGE_GUARDRAILS.md');
    expect(readRepoFile('.cursor/rules')).toContain('docs/AI_CHANGE_GUARDRAILS.md');
  });

  it('가드레일 문서가 핵심 계약 영역을 포함한다', () => {
    const doc = readRepoFile('docs/AI_CHANGE_GUARDRAILS.md');
    for (const phrase of [
      'Recommendation Status Contract',
      'Music Filter Status Contract',
      'Router Mount Order Contract',
      'Platform Contract',
      'Limit Policy Contract',
      'KST Time Policy Contract',
      'SQL Raw Fragment Contract',
      'LLM Prompt and Safety Contract',
      'Migration Contract',
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  it('가드레일 문서가 핵심 상수/SQL 파일을 참조한다', () => {
    const doc = readRepoFile('docs/AI_CHANGE_GUARDRAILS.md');
    for (const file of [
      'server/src/constants/recommendation-status.js',
      'server/src/constants/music-filter-status.js',
      'server/src/constants/platforms.js',
      'server/src/constants/limits.js',
      'server/src/constants/time-policy.js',
      'server/src/db/sql-fragments.js',
    ]) {
      expect(doc).toContain(file);
    }
  });
});
