import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildMusicFilterMessages } from '../src/features/music-filter/prompt.builder.js';
import { buildPublicGuideMessages } from '../src/features/music-filter/public-guide.service.js';
import { renderPrompt } from '../src/features/music-filter/prompt.renderer.js';
import { evaluateTrack } from '../src/features/music-filter/music-filter.service.js';

// 파일 분리 전 출력이다. 공백·기본값·이스케이프·사용자 템플릿 문법을 함께 확인한다.
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/prompt-messages.json', import.meta.url), 'utf8'));

describe('서비스 프롬프트 템플릿', () => {
  it.each(fixtures)('기존 메시지를 그대로 렌더링한다: $input.cafePrompt', ({ input, filter, guide }) => {
    expect(buildMusicFilterMessages(input)).toEqual(filter);
    expect(buildPublicGuideMessages(input.cafePrompt)).toEqual(guide);
  });

  it('출력 변수 누락과 등록하지 않은 파일을 거절한다', () => {
    expect(() => renderPrompt('music-filter.user.njk', { cafe_policy: '재즈' })).toThrow();
    expect(() => renderPrompt('public-guide.system.njk')).toThrow();
    expect(() => renderPrompt('../prompt.builder.js')).toThrow();
  });

  it('메시지 구성 실패도 fail-closed로 처리한다', async () => {
    const result = await evaluateTrack({ cafePrompt: '재즈', track: null });
    expect(result.filterStatus).toBe('error_rejected');
    expect(result.action).toBe('reject');
  });
});
