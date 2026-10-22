// okt-telegram: el bot solo encola. El CLI okt (obsidian-knowledge-terminal) baja la cola a la PC.
//
//   POST /telegram           webhook de Telegram (cabecera X-Telegram-Bot-Api-Secret-Token)
//   GET  /cola[?cursor=]     { elementos, cursor }                     ┐
//   GET  /archivo/<file_id>  bytes del archivo, desde Telegram          ├ Authorization: Bearer <OKT_TOKEN>
//   POST /cola/confirmar     { ids } → { borrados }                    ┘
//
// Lo imprescindible (guardar en KV) va con await: nunca con ctx.waitUntil.

import type { Env } from './env';
import { clasificar, type Espera, type Mensaje } from './clasificar';
import { confirmar, contar, encolar, idDe, listar, marcarVisto, yaVisto, type Elemento } from './cola';
import { fechaLocal, sello } from './fechas';
import { patronSensible } from './sensibles';
import { bearer, safeEqual } from './seguridad';
import { esc, Telegram, TelegramError } from './telegram';
import { MAX_SEGUNDOS, transcribir } from './voz';

const TTL_ESPERA = 600; // /tarea sin texto espera el siguiente mensaje durante 10 minutos

const ETIQUETA: Record<Elemento['tipo'], string> = { nota: 'nota', voz: 'nota de voz', enlace: 'enlace', archivo: 'archivo', tarea: 'tarea para tu diaria' };

const log = (evento: string, datos: Record<string, unknown> = {}) => console.log(JSON.stringify({ evento, ...datos }));

const json = (datos: unknown, status = 200) => Response.json(datos, { status });

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return manejar(request, env);
  },
} satisfies ExportedHandler<Env>;

export async function manejar(req: Request, env: Env, fetchFn?: typeof fetch): Promise<Response> {
  const url = new URL(req.url);
  const ruta = url.pathname;

  if (ruta === '/telegram' && req.method === 'POST') {
    if (!(await safeEqual(req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '', env.WEBHOOK_SECRET))) return new Response('forbidden', { status: 403 });
    let update: { update_id?: number; message?: Mensaje };
    try {
      update = await req.json();
    } catch {
      return new Response('ok');
    }
    return webhook(update, env, new Telegram(env.TELEGRAM_TOKEN, fetchFn));
  }

  if (ruta === '/' && req.method === 'GET') return new Response('OKT Telegram: bot de captura para el segundo cerebro.\n');

  const esApi = ruta === '/cola' || ruta === '/cola/confirmar' || ruta.startsWith('/archivo/');
  if (!esApi) return new Response('not found', { status: 404 });
  if (!(await safeEqual(bearer(req), env.OKT_TOKEN))) return json({ error: 'no autorizado' }, 401);

  if (ruta === '/cola' && req.method === 'GET') {
    return json(await listar(env.COLA, url.searchParams.get('cursor')));
  }

  if (ruta === '/cola/confirmar' && req.method === 'POST') {
    let ids: unknown;
    try {
      ids = ((await req.json()) as { ids?: unknown }).ids;
    } catch {
      return json({ error: 'cuerpo inválido' }, 400);
    }
    if (!Array.isArray(ids) || ids.length > 1000 || !ids.every((x) => typeof x === 'string')) return json({ error: 'se espera { ids: [string] }' }, 400);
    return json({ borrados: await confirmar(env.COLA, ids) });
  }

  if (ruta.startsWith('/archivo/') && req.method === 'GET') {
    const fileId = decodeURIComponent(ruta.slice('/archivo/'.length));
    if (!/^[\w-]{1,256}$/.test(fileId)) return json({ error: 'file_id inválido' }, 400);
    try {
      const r = await new Telegram(env.TELEGRAM_TOKEN, fetchFn).descargar(fileId);
      return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' } });
    } catch (e) {
      if (e instanceof TelegramError && (e.status === 400 || e.status === 404)) return json({ error: 'archivo no encontrado' }, 404);
      log('archivo_error', { error: String(e) });
      return json({ error: 'no se pudo bajar el archivo de Telegram' }, 502);
    }
  }

  return new Response('not found', { status: 404 });
}

async function webhook(update: { update_id?: number; message?: Mensaje }, env: Env, tg: Telegram): Promise<Response> {
  const m = update.message;
  const updateId = update.update_id;
  if (!m || typeof updateId !== 'number') return new Response('ok');
  const chat = String(m.chat?.id ?? '');
  const permitidos = env.CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  if (!permitidos.includes(chat)) return new Response('ok'); // silencio para los demás
  if (await yaVisto(env.COLA, updateId)) return new Response('ok');

  const avisar = async (html: string) => {
    try {
      await tg.send(chat, html);
    } catch (e) {
      log('envio_error', { error: String(e) });
    }
  };
  const fecha = new Date((m.date ?? Date.now() / 1000) * 1000);
  const claveEspera = `espera:${chat}`;
  const espera = (await env.COLA.get(claveEspera)) as Espera | null;
  const decision = clasificar(m, sello(fecha, env.TZ), espera);
  // Cualquier mensaje consume la espera de /tarea o /nota (o la cancela, si es un comando). Si el mensaje se encola,
  // la espera se quita después de guardarlo: si KV falla, el reintento de Telegram sigue siendo una tarea.
  const consumirEspera = async () => {
    if (espera) await env.COLA.delete(claveEspera).catch(() => {});
  };

  if (decision.accion === 'esperar') {
    await env.COLA.put(claveEspera, decision.tipo, { expirationTtl: TTL_ESPERA });
    await avisar(decision.tipo === 'tarea' ? '¿Qué tarea agrego a tu nota diaria? Escríbela en tu próximo mensaje.' : '¿Qué nota guardo? Escríbela en tu próximo mensaje.');
    await marcarVisto(env.COLA, updateId).catch(() => {});
    return new Response('ok');
  }

  if (decision.accion === 'responder' || decision.accion === 'estado') {
    const texto = decision.accion === 'estado' ? textoEstado(await contar(env.COLA)) : decision.texto;
    await consumirEspera();
    await avisar(texto);
    await marcarVisto(env.COLA, updateId).catch(() => {});
    return new Response('ok');
  }

  let texto = decision.texto;
  if (decision.voz) {
    if (decision.voz.duracion > MAX_SEGUNDOS) {
      await consumirEspera();
      await avisar('La nota de voz pasa de 10 minutos: divídela en partes más cortas.');
      await marcarVisto(env.COLA, updateId).catch(() => {});
      return new Response('ok');
    }
    let transcripcion = '';
    try {
      const audio = await (await tg.descargar(decision.voz.file_id)).arrayBuffer();
      transcripcion = await transcribir(env.AI, env.WHISPER_MODEL, audio);
    } catch (e) {
      log('whisper_error', { error: String(e) });
    }
    // La leyenda (si la hay) va antes de la transcripción.
    texto = [decision.texto, transcripcion].filter(Boolean).join('\n\n');
    if (!transcripcion) {
      await consumirEspera();
      await avisar('No pude transcribir la nota de voz: reenvíala o escríbela.');
      await marcarVisto(env.COLA, updateId).catch(() => {});
      return new Response('ok');
    }
  }

  const el: Elemento = { id: idDe(Math.floor(fecha.getTime() / 1000), updateId), tipo: decision.tipo, texto, fecha: fechaLocal(fecha, env.TZ), chat_id: chat };
  if (decision.url) el.url = decision.url;
  if (decision.archivo) Object.assign(el, { archivo_key: decision.archivo.file_id, nombre: decision.archivo.nombre, mime: decision.archivo.mime });
  // El nombre del archivo también puede traer datos de un paciente.
  const sensible = patronSensible([texto, el.nombre ?? ''].join('\n'));
  if (sensible) el.sensible = true;

  try {
    await encolar(env.COLA, el);
    await marcarVisto(env.COLA, updateId);
  } catch (e) {
    // Sin aviso: Telegram reintenta cada 500 y un aviso por intento llenaría el chat. El ✓ es la señal.
    log('kv_error', { error: String(e) });
    return new Response('error', { status: 500 });
  }
  await consumirEspera();

  if (sensible) {
    await avisar(
      `⚠️ Parece ${esc(sensible.que)}: el vault no guarda datos de pacientes. Quedó retenido en la cola: si no lo es, en la PC se escribe con <code>okt telegram bajar --forzar ${el.id}</code>; si lo es, quítalo con <code>okt telegram descartar ${el.id}</code>.`,
    );
  } else if (decision.voz) {
    const vista = texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;
    await avisar(`✓ Transcrita y en la bandeja:\n<i>${esc(vista)}</i>`);
  } else {
    await avisar(`✓ En la bandeja (${ETIQUETA[el.tipo]}).`);
  }
  return new Response('ok');
}

function textoEstado(n: number): string {
  if (n === 0) return 'La cola está vacía: todo está en tu vault.';
  return `${n} ${n === 1 ? 'elemento espera' : 'elementos esperan'} en la cola. Se bajan con <code>okt telegram bajar</code> o al abrir Claude Code o Antigravity en el vault.`;
}
