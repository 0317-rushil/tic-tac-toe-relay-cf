export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/' && request.headers.get('Upgrade') !== 'websocket') {
      return new Response('tic-tac-toe relay ok\n');
    }

    const code = (url.searchParams.get('room') || '').trim().toUpperCase();
    if (!code) {
      return new Response('missing room code', { status: 400 });
    }

    const id = env.ROOMS.idFromName(code);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    this.sockets = new Map(); // role -> WebSocket
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    if (this.sockets.size >= 2) {
      return new Response('room full', { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const role = this.sockets.has('X') ? 'O' : 'X';
    const otherRole = role === 'X' ? 'O' : 'X';
    this.sockets.set(role, server);

    const safeSend = (ws, payload) => {
      try { ws.send(payload); } catch (err) { /* peer already gone */ }
    };

    safeSend(server, JSON.stringify({ type: 'assigned', role }));
    const other = this.sockets.get(otherRole);
    if (other) {
      safeSend(other, JSON.stringify({ type: 'peer-joined' }));
      safeSend(server, JSON.stringify({ type: 'peer-joined' }));
    }

    server.addEventListener('message', (evt) => {
      const peer = this.sockets.get(otherRole);
      if (peer) safeSend(peer, evt.data);
    });

    const cleanup = () => {
      if (this.sockets.get(role) === server) this.sockets.delete(role);
      const peer = this.sockets.get(otherRole);
      if (peer) safeSend(peer, JSON.stringify({ type: 'peer-left' }));
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }
}
