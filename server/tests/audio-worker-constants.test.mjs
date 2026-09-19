// 워커(Python)와 서버(JS)가 같은 계약 파일을 읽는지, 그리고 그 계약이 스스로
// 모순되지 않는지 확인한다. 값을 양쪽에 따로 적으면 서버가 모든 완료를 400으로
// 거절하고 워커는 곡마다 실패하면서 계속 돈다 — 로그에는 400만 남는다.
//
// Python을 실행하지 않고 소스에서 참조 방식만 읽는다. CI에 파이썬 의존성을
// 늘리지 않기 위해서다.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const contract = JSON.parse(read('server/src/constants/audio-pipeline.json'));

describe('오디오 파이프라인 계약', () => {
  it('워커와 서버가 값을 따로 적지 않고 계약 파일을 읽는다', () => {
    const sources = {
      'labels.py': read('audio-analysis-worker/labels.py'),
      'emotion.py': read('audio-analysis-worker/emotion.py'),
      'runs.js': read('server/src/features/audio-analysis/runs.js'),
    };
    for (const [name, source] of Object.entries(sources)) {
      expect(source, `${name}이 audio-pipeline.json을 읽어야 한다`).toContain('audio-pipeline.json');
    }

    // 계약에 있는 값을 소스에 그대로 다시 적으면 드리프트가 생긴다.
    const literals = [contract.emotion_models.embedding, contract.emotion_models.regression];
    for (const [name, source] of Object.entries(sources)) {
      for (const literal of literals) {
        expect(source, `${name}에 계약 값 "${literal}"이 그대로 박혀 있다`).not.toContain(literal);
      }
    }
  });

  it('재시도 분류에 같은 오류 코드가 두 번 들어가지 않는다', () => {
    const { infrastructure_codes: infra, permanent_codes: permanent, temporary_codes: temporary } = contract.retry;
    const all = [...infra, ...permanent, ...temporary];

    expect(new Set(all).size, '같은 코드가 여러 분류에 들어가면 재시도 동작이 정해지지 않는다').toBe(all.length);
  });
});
