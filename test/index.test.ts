import { describe, expect, it } from 'vitest';
import { manejar } from '../src/index';
import { fakeAi, fakeEnv, fakeTelegram, OKT, pedido, update, webhook } from './fakes';

const colaDe = (kv: ReturnType<typeof fakeEnv>['kv']) => [...kv.m.keys()].filter((k) => k.startsWith('cola:'));
const elementoDe = (kv: ReturnType<typeof fakeEnv>['kv']) => JSON.parse(kv.m.get(colaDe(kv)[0]!)!.v);

describe('webhook /telegram', () => {
  it('rechaza un secreto inválido con 403 y no guarda nada', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    const r = await manejar(webhook(update(1, { text: 'hola' }), 'otro'), env, tg.fetchFn);
    expect(r.status).toBe(403);
    expect(kv.m.size).toBe(0);
  });

  it('un chat ajeno recibe silencio y nada se guarda', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    const r = await manejar(webhook(update(1, { text: 'hola' }, 999)), env, tg.fetchFn);
    expect(r.status).toBe(200);
    expect(kv.m.size).toBe(0);
    expect(tg.metodos).toEqual([]);
  });

  it('encola una nota con el contrato y confirma en el chat', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    const r = await manejar(webhook(update(7, { text: 'Repasar anemia' })), env, tg.fetchFn);
    expect(r.status).toBe(200);
    expect(colaDe(kv)).toEqual(['cola:20261021T230500-0000000007']);
    expect(elementoDe(kv)).toEqual({ id: '20261021T230500-0000000007', tipo: 'nota', texto: 'Repasar anemia', fecha: '2026-10-21T18:05:00-05:00', chat_id: '111' });
    expect(tg.enviados).toEqual([{ chat_id: '111', text: expect.stringContaining('✓') }]);
  });

  it('un update_id repetido no duplica ni vuelve a responder', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    await manejar(webhook(update(8, { text: 'Una vez' })), env, tg.fetchFn);
    await manejar(webhook(update(8, { text: 'Una vez' })), env, tg.fetchFn);
    expect(colaDe(kv)).toHaveLength(1);
    expect(tg.enviados).toHaveLength(1);
  });

  it('marca lo sensible, lo encola y avisa', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    await manejar(webhook(update(9, { text: 'Control DNI 45879632' })), env, tg.fetchFn);
    expect(elementoDe(kv)).toMatchObject({ sensible: true });
    expect(tg.enviados[0]!.text).toMatch(/un DNI/);
    expect(tg.enviados[0]!.text).toMatch(/okt telegram descartar/);
  });

  it('también revisa el nombre del archivo', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    await manejar(webhook(update(30, { document: { file_id: 'd1', file_name: 'Paciente Juan Perez - HC 45892.pdf', mime_type: 'application/pdf' } })), env, tg.fetchFn);
    expect(elementoDe(kv)).toMatchObject({ sensible: true });
    expect(tg.enviados[0]!.text).toMatch(/datos de pacientes/);
  });

  it('una nota de voz con leyenda guarda la leyenda y la transcripción', async () => {
    const { env, kv } = fakeEnv({ ai: fakeAi({ text: 'Hoy vimos betabloqueantes' }) });
    const tg = fakeTelegram({ v1: { path: 'voice/file_1.oga', bytes: 'x' } });
    await manejar(webhook(update(31, { caption: 'Clase 3', voice: { file_id: 'v1', duration: 5 } })), env, tg.fetchFn);
    expect(elementoDe(kv).texto).toBe('Clase 3\n\nHoy vimos betabloqueantes');
  });

  it('transcribe la voz con Whisper en español y encola el texto', async () => {
    const ai = fakeAi({ text: '  Recordar la guía  ' });
    const { env, kv } = fakeEnv({ ai });
    const tg = fakeTelegram({ v1: { path: 'voice/file_1.oga', bytes: 'OggS-audio' } });
    await manejar(webhook(update(10, { voice: { file_id: 'v1', duration: 5, mime_type: 'audio/ogg' } })), env, tg.fetchFn);
    expect(ai.llamadas[0]).toMatchObject({ modelo: '@cf/openai/whisper-large-v3-turbo', entrada: { language: 'es', audio: btoa('OggS-audio') } });
    expect(elementoDe(kv)).toMatchObject({ tipo: 'voz', texto: 'Recordar la guía' });
    expect(elementoDe(kv).archivo_key).toBeUndefined();
    expect(tg.enviados[0]!.text).toMatch(/Recordar la guía/);
  });

  it('si Whisper falla, no encola y pide reenviar', async () => {
    const { env, kv } = fakeEnv({ ai: fakeAi(new Error('AI caído')) });
    const tg = fakeTelegram({ v1: { path: 'voice/file_1.oga', bytes: 'x' } });
    const r = await manejar(webhook(update(11, { voice: { file_id: 'v1', duration: 5 } })), env, tg.fetchFn);
    expect(r.status).toBe(200);
    expect(colaDe(kv)).toHaveLength(0);
    expect(tg.enviados[0]!.text).toMatch(/No pude transcribir/);
  });

  it('una transcripción vacía tampoco se encola', async () => {
    const { env, kv } = fakeEnv({ ai: fakeAi({ text: '   ' }) });
    const tg = fakeTelegram({ v1: { path: 'voice/file_1.oga', bytes: 'x' } });
    await manejar(webhook(update(12, { voice: { file_id: 'v1', duration: 5 } })), env, tg.fetchFn);
    expect(colaDe(kv)).toHaveLength(0);
  });

  it('rechaza audios de más de 10 minutos sin llamar a Whisper', async () => {
    const ai = fakeAi();
    const { env, kv } = fakeEnv({ ai });
    const tg = fakeTelegram();
    await manejar(webhook(update(13, { voice: { file_id: 'v1', duration: 601 } })), env, tg.fetchFn);
    expect(ai.llamadas).toHaveLength(0);
    expect(colaDe(kv)).toHaveLength(0);
    expect(tg.enviados[0]!.text).toMatch(/10 minutos/);
  });

  it('una foto se encola con su file_id, sin descargarla', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    await manejar(webhook(update(14, { caption: 'Pizarra', photo: [{ file_id: 'f1', width: 1, height: 1 }] })), env, tg.fetchFn);
    expect(elementoDe(kv)).toMatchObject({ tipo: 'archivo', texto: 'Pizarra', archivo_key: 'f1', nombre: 'foto 2026-10-21 1805.jpg', mime: 'image/jpeg' });
    expect(tg.metodos).toEqual(['sendMessage']);
  });

  it('un enlace guarda su url', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    await manejar(webhook(update(15, { text: 'https://ejemplo.org/a', entities: [{ type: 'url', offset: 0, length: 21 }] })), env, tg.fetchFn);
    expect(elementoDe(kv)).toMatchObject({ tipo: 'enlace', url: 'https://ejemplo.org/a' });
  });

  it('/tarea sola (desde el menú) pregunta y toma el siguiente mensaje como tarea', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    await manejar(webhook(update(40, { text: '/tarea' })), env, tg.fetchFn);
    expect(tg.enviados[0]!.text).toMatch(/Qué tarea/);
    expect(colaDe(kv)).toHaveLength(0);
    await manejar(webhook(update(41, { text: 'Comprar el libro' })), env, tg.fetchFn);
    expect(elementoDe(kv)).toMatchObject({ tipo: 'tarea', texto: 'Comprar el libro' });
    // La espera se consume: el mensaje siguiente vuelve a ser una nota.
    await manejar(webhook(update(42, { text: 'Otra cosa' })), env, tg.fetchFn);
    const tipos = colaDe(kv).map((k) => JSON.parse(kv.m.get(k)!.v).tipo);
    expect(tipos).toEqual(['tarea', 'nota']);
  });

  it('un comando cancela la espera de /tarea', async () => {
    const { env, kv } = fakeEnv();
    const tg = fakeTelegram();
    await manejar(webhook(update(43, { text: '/nota' })), env, tg.fetchFn);
    await manejar(webhook(update(44, { text: '/estado' })), env, tg.fetchFn);
    await manejar(webhook(update(45, { text: 'Texto suelto' })), env, tg.fetchFn);
    expect(elementoDe(kv)).toMatchObject({ tipo: 'nota', texto: 'Texto suelto' });
    expect(kv.m.has('espera:111')).toBe(false);
  });

  it('/estado responde cuántos esperan', async () => {
    const { env } = fakeEnv();
    const tg = fakeTelegram();
    await manejar(webhook(update(16, { text: 'uno' })), env, tg.fetchFn);
    await manejar(webhook(update(17, { text: 'dos' })), env, tg.fetchFn);
    await manejar(webhook(update(18, { text: '/estado' })), env, tg.fetchFn);
    expect(tg.enviados[2]!.text).toMatch(/2 elementos/);
  });

  it('si KV falla, responde 500 sin avisar: Telegram reintenta y el ✓ llega cuando se guarde', async () => {
    const { env, kv } = fakeEnv();
    kv.put = async () => {
      throw new Error('KV caído');
    };
    const tg = fakeTelegram();
    const r = await manejar(webhook(update(19, { text: 'hola' })), env, tg.fetchFn);
    expect(r.status).toBe(500);
    expect(tg.enviados).toHaveLength(0);
  });

  it('un cuerpo que no es JSON no rompe nada', async () => {
    const { env } = fakeEnv();
    const tg = fakeTelegram();
    const req = new Request('https://okt.test/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secreto-del-webhook-123' }, body: 'no-json' });
    expect((await manejar(req, env, tg.fetchFn)).status).toBe(200);
  });
});

describe('API del CLI okt', () => {
  async function conCola() {
    const f = fakeEnv();
    const tg = fakeTelegram({ f1: { path: 'photos/file_9.jpg', bytes: 'JPEGDATA' } });
    for (let i = 1; i <= 3; i++) await manejar(webhook(update(i, { text: `nota ${i}`, date: 1792710000 + i })), f.env, tg.fetchFn);
    return { ...f, tg };
  }

  it('GET / identifica al Worker', async () => {
    const { env } = fakeEnv();
    expect(await (await manejar(new Request('https://okt.test/'), env, fakeTelegram().fetchFn)).text()).toMatch(/OKT Telegram/);
  });

  it('sin token o con token malo → 401', async () => {
    const { env, tg } = await conCola();
    expect((await manejar(pedido('/cola', { token: null }), env, tg.fetchFn)).status).toBe(401);
    expect((await manejar(pedido('/cola', { token: 'malo' }), env, tg.fetchFn)).status).toBe(401);
    expect((await manejar(pedido('/cola/confirmar', { method: 'POST', token: 'malo', body: '{"ids":[]}' }), env, tg.fetchFn)).status).toBe(401);
  });

  it('GET /cola devuelve los elementos en orden, con cursor', async () => {
    const { env, tg } = await conCola();
    const r = await manejar(pedido('/cola'), env, tg.fetchFn);
    const datos = (await r.json()) as { elementos: { texto: string }[]; cursor: string | null };
    expect(datos.elementos.map((e) => e.texto)).toEqual(['nota 1', 'nota 2', 'nota 3']);
    expect(datos.cursor).toBeNull();
  });

  it('POST /cola/confirmar borra solo lo pedido', async () => {
    const { env, kv, tg } = await conCola();
    const { elementos } = (await (await manejar(pedido('/cola'), env, tg.fetchFn)).json()) as { elementos: { id: string }[] };
    const r = await manejar(pedido('/cola/confirmar', { method: 'POST', body: JSON.stringify({ ids: [elementos[0]!.id] }) }), env, tg.fetchFn);
    expect(await r.json()).toEqual({ borrados: 1 });
    expect(colaDe(kv)).toHaveLength(2);
  });

  it('POST /cola/confirmar valida el cuerpo', async () => {
    const { env, tg } = await conCola();
    expect((await manejar(pedido('/cola/confirmar', { method: 'POST', body: '{"ids":"x"}' }), env, tg.fetchFn)).status).toBe(400);
    expect((await manejar(pedido('/cola/confirmar', { method: 'POST', body: 'no' }), env, tg.fetchFn)).status).toBe(400);
  });

  it('GET /archivo/<file_id> transmite los bytes desde Telegram', async () => {
    const { env, tg } = await conCola();
    const r = await manejar(pedido('/archivo/f1'), env, tg.fetchFn);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('JPEGDATA');
    expect((await manejar(pedido('/archivo/no-existe'), env, tg.fetchFn)).status).toBe(404);
    expect((await manejar(pedido('/archivo/f1', { token: null }), env, tg.fetchFn)).status).toBe(401);
  });

  it('el token del CLI no sirve como secreto del webhook ni al revés', async () => {
    const { env, tg } = await conCola();
    expect((await manejar(webhook(update(50, { text: 'x' }), OKT), env, tg.fetchFn)).status).toBe(403);
  });

  it('ruta desconocida → 404', async () => {
    const { env } = fakeEnv();
    expect((await manejar(pedido('/otra'), env, fakeTelegram().fetchFn)).status).toBe(404);
  });
});
