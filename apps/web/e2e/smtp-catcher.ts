import net from 'node:net';

export type SmtpMessage = {
  from: string;
  to: string[];
  raw: string;
  text: string;
};

export type SmtpCatcher = {
  port: number;
  messages: SmtpMessage[];
  waitForMessage: (afterCount: number, timeoutMs?: number) => Promise<SmtpMessage>;
  close: () => Promise<void>;
};

function decodeBody(raw: string): string {
  const split = raw.indexOf('\r\n\r\n');
  const headers = (split === -1 ? '' : raw.slice(0, split)).toLowerCase();
  let body = split === -1 ? raw : raw.slice(split + 4);
  if (headers.includes('content-transfer-encoding: base64')) {
    return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  if (headers.includes('content-transfer-encoding: quoted-printable')) {
    body = body.replace(/=\r?\n/g, '');
    body = body.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
  return body;
}

/**
 * Minimal SMTP sink for auth-mail journeys. It advertises AUTH PLAIN/LOGIN
 * (nodemailer always sends credentials when the server offers AUTH), captures
 * each message and decodes quoted-printable / base64 bodies so tests can read
 * the verification code or reset link. No TLS, no relay — loopback only.
 */
export async function startSmtpCatcher(): Promise<SmtpCatcher> {
  const messages: SmtpMessage[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.write('220 localhost ESMTP nectarpush-qa\r\n');

    let buffer = '';
    let inData = false;
    let dataLines: string[] = [];
    let from = '';
    let to: string[] = [];
    let authStep = 0;

    const reply = (line: string) => socket.write(`${line}\r\n`);

    const finishMessage = () => {
      const raw = dataLines.join('\r\n');
      const subject = /^subject:\s*(.*)$/im.exec(raw)?.[1] ?? '';
      messages.push({
        from,
        to,
        raw,
        text: `${subject}\n${decodeBody(raw)}`,
      });
      inData = false;
      dataLines = [];
      from = '';
      to = [];
      reply('250 2.0.0 OK queued');
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');

        if (inData) {
          if (line === '.') finishMessage();
          else dataLines.push(line);
          continue;
        }

        if (authStep > 0) {
          // Continuation of AUTH PLAIN (empty challenge) or AUTH LOGIN.
          if (authStep === 1) {
            authStep = 2;
            reply('334 UGFzc3dvcmQ6');
          } else {
            authStep = 0;
            reply('235 2.7.0 Authentication successful');
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        } else if (upper.startsWith('AUTH PLAIN')) {
          if (line.split(' ').length >= 3) reply('235 2.7.0 Authentication successful');
          else {
            authStep = 2;
            reply('334 ');
          }
        } else if (upper.startsWith('AUTH LOGIN')) {
          authStep = 1;
          reply('334 VXNlcm5hbWU6');
        } else if (upper.startsWith('MAIL FROM')) {
          from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          reply('250 2.1.0 OK');
        } else if (upper.startsWith('RCPT TO')) {
          const target = /<([^>]*)>/.exec(line)?.[1];
          if (target) to.push(target);
          reply('250 2.1.5 OK');
        } else if (upper.startsWith('DATA')) {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (upper.startsWith('RSET') || upper.startsWith('NOOP')) {
          reply('250 2.0.0 OK');
        } else if (upper.startsWith('QUIT')) {
          reply('221 2.0.0 Bye');
          socket.end();
        } else {
          reply('250 2.0.0 OK');
        }
      }
    });

    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SMTP catcher failed to bind');

  return {
    port: address.port,
    messages,
    async waitForMessage(afterCount, timeoutMs = 15_000): Promise<SmtpMessage> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (messages.length > afterCount) return messages[messages.length - 1];
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`no SMTP message arrived within ${timeoutMs}ms`);
    },
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}