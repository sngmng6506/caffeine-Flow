const http = require('http');
const { Server } = require('socket.io');
const { networkInterfaces } = require('os');

const { app, corsOriginCheck, ALLOWED_ORIGINS } = require('./app');
const { PORT } = require('./src/config');
const initSocket = require('./src/socket');
const { logError, CAUSE, CRASH_EXIT_DELAY_MS, alertsEnabled } = require('./src/observability');

// 지금까지 이 두 이벤트에 핸들러가 없어, 잡히지 않은 에러는 아무 기록도
// 남기지 못하고 프로세스만 사라졌다. 기록을 남기되 Node의 기본 동작인
// "죽는다"는 그대로 유지한다. 핸들러를 등록하는 것만으로 기본 크래시가
// 꺼지므로, 로그만 남기고 살려두면 상태가 깨진 프로세스가 계속 도는 대신
// 자동 재시작을 잃는다.
// stderr flush에 필요한 최소 시간
const FLUSH_DELAY_MS = 100;

function crashAfterLogging(code, error) {
  logError({ code, cause: CAUSE.PLATFORM, error });
  // 같은 tick에서 process.exit()을 부르면 stderr가 파이프인 배포에서 방금 찍은
  // 로그와 스택이 flush 전에 잘린다. 핸들러를 둔 목적이 사라지므로 최소한의
  // 여유를 준다. 알림이 켜져 있으면 웹훅 전송 타임아웃보다 길게 기다린다.
  //
  // exitCode를 함께 세팅하는 이유는 listen 이전 크래시 때문이다. 그때는
  // 이벤트 루프가 비어 타이머 전에 종료되는데, 그래도 0이 아닌 코드로 끝나야
  // Railway가 실패로 인식한다.
  process.exitCode = 1;
  setTimeout(() => process.exit(1), alertsEnabled ? CRASH_EXIT_DELAY_MS : FLUSH_DELAY_MS);
}

process.on('uncaughtException', (error) => {
  crashAfterLogging('UNCAUGHT_EXCEPTION', error);
});

process.on('unhandledRejection', (reason) => {
  crashAfterLogging('UNHANDLED_REJECTION', reason instanceof Error ? reason : new Error(String(reason)));
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: corsOriginCheck, credentials: false },
});

// io를 라우트에서 참조할 수 있도록 등록
app.set('io', io);

initSocket(io);

server.listen(PORT, async () => {
  const nets = networkInterfaces();
  let localIp = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) { localIp = net.address; break; }
    }
  }

  app.set('baseUrl', `http://${localIp}:${PORT}`);
  console.log(`\nCaffeine Flow v2 on http://${localIp}:${PORT}\n`);

  // 운영 동작이 갈리는 설정을 한 줄로 남긴다.
  //
  // 알림·CORS·쿠키 Secure·rate limit이 모두 NODE_ENV와 ALERT_WEBHOOK_URL에
  // 걸려 있는데, 잘못 설정된 상태와 정상 상태가 겉으로 똑같이 조용하다.
  // 배포 로그 한 줄로 판정할 수 있게 실제 적용된 값을 찍는다.
  // 시크릿은 넣지 않는다 — 켜짐/꺼짐과 개수만으로 충분하다.
  const nodeEnv = process.env.NODE_ENV || '(미설정)';
  const devOrigins = [...ALLOWED_ORIGINS].filter(origin => origin.includes('localhost'));
  console.log(
    `  NODE_ENV=${nodeEnv} · 에러 알림 ${alertsEnabled ? '켜짐' : '꺼짐'}`
    + ` · 허용 origin ${ALLOWED_ORIGINS.size}개${devOrigins.length ? ` (개발 localhost ${devOrigins.length}개 포함)` : ''}\n`,
  );

  // NODE_ENV가 없으면 "운영이 아님"으로 취급돼 개발 localhost origin이 열리고,
  // 아래 알림 경고까지 조용해진다. 값이 없을 때야말로 알려야 한다.
  if (!process.env.NODE_ENV) {
    console.warn(
      '[config] NODE_ENV가 설정되지 않았다. 운영이 아닌 것으로 취급돼 개발 localhost origin이 허용된다. '
      + '배포 환경이라면 NODE_ENV=production을 설정한다.',
    );
  }

  // 알림은 프로세스 시작 시 읽은 ALERT_WEBHOOK_URL 하나로 켜지고 꺼진다.
  // 배포 후 변수를 추가만 하고 재시작하지 않으면 코드가 다 있어도 한 통도
  // 나가지 않는데, 그 상태는 "조용한 운영"과 구분되지 않는다.
  //
  // production만 보면 NODE_ENV가 빠졌을 때 함께 조용해진다 — 이번에 그랬다.
  // 그래서 "알림이 필요 없는 게 분명한 환경"만 제외한다. 로컬은 nodemon이
  // 저장마다 재시작하므로 경고를 띄우면 소음이 된다.
  const localOnly = ['development', 'test'].includes(process.env.NODE_ENV);
  if (!alertsEnabled && !localOnly) {
    console.warn(
      '[observability] ALERT_WEBHOOK_URL이 없어 운영자 에러 알림이 꺼져 있다. '
      + '에러는 로그에만 남는다. 변수를 추가했다면 이 프로세스가 그 뒤에 시작됐는지 확인한다.',
    );
  }
});
