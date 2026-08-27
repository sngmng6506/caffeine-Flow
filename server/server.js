const http = require('http');
const { Server } = require('socket.io');
const { networkInterfaces } = require('os');

const { app, corsOriginCheck } = require('./app');
const { PORT } = require('./src/config');
const initSocket = require('./src/socket');
const { logError, CAUSE } = require('./src/observability');

// 지금까지 이 두 이벤트에 핸들러가 없어, 잡히지 않은 에러는 아무 기록도
// 남기지 못하고 프로세스만 사라졌다. 알림 이전에 최소한의 흔적을 남긴다.
process.on('uncaughtException', (error) => {
  logError({ code: 'UNCAUGHT_EXCEPTION', cause: CAUSE.PLATFORM, error });
  // 상태가 깨진 채로 계속 돌면 더 위험하다. 알림이 나갈 짧은 여유만 두고
  // 종료해 Railway가 새 인스턴스를 띄우게 한다.
  setTimeout(() => process.exit(1), 1000).unref();
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logError({ code: 'UNHANDLED_REJECTION', cause: CAUSE.PLATFORM, error });
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
