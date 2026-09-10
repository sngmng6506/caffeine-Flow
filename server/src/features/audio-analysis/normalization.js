const taxonomy = require('../../constants/music-taxonomy.json');

function normalize(raw, rules = taxonomy) {
  const candidates = new Map();
  raw.classes.forEach((style, i) => {
    const label = rules.style_overrides[style] || rules.parent_mapping[style.split('---')[0]];
    const confidence = raw.mean[i];
    const threshold = rules.thresholds[style] ?? rules.default_threshold;
    if (label && confidence >= threshold && confidence > (candidates.get(label)?.confidence ?? -1)) {
      candidates.set(label, { label, source: 'maest', raw_label: style, confidence });
    }
  });
  return { taxonomy_version: rules.version, calibrated: rules.calibrated,
    genre: [...candidates.values()].sort((a, b) => b.confidence - a.confidence || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)).slice(0, rules.max_genres), mood: null };
}

function genreTags(normalized) {
  return normalized.genre.length ? normalized.genre.map((v) => v.label) : ['unknown'];
}

module.exports = { normalize, genreTags };
