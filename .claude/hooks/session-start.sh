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
#
# 루트도 설치한다. `npm run lint:labs`(운영자 Lab ESLint)가 루트 devDependencies를
# 쓰고 CI도 별도 단계로 설치하는데, 여기서 빠져 있으면 세션에서만 못 돌린다.
for app in . server customer owner; do
  echo "[session-start] npm install --prefix $app"
  npm install --prefix "$app" --no-audit --no-fund
done

# 통합 테스트용 컨테이너 전용 PostgreSQL. 없으면 `npm test --prefix server`가
# 돌지 않아 DB 비의존 테스트만 확인하게 되고, 통합 테스트에서만 드러나는 실패가
# CI에서 처음 발견된다. 컨테이너 안의 빈 DB이므로 migrate가 공유 DB 금지 규칙에
# 걸리지 않는다(docs/AI_CHANGE_GUARDRAILS.md#migration-contract).
#
# DB 준비는 실패해도 세션을 막지 않는다 — 의존성만 있어도 대부분의 작업은 된다.
setup_test_db() {
  if ! command -v pg_ctlcluster >/dev/null 2>&1; then
    echo "[session-start] PostgreSQL이 없어 통합 테스트용 DB를 건너뛴다"
    return 0
  fi

  if ! pg_isready -q; then
    local cluster
    cluster=$(pg_lsclusters -h 2>/dev/null | awk 'NR==1 {print $1, $2}')
    [ -n "$cluster" ] || { echo "[session-start] PostgreSQL 클러스터가 없다"; return 0; }
    # shellcheck disable=SC2086
    pg_ctlcluster $cluster start || true
  fi

  if ! pg_isready -q; then
    echo "[session-start] PostgreSQL을 띄우지 못해 통합 테스트용 DB를 건너뛴다"
    return 0
  fi

  # CI와 docs/DEVELOPMENT.md가 쓰는 접속 정보에 맞춘다.
  su postgres -c "psql -tAc \"ALTER USER postgres PASSWORD 'test'\"" >/dev/null
  if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='caffeine_test'\"" | grep -q 1; then
    su postgres -c "createdb caffeine_test"
  fi

  # knexfile이 루트 .env를 읽는다. 매번 인라인 환경변수를 붙이지 않아도 되게
  # 테스트 전용 값을 넣어 둔다. .env는 .gitignore 대상이라 커밋되지 않는다.
  # 이미 있으면 건드리지 않는다 — 사람이 넣어 둔 값을 덮어쓰지 않기 위해서다.
  if [ ! -f .env ]; then
    {
      echo "# 세션 시작 훅이 만든 컨테이너 전용 테스트 설정. 운영 값이 아니다."
      echo "DATABASE_URL=postgres://postgres:test@localhost:5432/caffeine_test"
      echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    } > .env
    echo "[session-start] 테스트용 .env 생성"
  fi

  echo "[session-start] 통합 테스트용 PostgreSQL 준비 완료"
}

setup_test_db || echo "[session-start] 통합 테스트용 DB 준비 실패 — 의존성만으로 계속한다"

echo "[session-start] 준비 완료"
