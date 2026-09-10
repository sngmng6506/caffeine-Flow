const router = require('express').Router();
const { requireAudioAnalysisWorker } = require('../middleware/auth');
const { validateAudioAnalysisResult } = require('../features/audio-analysis/result');
const audioAnalysis = require('../features/audio-analysis/service');

// POST /api/v1/audio-analysis/results
// 권리가 확인된 로컬 파일을 분석한 워커가 특징값만 제출한다. 오디오 업로드는 받지 않는다.
router.post('/results', requireAudioAnalysisWorker, async (req, res) => {
  const result = validateAudioAnalysisResult(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  if (result.value.model_name === 'essentia-maest') return res.status(400).json({ error: 'MAEST는 작업 완료 API로 원본과 함께 제출해야 합니다' });
  const saved = await audioAnalysis.saveResult(result.value);
  res.status(201).json(saved);
});


const jobs = require('../features/audio-analysis/jobs');
const { isUuid } = require('../utils/validate');

router.post('/jobs/claim', requireAudioAnalysisWorker, async (_req, res) => {
  const job = await jobs.claim();
  if (!job) return res.status(204).end();
  res.json(job);
});

router.post('/jobs/:id/complete', requireAudioAnalysisWorker, async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.body?.lease_token)) return res.status(400).json({ error: '작업 식별자가 올바르지 않습니다' });
  const result = validateAudioAnalysisResult(req.body?.result);
  if (result.error) return res.status(400).json({ error: result.error });
  const scores = req.body?.tag_scores;
  if ((!req.body?.maest_run || scores !== undefined) && (!scores || typeof scores !== 'object' || Array.isArray(scores) || Object.keys(scores).length > 519 ||
      Object.entries(scores).some(([k, v]) => k.length > 120 || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1))) {
    return res.status(400).json({ error: '태그 점수가 올바르지 않습니다' });
  }
  const run = req.body?.maest_run;
  if (result.value.model_name === 'essentia-maest' || run) {
    const checked = require('../features/audio-analysis/runs').validateRun(run, result.value);
    if (checked.error) return res.status(400).json({ error: checked.error });
  }
  try {
    res.json(await jobs.complete(req.params.id, req.body.lease_token, result.value, req.body.automatic_annotation, scores, run));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post('/jobs/:id/fail', requireAudioAnalysisWorker, async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.body?.lease_token)) return res.status(400).json({ error: '작업 식별자가 올바르지 않습니다' });
  const { retry } = require('../constants/audio-pipeline.json');
  const codes = [...retry.infrastructure_codes, ...retry.permanent_codes, ...retry.temporary_codes, 'ANALYSIS_FAILED'];
  if (!codes.includes(req.body.error_code)) return res.status(400).json({ error: '실패 코드가 올바르지 않습니다' });
  try {
    res.json(await jobs.fail(req.params.id, req.body.lease_token, req.body.error_code));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
router.post('/jobs/:id/resume', requireAudioAnalysisWorker, async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.body?.lease_token)) return res.status(400).json({ error: '작업 식별자가 올바르지 않습니다' });
  try { res.json(await jobs.resume(req.params.id, req.body.lease_token)); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
});
const discovery = require('../features/audio-analysis/discovery');
const TRACK_KEY_MAX = 2000;

function validTracks(input) {
  if (!Array.isArray(input) || input.length > 200) return null;
  const seen = new Set();
  for (const track of input) {
    if (!track || typeof track !== 'object') return null;
    if (!['youtube', 'soundcloud'].includes(track.platform)) return null;
    if (typeof track.track_key !== 'string' || !track.track_key || track.track_key.length > TRACK_KEY_MAX) return null;
    if (typeof track.title !== 'string' || !track.title || track.title.length > 500) return null;
    if (track.artist_name !== undefined && typeof track.artist_name !== 'string') return null;
    const key = `${track.platform}:${track.track_key}`;
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return input;
}

// POST /api/v1/audio-analysis/discoveries/claim
router.post('/discoveries/claim', requireAudioAnalysisWorker, async (_req, res) => {
  const row = await discovery.claim();
  if (!row) return res.status(204).end();
  res.json(row);
});

router.post('/discoveries/:id/complete', requireAudioAnalysisWorker, async (req, res) => {
  if (!isUuid(req.params.id) || typeof req.body?.lease_token !== 'string') {
    return res.status(400).json({ error: '수집 결과가 올바르지 않습니다' });
  }
  const tracks = validTracks(req.body.tracks);
  if (!tracks) return res.status(400).json({ error: '수집한 곡 목록이 올바르지 않습니다' });
  try {
    res.json(await discovery.complete(req.params.id, req.body.lease_token, tracks));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post('/discoveries/:id/fail', requireAudioAnalysisWorker, async (req, res) => {
  if (!isUuid(req.params.id) || typeof req.body?.lease_token !== 'string'
      || typeof req.body?.error_code !== 'string') {
    return res.status(400).json({ error: '수집 실패 보고가 올바르지 않습니다' });
  }
  try {
    res.json(await discovery.fail(req.params.id, req.body.lease_token, req.body.error_code.slice(0, 80)));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

module.exports = router;
