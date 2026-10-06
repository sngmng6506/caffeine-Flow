// 운영자 콘솔의 카페별 AI 판단 기록 조회와 사람 검수 저장.
//
// 라우트(routes/admin.js)에는 인증·입력 검증·응답만 남기고, DB 질의와 조립은
// 여기에 둔다. music-filter가 feature로 분리된 것과 같은 경계다.
//
// 계약은 docs/LLM_FILTER.md#평가-데이터셋과
// docs/AI_CHANGE_GUARDRAILS.md#music-filter-review-contract가 기준이다.
const db = require('../../db/knex');
const { FILTER_PROCESSED_STATUSES } = require('../../constants/music-filter-status');

const CAFE_AUDIT_PAGE_SIZE = 50;

const CAFE_AUDIT_COLUMNS = [
  'recommendation.id', 'recommendation.video_id', 'recommendation.title',
  'recommendation.channel_title', 'recommendation.platform',
  'recommendation.filter_status', 'recommendation.filter_reason',
  'recommendation.filter_confidence', 'recommendation.filter_model',
  'recommendation.filter_error_code',
  'recommendation.filter_prompt_snapshot', 'recommendation.filter_checked_at',
  'review.human_decision', 'review.human_reason_code',
  'review.metadata_sufficient', 'review.reviewed_at',
];

function paginate(rows, pageSize, offset) {
  const hasMore = rows.length > pageSize;
  return {
    page: rows.slice(0, pageSize),
    has_more: hasMore,
    next_offset: hasMore ? offset + pageSize : null,
  };
}

/**
 * 전체 카페를 가로지르는 라벨링 큐.
 *
 * 완료의 정의는 "정책 검수와 곡 라벨이 있고 최신 자동 분석도 검수됨"이다.
 * 자동 분석이 없는 곡은 기존처럼 정책 검수와 곡 라벨만으로 완료다.
 */
async function fetchCafeAudit({ cafeId, offset }) {
  const [promptHistory, decisionRows] = await Promise.all([
    db('music_filter_prompt_history')
      .where({ cafe_id: cafeId })
      .select('id', 'enabled', 'prompt', 'record_type', 'recorded_at')
      .orderBy('recorded_at', 'desc')
      .orderBy('id', 'desc')
      .limit(50),
    db({ recommendation: 'recommendations' })
      .leftJoin({ review: 'music_filter_reviews' }, 'review.recommendation_id', 'recommendation.id')
      .where('recommendation.cafe_id', cafeId)
      .whereIn('recommendation.filter_status', FILTER_PROCESSED_STATUSES)
      .select(CAFE_AUDIT_COLUMNS)
      .orderBy('recommendation.filter_checked_at', 'desc')
      .orderBy('recommendation.id', 'desc')
      .offset(offset)
      .limit(CAFE_AUDIT_PAGE_SIZE + 1),
  ]);

  const { page, has_more: hasMore, next_offset: nextOffset } =
    paginate(decisionRows, CAFE_AUDIT_PAGE_SIZE, offset);
  return { prompt_history: promptHistory, decisions: page, has_more: hasMore, next_offset: nextOffset };
}

/**
 * 정책 검수와 곡 라벨, 화면에 표시한 자동 분석 검수 상태를 한 트랜잭션으로 반영한다.
 *
 * 둘을 따로 저장하면 한쪽만 남은 항목이 생겨 완료 집계가 어긋난다.
 * AI 판단(`recommendations.filter_status`)과 큐 상태는 건드리지 않는다.
 */
function saveReview({
  recommendation,
  humanDecision,
  humanReasonCode,
  metadataSufficient,
  annotation,
  audioAnalysisId,
  audioAnalysisRevision,
  artistConfirmed = false,
}) {
  return db.transaction(async (trx) => {
    if (audioAnalysisId) {
      const analysis = await trx('music_audio_analyses').where({ id: audioAnalysisId,
        platform: recommendation.platform, track_key: recommendation.video_id }).forUpdate().first();
      if (!analysis || analysis.revision !== audioAnalysisRevision) {
        throw Object.assign(new Error('분석 결과가 갱신되었습니다. 다시 불러와주세요.'), { status: 409 });
      }
    }
    const reviewedAt = new Date();
    const [savedReview] = await trx('music_filter_reviews')
      .insert({
        recommendation_id: recommendation.id,
        human_decision: humanDecision,
        human_reason_code: humanReasonCode,
        metadata_sufficient: metadataSufficient,
        reviewed_at: reviewedAt,
      })
      .onConflict('recommendation_id')
      .merge({
        human_decision: humanDecision,
        human_reason_code: humanReasonCode,
        metadata_sufficient: metadataSufficient,
        reviewed_at: reviewedAt,
      })
      .returning('*');

    if (!annotation) return { ...savedReview, track_annotation: null };

    const row = {
      platform: recommendation.platform,
      track_key: recommendation.video_id,
      source_recommendation_id: recommendation.id,
      title: recommendation.title,
      ...annotation,
      artist_confirmed: artistConfirmed,
      label_source: 'human', human_edited: true,
      human_review_status: 'corrected',
      // pg 드라이버가 JS 배열을 PostgreSQL 배열 리터럴({"pop"})로 바꾸면
      // jsonb 컬럼에서 22P02가 발생한다. JSON 문자열로 타입을 명확히 한다.
      mood_tags: JSON.stringify(annotation.mood_tags),
      genre_tags: JSON.stringify(annotation.genre_tags),
      updated_at: reviewedAt,
    };
    const [savedAnnotation] = await trx('music_track_annotations')
      .insert(row)
      .onConflict(['platform', 'track_key'])
      .merge({
        source_recommendation_id: row.source_recommendation_id,
        title: row.title,
        artist_name: row.artist_name,
        artist_key: row.artist_key,
        track_version: row.track_version,
        tempo_class: row.tempo_class,
        mood_tags: row.mood_tags,
        instrumentation_type: row.instrumentation_type,
        rhythmic_character: row.rhythmic_character,
        vocal_type: row.vocal_type,
        genre_tags: row.genre_tags,
        note: row.note,
        usage_scope: row.usage_scope,
        schema_version: row.schema_version,
        updated_at: row.updated_at,
        artist_confirmed: artistConfirmed,
        label_source: 'human', human_edited: true,
        human_review_status: 'corrected',
        revision: trx.raw('music_track_annotations.revision + 1'),
      })
      .returning('*');

    // 자동 분석값은 참고 자료다. 수동 곡 라벨을 저장한 시점을 해당 분석의
    // 검수 완료로 기록하되, 자동값 자체나 과거 모델 결과를 덮어쓰지 않는다.
    if (audioAnalysisId) {
      await trx('music_audio_analyses')
        .where({
          id: audioAnalysisId,
          platform: recommendation.platform,
          track_key: recommendation.video_id,
          review_status: 'pending',
        })
        .update({ review_status: 'reviewed', reviewed_at: reviewedAt, updated_at: reviewedAt });
    }

    return { ...savedReview, track_annotation: savedAnnotation };
  });
}

/** 검수 대상 추천곡을 (cafeId, recommendationId) 범위로 조회한다. */
function findReviewableRecommendation({ cafeId, recommendationId }) {
  return db('recommendations')
    .where({ id: recommendationId, cafe_id: cafeId })
    .whereIn('filter_status', FILTER_PROCESSED_STATUSES)
    .select('id', 'platform', 'video_id', 'title', 'channel_title')
    .first();
}

/** 화면에 표시한 분석 ID가 같은 플랫폼 원본 곡에 속하는지 확인한다. */
function findTrackAudioAnalysis({ audioAnalysisId, platform, trackKey }) {
  return db('music_audio_analyses')
    .where({ id: audioAnalysisId, platform, track_key: trackKey })
    .select('id')
    .first();
}

module.exports = {
  fetchCafeAudit,
  saveReview,
  findReviewableRecommendation,
  findTrackAudioAnalysis,
};
