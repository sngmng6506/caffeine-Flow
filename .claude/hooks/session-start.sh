#!/bin/bash
# 웹 세션은 매번 새로 클론되므로 node_modules가 없다. 그대로 두면 세션마다
# 첫 lint·test가 "패키지를 찾을 수 없음"으로 실패하고, 그게 실제 결함인지
# 설치 누락인지 구분하는 데 시간이 든다.
#
# 로컬 개발자는 이미 설치돼 있으므로 원격 세션에서만 실행한다.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# npm ci가 아니라 npm install을 쓴다 — 컨테이너 상태가 캐시되므로
# 이미 최신이면 install은 사실상 no-op이고, ci는 매번 node_modules를 지운다.
for app in server customer owner; do
  echo "[session-start] npm install --prefix $app"
  npm install --prefix "$app" --no-audit --no-fund
done

echo "[session-start] 의존성 설치 완료"
