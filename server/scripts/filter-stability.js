// 음악 필터 판정이 서술에 따라 뒤집히는지 잰다. 저장은 하지 않는다.
//
// Audio LLM 서술은 곡당 한 번 만들어져 캐시된다(music_audio_analyses는 카페가 아니라
// (platform, track_key)로 키를 잡는다). 그래서 서술이 실행마다 달라지는 것은 손님이
// 다시 신청할 때 흔들림으로 나타나지 않는다 — 그 곡이 어떤 서술을 뽑았는지로 한 번
// 정해지고 그대로 굳는다. 로터리다.
//
// 그래서 두 가지를 따로 잰다.
//   A. 서술 로터리 — 같은 곡의 서로 다른 서술들로 각각 판정한다. 뽑기 결과가 판정을
//      바꾸면, 그 곡의 통과 여부는 분석하던 날의 운이 정한 것이 된다.
//   B. 필터 자체 흔들림 — 서술 하나를 고정하고 반복 호출한다. A에서 본 차이가 서술
//      때문인지 필터의 기본 잡음인지 가르는 기준선이다. 필터는 temperature 0이라
//      여기서 갈리는 것이 거의 없어야 정상이다.
//
// 사용:
//   OPENROUTER_API_KEY=... node server/scripts/filter-stability.js \
//     --benchmark ./audio-llm-benchmark-v2.json \
//     --title '곡 제목' --policy '매장 분위기 설명' [--repeats 5] [--output out.json]
const fs = require('fs');
const path = require('path');

// config는 서버 부팅용이라 JWT_SECRET·DATABASE_URL이 없으면 로드 단계에서 죽는다.
// 이 스크립트는 DB를 건드리지 않으므로(분석을 직접 넘긴다) 자리만 채운다.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'filter-stability-script-placeholder-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused';

const { buildMusicFilterMessages } = require('../src/features/music-filter/prompt.builder');
const { callMusicFilterLlm } = require('../src/features/music-filter/llm.client');
const { normalizeLlmDecision } = require('../src/features/music-filter/decision.policy');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`알 수 없는 인자: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

// 같은 서술을 여러 번 재지 않는다. 벤치마크는 같은 전략을 반복하므로 문구가 겹칠 수
// 있고, 겹친 것을 그대로 세면 자주 나온 서술이 분포를 끌어당긴다.
function distinctDescriptions(report) {
  const seen = new Map();
  for (const run of report.runs || []) {
    if (run.status !== 'completed' || !run.description) continue;
    const key = run.description.trim();
    if (seen.has(key)) continue;
    seen.set(key, {
      strategy: run.strategy,
      description: key,
      mood: run.mood || [],
      instruments: run.instruments || [],
      vocal: run.vocal || [],
      // 필터의 `밝기·활력` 칸은 0~1 스케일이다. Essentia V/A(report 최상위, 곡당 한
      // 값)를 우선 쓰고, 없으면 LLM이 직접 낸 값으로 떨어진다. 둘 다 없으면 그 줄은
      // 렌더되지 않는다 — 1단을 통째로 뺀 구성이 된다.
      valence: report.valence ?? run.brightness ?? null,
      arousal: report.arousal ?? run.energy ?? null,
    });
  }
  return [...seen.values()];
}

async function judge(track, policy, analysis) {
  const messages = buildMusicFilterMessages({ cafePrompt: policy, track, analysis });
  const { result, model } = await callMusicFilterLlm(messages);
  const decision = normalizeLlmDecision(result);
  return { action: decision.action, reason: decision.reason, confidence: decision.confidence, model };
}

function tally(verdicts) {
  const counts = {};
  for (const v of verdicts) counts[v] = (counts[v] || 0) + 1;
  const total = verdicts.length;
  const top = Math.max(0, ...Object.values(counts));
  return { counts, total, flipped: total > 0 && top !== total };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['benchmark', 'title', 'policy']) {
    if (!args[required]) throw new Error(`--${required}가 필요합니다`);
  }
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY가 필요합니다');

  const report = JSON.parse(fs.readFileSync(path.resolve(args.benchmark), 'utf8'));
  const variants = distinctDescriptions(report);
  if (!variants.length) throw new Error('벤치마크에 성공한 서술이 없습니다');

  const track = {
    platform: report.input?.platform || 'youtube',
    title: args.title,
    channelTitle: args.artist || 'unknown',
    duration: report.input?.duration_sec ? Math.round(report.input.duration_sec) : 'unknown',
  };

  // A. 서술 로터리
  const lottery = [];
  for (const variant of variants) {
    const verdict = await judge(track, args.policy, variant);
    lottery.push({ strategy: variant.strategy, instruments: variant.instruments,
      valence: variant.valence, arousal: variant.arousal, ...verdict,
      description: variant.description.slice(0, 120) });
    console.log(JSON.stringify({ phase: 'lottery', strategy: variant.strategy,
      action: verdict.action, confidence: verdict.confidence,
      instruments: variant.instruments,
      valence: variant.valence, arousal: variant.arousal }, null, 0));
  }

  // B. 필터 자체 흔들림 — 서술 하나를 고정한다.
  const repeats = Number(args.repeats || 5);
  const fixed = variants[0];
  const baseline = [];
  for (let i = 0; i < repeats; i += 1) {
    const verdict = await judge(track, args.policy, fixed);
    baseline.push(verdict);
    console.log(JSON.stringify({ phase: 'baseline', repeat: i + 1, action: verdict.action }, null, 0));
  }

  const summary = {
    track: { ...track, source_url: report.input?.source_url },
    policy: args.policy,
    lottery: { variants: variants.length, ...tally(lottery.map((v) => v.action)) },
    baseline: { repeats, ...tally(baseline.map((v) => v.action)) },
  };
  console.log(JSON.stringify(summary, null, 2));

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output),
      JSON.stringify({ created_at: new Date().toISOString(), summary, lottery, baseline }, null, 2));
    console.log(`저장: ${args.output}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
