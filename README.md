# Caffeine Flow

카페 음악 신청 플랫폼.  
손님이 QR로 곡을 신청하고, 사장님이 수락/거절하는 구조.

## Stack

Node.js, Express, Socket.IO, PostgreSQL, React, Vite, Electron

## Setup

```bash
cp .env.example .env
cd server && npm install && npm run migrate
cd server && npm run dev
cd owner && npm run electron:dev
cd customer && npm run dev
```

## Deploy

- Server: Railway
- Owner app: `cd owner && npm run electron:build`

## License

MIT
