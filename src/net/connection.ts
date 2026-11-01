import { type ClientMessage, type ServerMessage, parseServerMessage } from './protocol';

export interface ConnectionHandlers {
  onOpen: () => void;
  onMessage: (message: ServerMessage) => void;
  onClose: () => void;
}

// Same origin as the page: the Vite dev server proxies /ws, and in production the game server serves both.
export function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export class Connection {
  private readonly socket: WebSocket;
  private closedByUs = false;

  constructor(handlers: ConnectionHandlers, url = socketUrl()) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => handlers.onOpen());
    this.socket.addEventListener('message', (event) => {
      const message = typeof event.data === 'string' ? parseServerMessage(event.data) : null;
      if (message) handlers.onMessage(message);
    });
    // Only report drops we did not cause ourselves.
    this.socket.addEventListener('close', () => {
      if (!this.closedByUs) handlers.onClose();
    });
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closedByUs = true;
    this.socket.close();
  }
}
