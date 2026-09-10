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
    const adminRoute = read('server/src/routes/admin.js');
    const reviewService = read('server/src/features/music-labeling/review.service.js');
    const nullableMigration = read('server/src/db/migrations/20260828090000_nullable_music_filter_metadata_sufficient.js');
    expect(app).toContain(`/admin/audio-labels?view=`);
    expect(app).toContain('/admin/audio-labels/${item.id}/review');
    expect(app).toContain('/admin/music-filter-artist-labels?');
    expect(app).toContain('track_annotation');
    expect(app).toContain('audio_analysis');
    expect(app).toContain('renderAudioAnalysis');
    expect(app).toContain('기존 곡 라벨 불러옴');
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
    expect(html).not.toContain('보컬 유형');
    expect(html).not.toContain('주요 분위기');
    expect(html).not.toContain('라벨 사용 목적');
    expect(html).not.toContain('노래와 랩이 섞임');
    expect(html).not.toContain('라벨 확신도');
    expect(html).toContain('Essentia 자동 분석');
    expect(html).toContain('자동 라벨은 이미 저장되어 있습니다');
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
