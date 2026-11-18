/** Minimal RESP2 client for the integration test against a real redis-server (dev/CI only, never bundled). */
import net from 'node:net';
import type { Eval } from './store.ts';

type Reply = string | number | null | Reply[] | Error;

function encode(args: readonly (string | number)[]): string {
  return `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('')}`;
}

function parse(buf: Buffer, i = 0): [Reply, number] | null {
  const end = buf.indexOf('\r\n', i);
  if (end === -1) return null;
  const type = String.fromCharCode(buf[i]!);
  const line = buf.toString('utf8', i + 1, end);
  const next = end + 2;
  switch (type) {
    case '+':
      return [line, next];
    case '-':
      return [new Error(line), next];
    case ':':
      return [Number(line), next];
    case '$': {
      const len = Number(line);
      if (len === -1) return [null, next];
      if (buf.length < next + len + 2) return null;
      return [buf.toString('utf8', next, next + len), next + len + 2];
    }
    case '*': {
      const n = Number(line);
      if (n === -1) return [null, next];
      const out: Reply[] = [];
      let at = next;
      for (let k = 0; k < n; k++) {
        const r = parse(buf, at);
        if (!r) return null;
        out.push(r[0]);
        at = r[1];
      }
      return [out, at];
    }
  }
  throw new Error(`bad reply ${type}`);
}

export function respClient(url: string) {
  const u = new URL(url);
  const sock = net.connect(Number(u.port || 6379), u.hostname);
  let buf = Buffer.alloc(0);
  const waiting: ((r: Reply) => void)[] = [];
  sock.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const r = parse(buf);
      if (!r) break;
      buf = buf.subarray(r[1]);
      waiting.shift()?.(r[0]);
    }
  });
  const command = (args: readonly (string | number)[]) =>
    new Promise<Reply>((resolve, reject) => {
      waiting.push((r) => (r instanceof Error ? reject(r) : resolve(r)));
      sock.write(encode(args));
    });
  const evaluate: Eval = (script, keys, args) => command(['EVAL', script, keys.length, ...keys, ...args]);
  return { command, evaluate, close: () => sock.end() };
}
