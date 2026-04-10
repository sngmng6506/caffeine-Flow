function initSocket(io) {
  const cafeNsp = io.of('/cafe');

  cafeNsp.on('connection', (socket) => {
    const slug = socket.handshake.query.slug;
    if (!slug) return socket.disconnect();

    socket.join(slug);
  });
}

module.exports = initSocket;
