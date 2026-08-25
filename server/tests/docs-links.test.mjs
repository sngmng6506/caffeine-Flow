// Markdown 링크 드리프트 검사 — 문서끼리 걸어둔 상대 링크와 제목 anchor가
// 실제로 존재하는지 CI에서 강제한다. 문서를 옮기거나 제목을 바꾸고 링크를
// 안 고치면 이 테스트가 실패한다.
//
// anchor 규칙은 GitHub 방식을 따른다: 소문자로 바꾸고, 문자·숫자·공백·하이픈이
// 아닌 문자를 지운 뒤, 남은 공백을 각각 하이픈 하나로 바꾼다. 구두점이 지워진
// 자리의 공백도 그대로 남으므로 `## 운영자 — /admin`은 `운영자--admin`이 된다.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

function markdownFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function anchors(source) {
  return new Set(
    source
      .split('\n')
      .filter((line) => line.startsWith('#'))
      .map((line) =>
        line
          .replace(/^#+\s*/, '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .trim()
          .replace(/ /g, '-'))
  );
}

const files = markdownFiles(root);
const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) anchorCache.set(file, anchors(fs.readFileSync(file, 'utf8')));
  return anchorCache.get(file);
}

const broken = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  for (const [, , target] of source.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#!)/.test(target)) continue;
    const [link, hash] = target.split('#');
    if (!link) {
      if (hash && !anchorsOf(file).has(hash)) broken.push(`${rel} -> #${hash} (제목 없음)`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), link);
    if (!fs.existsSync(resolved)) {
      broken.push(`${rel} -> ${target} (파일 없음)`);
      continue;
    }
    if (hash && resolved.endsWith('.md') && !anchorsOf(resolved).has(hash)) {
      broken.push(`${rel} -> ${target} (제목 없음)`);
    }
  }
}

describe('Markdown 링크 ↔ 실제 문서 동기화', () => {
  it('모든 상대 링크와 anchor가 존재한다', () => {
    expect(broken, `끊어진 링크:\n${broken.join('\n')}`).toEqual([]);
  });

  it('수집기가 실제로 문서를 찾았다 (자기 검증)', () => {
    // 탐색이 깨져 0개가 되면 위 테스트가 헛되이 통과하므로 방어
    expect(files.length).toBeGreaterThan(15);
  });
});
