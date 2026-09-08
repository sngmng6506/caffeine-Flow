// 운영자 골드 라벨링의 조회·저장 로직.
//
// 라우트(routes/admin.js)에는 인증·입력 검증·응답만 남기고, DB 질의와 조립은
// 여기에 둔다. music-filter가 feature로 분리된 것과 같은 경계다.
//
// 계약은 docs/LLM_FILTER.md#평가-데이터셋과
// docs/AI_CHANGE_GUARDRAILS.md#music-filter-review-contract가 기준이다.
const db = require('../../db/knex');
const { FILTER_PROCESSED_STATUSES } = require('../../constants/music-filter-status');
const {
  ANNOTATION_CONFIRMATION,
  AUDIO_BULK_CONFIRM_MIN_CONFIDENCE,
  AUDIO_REVIEW_STATUS,
} = require('../../constants/audio-analysis');
const { MUSIC_LABEL_SCHEMA_VERSION } = require('../../constants/music-labeling');
const { normalizeArtistKey } = require('./annotation');

const LABELING_QUEUE_PAGE_SIZE = 50;
const CAFE_AUDIT_PAGE_SIZE = 50;

// `ambiguous`는 미완료 중에서 모델이 가장 헷갈린 순으로 본다. 귀로 확인할 곡을
// 위로 올려 두면, 나머지는 눈으로 훑고 넘길 수 있다.
const LABELING_VIEWS = Object.freeze(['unreviewed', 'reviewed', 'all', 'ambiguous']);

// 곡 라벨에 반드시 있어야 하는 칸. 하나라도 자동으로 못 채우면 일괄 확정 대상이 아니다.
const REQUIRED_ANNOTATION_FIELDS = Object.freeze([
  'tempo_class', 'rhythmic_character', 'instrumentation_type', 'vocal_type',
]);

// 큐와 집계에서 제외할 제목. 재생목록은 곡 단위 라벨링 대상이 아니다.
function excludePlaylists(query) {
  return query
    .whereNot((builder) => builder.whereILike('recommendation.title', '%playlist%'))
    .whereNot((builder) => builder.whereLike('recommendation.title', '%플리%'));
}

// 곡 라벨은 (platform, track_key) join으로 붙여오므로 결과 row에 annotation_*
// 컬럼이 평평하게 섞여 있다. 이를 중첩 객체로 되돌린다.
function attachLabelingContext(row) {
  const decision = { ...row };
  for (const key of Object.keys(row)) {
    if (key.startsWith('annotation_') || key.startsWith('analysis_')) delete decision[key];
  }
  const result = {
    ...decision,
    track_annotation: row.annotation_id ? {
      id: row.annotation_id,
      artist_name: row.annotation_artist_name,
      track_version: row.annotation_track_version,
      tempo_class: row.annotation_tempo_class,
      mood_tags: row.annotation_mood_tags,
      instrumentation_type: row.annotation_instrumentation_type,
      rhythmic_character: row.annotation_rhythmic_character,
      vocal_type: row.annotation_vocal_type,
      genre_tags: row.annotation_genre_tags,
      note: row.annotation_note,
      usage_scope: row.annotation_usage_scope,
      confirmation_mode: row.annotation_confirmation_mode,
      schema_version: row.annotation_schema_version,
      updated_at: row.annotation_updated_at,
    } : null,
    audio_analysis: row.analysis_id ? {
      id: row.analysis_id,
      model_name: row.analysis_model_name,
      model_version: row.analysis_model_version,
      feature_schema_version: row.analysis_feature_schema_version,
      features: row.analysis_features,
      suggested_annotation: row.analysis_suggested_annotation,
      review_status: row.analysis_review_status,
      analyzed_at: row.analysis_analyzed_at,
      reviewed_at: row.analysis_reviewed_at,
    } : null,
  };
  return result;
}

function joinTrackAnnotation() {
  this.on('annotation.platform', '=', 'recommendation.platform')
    .andOn('annotation.track_key', '=', 'recommendation.video_id');
}

// 모델을 여러 번 비교할 수 있으므로 곡별 최신 분석 한 건만 라벨링 큐에 붙인다.
// DISTINCT ON의 선두 정렬은 식별자와 같아야 하며, 같은 시각이면 UUID로 결정한다.
function latestAudioAnalysisQuery() {
  return db({ audio: 'music_audio_analyses' })
    .distinctOn('audio.platform', 'audio.track_key')
    .select(
      'audio.platform', 'audio.track_key', 'audio.id',
      'audio.model_name', 'audio.model_version', 'audio.feature_schema_version',
      'audio.features', 'audio.suggested_annotation', 'audio.review_status',
      'audio.analyzed_at', 'audio.reviewed_at',
    )
    .orderBy('audio.platform')
    .orderBy('audio.track_key')
    .orderBy('audio.analyzed_at', 'desc')
    .orderBy('audio.id', 'desc')
    .as('analysis');
}

function joinAudioAnalysis() {
  this.on('analysis.platform', '=', 'recommendation.platform')
    .andOn('analysis.track_key', '=', 'recommendation.video_id');
}

const QUEUE_COLUMNS = [
  'recommendation.id', 'recommendation.cafe_id', 'cafe.name as cafe_name',
  'recommendation.video_id', 'recommendation.title', 'recommendation.channel_title',
  'recommendation.platform', 'recommendation.filter_status', 'recommendation.filter_reason',
  'recommendation.filter_confidence', 'recommendation.filter_model',
  'recommendation.filter_error_code', 'recommendation.filter_prompt_snapshot',
  'recommendation.filter_checked_at', 'review.human_decision',
  'review.human_reason_code', 'review.metadata_sufficient', 'review.reviewed_at',
  'annotation.id as annotation_id',
  'annotation.artist_name as annotation_artist_name',
  'annotation.track_version as annotation_track_version',
  'annotation.tempo_class as annotation_tempo_class',
  'annotation.mood_tags as annotation_mood_tags',
  'annotation.instrumentation_type as annotation_instrumentation_type',
  'annotation.rhythmic_character as annotation_rhythmic_character',
  'annotation.vocal_type as annotation_vocal_type',
  'annotation.genre_tags as annotation_genre_tags',
  'annotation.note as annotation_note',
  'annotation.usage_scope as annotation_usage_scope',
  'annotation.confirmation_mode as annotation_confirmation_mode',
  'annotation.schema_version as annotation_schema_version',
  'annotation.updated_at as annotation_updated_at',
  'analysis.id as analysis_id',
  'analysis.model_name as analysis_model_name',
  'analysis.model_version as analysis_model_version',
  'analysis.feature_schema_version as analysis_feature_schema_version',
  'analysis.features as analysis_features',
  'analysis.suggested_annotation as analysis_suggested_annotation',
  'analysis.review_status as analysis_review_status',
  'analysis.analyzed_at as analysis_analyzed_at',
  'analysis.reviewed_at as analysis_reviewed_at',
];

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
async function fetchLabelingQueue({ view, offset }) {
  const processed = excludePlaylists(
    db({ recommendation: 'recommendations' })
      .whereIn('recommendation.filter_status', FILTER_PROCESSED_STATUSES),
  );

  const decisionsQuery = processed.clone()
    .leftJoin({ cafe: 'cafes' }, 'cafe.id', 'recommendation.cafe_id')
    .leftJoin({ review: 'music_filter_reviews' }, 'review.recommendation_id', 'recommendation.id')
    .leftJoin({ annotation: 'music_track_annotations' }, joinTrackAnnotation)
    .leftJoin(latestAudioAnalysisQuery(), joinAudioAnalysis);

  if (view === 'unreviewed' || view === 'ambiguous') {
    decisionsQuery.where((builder) => {
      builder
        .whereNull('review.recommendation_id')
        .orWhereNull('annotation.id')
        .orWhere('analysis.review_status', 'pending');
    });
  }
  if (view === 'reviewed') {
    decisionsQuery
      .whereNotNull('review.recommendation_id')
      .whereNotNull('annotation.id')
      .where((builder) => {
        builder.whereNull('analysis.id').orWhere('analysis.review_status', 'reviewed');
      });
  }

  const [totalRow, reviewedRow, decisionRows] = await Promise.all([
    processed.clone().count('recommendation.id as count').first(),
    processed.clone()
      .innerJoin({ review: 'music_filter_reviews' }, 'review.recommendation_id', 'recommendation.id')
      .innerJoin({ annotation: 'music_track_annotations' }, joinTrackAnnotation)
      .leftJoin(latestAudioAnalysisQuery(), joinAudioAnalysis)
      .where((builder) => {
        builder.whereNull('analysis.id').orWhere('analysis.review_status', 'reviewed');
      })
      .count('recommendation.id as count')
      .first(),
    decisionsQuery
      .select(QUEUE_COLUMNS)
      .modify((query) => {
        if (view !== 'ambiguous') {
          query.orderBy('recommendation.filter_checked_at', 'desc');
          return;
        }
        // 검수 신호가 붙은 곡이 먼저, 그다음 가장 약한 칸의 확률이 낮은 순.
        // 분석이 아직 없는 곡은 자동으로 채운 것이 없으므로 맨 뒤로 보낸다.
        query
          .orderByRaw(`
            (analysis.suggested_annotation -> 'review_flags') IS NOT NULL DESC,
            COALESCE((analysis.suggested_annotation ->> 'min_confidence')::float, 2) ASC,
            recommendation.filter_checked_at DESC
          `);
      })
      .orderBy('recommendation.id', 'desc')
      .offset(offset)
      .limit(LABELING_QUEUE_PAGE_SIZE + 1),
  ]);

  const total = Number(totalRow?.count || 0);
  const reviewed = Number(reviewedRow?.count || 0);
  const { page, has_more: hasMore, next_offset: nextOffset } =
    paginate(decisionRows, LABELING_QUEUE_PAGE_SIZE, offset);

  return {
    summary: { total, reviewed, unreviewed: Math.max(0, total - reviewed) },
    decisions: page.map(attachLabelingContext),
    view,
    offset,
    has_more: hasMore,
    next_offset: nextOffset,
  };
}

/**
 * 운영자가 확인한 아티스트의 다른 곡 라벨.
 *
 * 자동 동일인 판정이 아니라 참고 자료다. 현재 곡은 결과에서 제외한다.
 */
function fetchArtistLabels({ artistKey, platform, trackKey }) {
  return db('music_track_annotations')
    .where({ artist_key: artistKey })
    .modify((query) => {
      if (platform && trackKey) {
        query.whereNot((builder) => builder.where({ platform, track_key: trackKey }));
      }
    })
    .select(
      'id', 'title', 'artist_name', 'track_version', 'tempo_class', 'mood_tags',
      'instrumentation_type', 'rhythmic_character', 'vocal_type', 'genre_tags',
      'note', 'usage_scope', 'updated_at',
    )
    .orderBy('updated_at', 'desc')
    .limit(3);
}

/** 특정 카페의 AI 판단 이력과 프롬프트 변경 이력. */
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
}) {
  return db.transaction(async (trx) => {
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
      // pg 드라이버가 JS 배열을 PostgreSQL 배열 리터럴({"pop"})로 바꾸면
      // jsonb 컬럼에서 22P02가 발생한다. JSON 문자열로 타입을 명확히 한다.
      mood_tags: JSON.stringify(annotation.mood_tags),
      genre_tags: JSON.stringify(annotation.genre_tags),
      confirmation_mode: ANNOTATION_CONFIRMATION.REVIEWED,
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
        confirmation_mode: row.confirmation_mode,
        updated_at: row.updated_at,
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

/**
 * 일괄 확정 자격을 저장된 분석으로 다시 판정한다.
 *
 * 화면이 보낸 라벨 값을 그대로 받지 않는다. 목록에서 한 번에 확정하는 경로는
 * 사람이 각 값을 보지 않으므로, 무엇이 저장될지는 서버가 DB의 분석 결과에서
 * 직접 만들어야 한다.
 *
 * 자격을 잃는 경우:
 * - 자동 분석이 없거나 이미 검수됨
 * - 자동으로 못 채운 칸이 있거나 모델끼리 어긋남(review_flags)
 * - 가장 약한 칸의 확률이 문턱 미만
 * - 아티스트명을 알 수 없음
 */
function buildBulkAnnotation({ recommendation, analysis }) {
  if (!analysis || analysis.review_status !== AUDIO_REVIEW_STATUS.PENDING) {
    return { skipped: 'no_pending_analysis' };
  }

  const suggestion = analysis.suggested_annotation || {};
  if ((suggestion.review_flags || []).length > 0) {
    return { skipped: 'needs_listening' };
  }
  if (typeof suggestion.min_confidence !== 'number'
    || suggestion.min_confidence < AUDIO_BULK_CONFIRM_MIN_CONFIDENCE) {
    return { skipped: 'low_confidence' };
  }
  if (REQUIRED_ANNOTATION_FIELDS.some((field) => !suggestion[field])) {
    return { skipped: 'incomplete_suggestion' };
  }
  if (!Array.isArray(suggestion.mood_tags) || suggestion.mood_tags.length < 1) {
    return { skipped: 'incomplete_suggestion' };
  }

  // 아티스트명은 오디오에서 나오지 않는다. 플랫폼 채널명을 그대로 쓰되, 사람이
  // 확인한 값이 아니므로 일괄 확정분에만 허용한다.
  const artistName = (recommendation.channel_title || '').trim();
  if (!artistName) return { skipped: 'unknown_artist' };
  const artistKey = normalizeArtistKey(artistName);
  if (!artistKey) return { skipped: 'unknown_artist' };

  return {
    annotation: {
      artist_name: artistName.slice(0, 200),
      artist_key: artistKey.slice(0, 200),
      // 원곡·리메이크 구분은 음향으로 알 수 없다. 사람이 채울 몫으로 남긴다.
      track_version: 'unknown',
      tempo_class: suggestion.tempo_class,
      mood_tags: suggestion.mood_tags,
      instrumentation_type: suggestion.instrumentation_type,
      rhythmic_character: suggestion.rhythmic_character,
      vocal_type: suggestion.vocal_type,
      genre_tags: Array.isArray(suggestion.genre_tags) ? suggestion.genre_tags : [],
      note: null,
      usage_scope: 'operational',
      schema_version: MUSIC_LABEL_SCHEMA_VERSION,
    },
  };
}

/**
 * 자동 추천값을 곡 라벨로 한 번에 확정한다.
 *
 * 곡 라벨만 저장하고 매장 정책 판단(`music_filter_reviews`)은 건드리지 않는다.
 * 정책 판단은 매장 프롬프트에 달린 문제라 자동 분석이 대신할 수 없고, AI 판단을
 * 그대로 정답으로 복사하면 나중에 그 AI를 자기 출력으로 채점하게 된다.
 *
 * 이미 사람이 저장한 곡 라벨은 덮어쓰지 않는다.
 */
async function bulkConfirmAnnotations({ items }) {
  const confirmed = [];
  const skipped = [];

  for (const { cafeId, recommendationId } of items) {
    const recommendation = await db('recommendations')
      .where({ id: recommendationId, cafe_id: cafeId })
      .whereIn('filter_status', FILTER_PROCESSED_STATUSES)
      .select('id', 'platform', 'video_id', 'title', 'channel_title')
      .first();
    if (!recommendation) {
      skipped.push({ recommendation_id: recommendationId, reason: 'not_found' });
      continue;
    }

    const existing = await db('music_track_annotations')
      .where({ platform: recommendation.platform, track_key: recommendation.video_id })
      .select('id', 'confirmation_mode')
      .first();
    if (existing) {
      // 사람이 이미 고른 라벨을 자동값으로 밀어내지 않는다.
      skipped.push({ recommendation_id: recommendationId, reason: 'already_labeled' });
      continue;
    }

    const analysis = await db('music_audio_analyses')
      .where({ platform: recommendation.platform, track_key: recommendation.video_id })
      .select('id', 'suggested_annotation', 'review_status')
      .orderBy('analyzed_at', 'desc')
      .orderBy('id', 'desc')
      .first();

    const { annotation, skipped: reason } = buildBulkAnnotation({ recommendation, analysis });
    if (!annotation) {
      skipped.push({ recommendation_id: recommendationId, reason });
      continue;
    }

    const confirmedAt = new Date();
    await db.transaction(async (trx) => {
      await trx('music_track_annotations').insert({
        platform: recommendation.platform,
        track_key: recommendation.video_id,
        source_recommendation_id: recommendation.id,
        title: recommendation.title,
        ...annotation,
        mood_tags: JSON.stringify(annotation.mood_tags),
        genre_tags: JSON.stringify(annotation.genre_tags),
        confirmation_mode: ANNOTATION_CONFIRMATION.BULK,
        updated_at: confirmedAt,
      });
      await trx('music_audio_analyses')
        .where({ id: analysis.id, review_status: AUDIO_REVIEW_STATUS.PENDING })
        .update({
          review_status: AUDIO_REVIEW_STATUS.REVIEWED,
          reviewed_at: confirmedAt,
          updated_at: confirmedAt,
        });
    });

    confirmed.push({ recommendation_id: recommendationId, track_key: recommendation.video_id });
  }

  return { confirmed, skipped };
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
  LABELING_VIEWS,
  LABELING_QUEUE_PAGE_SIZE,
  CAFE_AUDIT_PAGE_SIZE,
  attachLabelingContext,
  fetchLabelingQueue,
  fetchArtistLabels,
  fetchCafeAudit,
  saveReview,
  bulkConfirmAnnotations,
  findReviewableRecommendation,
  findTrackAudioAnalysis,
};
