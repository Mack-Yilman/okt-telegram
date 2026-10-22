// Fakes de KV, Workers AI y la Bot API de Telegram para las pruebas.

import type { Env } from '../src/env';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function fakeKv() {
  const m = new Map<string, { v: string; ttl?: number }>();
  return {
    m,
    async get(k: string, type?: string) {
      const e = m.get(k);
      if (e === undefined) return null;
      return type === 'json' ? JSON.parse(e.v) : e.v;
    },
    async put(k: string, v: string, opts?: { expirationTtl?: number }) {
      m.set(k, { v, ttl: opts?.expirationTtl });
    },
    async delete(k: string) {
      m.delete(k);
    },
    // Como KV: claves en orden lexicográfico, páginas con cursor opaco.
    async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
      const todas = [...m.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
      const desde = Number(opts.cursor ?? 0);
      const limite = opts.limit ?? 1000;
      const keys = todas.slice(desde, desde + limite).map((name) => ({ name }));
      const completo = desde + limite >= todas.length;
      return completo ? { keys, list_complete: true } : { keys, list_complete: false, cursor: String(desde + limite) };
    },
  };
}

export function fakeAi(respuesta: { text?: string } | Error = { text: 'Texto transcrito de prueba' }) {
  const llamadas: any[] = [];
  return {
    llamadas,
    async run(modelo: string, entrada: any) {
      llamadas.push({ modelo, entrada });
      if (respuesta instanceof Error) throw respuesta;
      return respuesta;
    },
  };
}

export interface Enviado {
  chat_id: string;
  text: string;
}

// Bot API falsa: sendMessage, setWebhook…, getFile y la descarga de archivos.
export function fakeTelegram(archivos: Record<string, { path: string; bytes: string; size?: number }> = {}) {
  const enviados: Enviado[] = [];
  const metodos: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const descarga = /\/file\/bot[^/]+\/(.+)$/.exec(url);
    if (descarga) {
      const a = Object.values(archivos).find((x) => x.path === descarga[1]);
      return a ? new Response(a.bytes, { headers: { 'content-type': 'application/octet-stream' } }) : new Response('no', { status: 404 });
    }
    const metodo = url.split('/').pop()!;
    metodos.push(metodo);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (metodo === 'sendMessage') {
      enviados.push({ chat_id: String(body.chat_id), text: body.text });
      return Response.json({ ok: true, result: { message_id: enviados.length } });
    }
    if (metodo === 'getFile') {
      const a = archivos[body.file_id];
      if (!a) return Response.json({ ok: false, description: 'Bad Request: invalid file_id' }, { status: 400 });
      return Response.json({ ok: true, result: { file_id: body.file_id, file_path: a.path, file_size: a.size ?? a.bytes.length } });
    }
    return Response.json({ ok: true, result: true });
  }) as typeof fetch;
  return { fetchFn, enviados, metodos };
}

export const SECRETO = 'secreto-del-webhook-123';
export const OKT = 'token-del-cli-okt-456';

export function fakeEnv(opciones: { ai?: ReturnType<typeof fakeAi> } = {}) {
  const kv = fakeKv();
  const ai = opciones.ai ?? fakeAi();
  const env = {
    COLA: kv,
    AI: ai,
    TZ: 'America/Lima',
    WHISPER_MODEL: '@cf/openai/whisper-large-v3-turbo',
    TELEGRAM_TOKEN: 'tg-token',
    WEBHOOK_SECRET: SECRETO,
    OKT_TOKEN: OKT,
    CHAT_IDS: '111, 222',
  } as unknown as Env;
  return { env, kv, ai };
}

// 2026-10-21 18:05:00 en Lima = 23:05:00 UTC.
export const FECHA_MSG = Date.UTC(2026, 9, 21, 23, 5, 0) / 1000;

export function update(updateId: number, mensaje: Record<string, unknown>, chatId = 111) {
  return { update_id: updateId, message: { message_id: updateId, date: FECHA_MSG, chat: { id: chatId, type: 'private' }, ...mensaje } };
}

export function webhook(cuerpo: unknown, secreto = SECRETO) {
  return new Request('https://okt.test/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secreto },
    body: JSON.stringify(cuerpo),
  });
}

export function pedido(ruta: string, init: RequestInit & { token?: string | null } = {}) {
  const { token = OKT, ...resto } = init;
  const headers = new Headers(resto.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`https://okt.test${ruta}`, { ...resto, headers });
}
