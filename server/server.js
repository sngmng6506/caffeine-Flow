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
function crashAfterLogging(code, error) {
  logError({ code, cause: CAUSE.PLATFORM, error });
  // 웹훅 전송 타임아웃보다 길게 기다린다. 가장 심각한 알림이 전송 도중
  // 잘리면 안 된다. unref하지 않는 이유도 같다 — listen 이전 크래시에서
  // 이벤트 루프가 비어 exit code 0으로 조용히 끝나는 것을 막는다.
  // 알림이 꺼져 있으면 기다릴 이유가 없으므로 바로 종료한다.
  if (!alertsEnabled) process.exit(1);
  setTimeout(() => process.exit(1), CRASH_EXIT_DELAY_MS);
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
