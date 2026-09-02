const http = require('http');
const { Server } = require('socket.io');
const { networkInterfaces } = require('os');

const { app, corsOriginCheck } = require('./app');
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
});
