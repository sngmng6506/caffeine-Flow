import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

describe('관리자 AI 랩 정적 계약', () => {
  it('운영자 콘솔에서 두 랩으로 이동한다', () => {
    const html = read('admin/index.html');
    expect(html).toContain(`href='/filter-lab'`);
    expect(html).toContain(`href='/labeling-lab'`);
    expect(html).toContain('필터 테스트');
    expect(html).toContain('음악 라벨링');
  });

  it('필터 테스트는 관리자 세션과 관리자 API만 사용한다', () => {
    const app = read('music-filter-lab/app.js');
    const html = read('music-filter-lab/index.html');
    expect(app).toContain(`sessionStorage.getItem(TOKEN_KEY)`);
    expect(app).toContain(`/admin/music-filter/models`);
    expect(app).toContain(`/admin/music-filter/test`);
    expect(app).not.toContain(`localStorage.getItem('token')`);
    expect(html).not.toContain(`id='token'`);
    expect(html).toContain('<h1>필터 테스트</h1>');
  });

  it('음악 라벨링은 자동 곡 큐에서 확인 또는 수정한다', () => {
    const app = read('music-labeling-lab/app.js');
    const html = read('music-labeling-lab/index.html');
    const css = read('music-labeling-lab/styles.css');
    const adminRoute = read('server/src/routes/admin.js');
    const reviewService = read('server/src/features/music-labeling/review.service.js');
    const nullableMigration = read('server/src/db/migrations/20260828090000_nullable_music_filter_metadata_sufficient.js');
    expect(app).toContain(`/admin/audio-labels?view=`);
    expect(app).toContain('/admin/audio-labels/${item.id}/review');
    expect(app).toContain('track_annotation');
    expect(app).toContain('audio_analysis');
    expect(app).toContain('renderAudioAnalysis');
    expect(app).toContain('audio_analysis_revision');
    expect(app).toContain('annotation_revision');
    expect(app).toContain(`sessionStorage.getItem(TOKEN_KEY)`);
    // 사람은 택소노미를 고르지 않고 자동 서술이 곡과 맞는지만 답한다.
    expect(app).toContain('renderAutoDescription');
    expect(app).toContain('maest_summary?.audio_llm');
    expect(app).toContain(`submitVerdict('accurate'`);
    expect(app).toContain(`submitVerdict('inaccurate'`);
    expect(app).toContain(`submitVerdict('unclear'`);
    expect(app).not.toContain('setRadio');
    expect(app).not.toContain('applyAnalysisSuggestion');
    // 저장 뒤 다음 곡으로 넘기는 경로. 없으면 판정이 저장돼도 화면이 멈춘다.
    expect(app).toContain('async function advanceAfterReview');
    // 택소노미를 한 줄로 되살려 보여주던 자리
    expect(app).not.toContain('추천 라벨');
    expect(html).not.toContain('추천 라벨');
    // 제출할 것이 없는 form은 텍스트 입력에서 Enter가 페이지를 새로 고친다.
    expect(html).not.toContain('<form');
    // 곡마다 세 번 클릭하는 작업이라 키보드 가속기를 계약으로 고정한다.
    expect(app).toContain("SHORTCUTS");
    expect(app).toContain("submitVerdict('accurate', 'verdictAccurate')");
    expect(html).toContain('<kbd>1</kbd>');
    expect(html).toContain('<kbd>2</kbd>');
    expect(html).toContain('<kbd>3</kbd>');
    // 아이콘만 있는 버튼에는 이름이 있어야 한다.
    expect(html).toContain("aria-label='이전 곡'");
    expect(html).toContain("aria-label='다음 곡'");
    // 저장 실패를 alert으로 막지 않고 누른 자리 옆에 띄운다.
    expect(html).toContain("role='alert'");
    expect(app).not.toContain('alert(error.message)');
    // YouTube ID는 대소문자를 구분한다. 곡 식별자 줄을 대문자로 바꾸지 않는다.
    expect(css).not.toContain('text-transform: uppercase');
    expect(html).not.toContain('보컬 유형');
    expect(html).not.toContain('주요 분위기');
    expect(html).not.toContain('라벨 사용 목적');
    expect(html).not.toContain('노래와 랩이 섞임');
    expect(html).not.toContain('라벨 확신도');
    expect(html).toContain(`id='audioAnalysis'`);
    expect(html).toContain('1단 · MAEST');
    expect(html).not.toContain('콘텐츠 주의 요소');
    expect(html).not.toContain('선택 기준 도움말');
    expect(html).not.toContain('곡 버전');
    expect(html).not.toContain('기본 메타데이터만으로 판단 가능했나요?');
    expect(html).toContain("id='autoDescription'");
    expect(html).toContain("id='verdictAccurate'");
    expect(html).not.toContain("id='confirmReview'");
    expect(html).not.toContain("name='human_decision'");
    expect(html).toContain(`id='existingLabelStatus'`);
    expect(html).toContain('<h1>음악 라벨링</h1>');
    // 재생목록 제외는 라우트가 아니라 라벨링 서비스가 담당한다
    expect(reviewService).toContain(`builder.whereILike('recommendation.title', '%playlist%')`);
    expect(reviewService).toContain(`builder.whereLike('recommendation.title', '%플리%')`);
    expect(adminRoute).toContain(`metadataSufficient !== null`);
    expect(nullableMigration).toContain('ALTER COLUMN metadata_sufficient DROP NOT NULL');
    expect(nullableMigration).toContain('ALTER COLUMN metadata_sufficient SET NOT NULL');
  });
});
