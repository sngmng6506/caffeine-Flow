const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const { PORT, CAFE_TOKEN } = require('./src/config');
const apiRouter  = require('./src/api');
const initSocket = require('./src/socket');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);

initSocket(io);

server.listen(PORT, () => {
  console.log(`\n🎵 Caffeine Flow running on http://localhost:${PORT}`);
  console.log(`   Customer: http://localhost:${PORT}/customer.html?token=${CAFE_TOKEN}`);
  console.log(`   Admin:    http://localhost:${PORT}/admin.html?token=${CAFE_TOKEN}\n`);
});
