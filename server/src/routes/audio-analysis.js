const router = require('express').Router();
const { requireAudioAnalysisWorker } = require('../middleware/auth');
const { validateAudioAnalysisResult } = require('../features/audio-analysis/result');
const audioAnalysis = require('../features/audio-analysis/service');

// POST /api/v1/audio-analysis/results
// 권리가 확인된 로컬 파일을 분석한 워커가 특징값만 제출한다. 오디오 업로드는 받지 않는다.
router.post('/results', requireAudioAnalysisWorker, async (req, res) => {
  const result = validateAudioAnalysisResult(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const saved = await audioAnalysis.saveResult(result.value);
  res.status(201).json(saved);
});

module.exports = router;
