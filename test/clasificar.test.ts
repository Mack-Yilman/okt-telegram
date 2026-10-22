import { describe, expect, it } from 'vitest';
import { clasificar } from '../src/clasificar';

const SELLO = '2026-10-21 1805';
const msg = (m: Record<string, unknown>) => ({ message_id: 1, date: 0, chat: { id: 111 }, ...m });

describe('clasificar', () => {
  it('texto suelto → nota', () => {
    expect(clasificar(msg({ text: 'Repasar anemia' }), SELLO)).toEqual({ accion: 'encolar', tipo: 'nota', texto: 'Repasar anemia' });
  });

  it('/nota y /tarea con texto; sin texto, explica el uso', () => {
    expect(clasificar(msg({ text: '/nota Una idea' }), SELLO)).toEqual({ accion: 'encolar', tipo: 'nota', texto: 'Una idea' });
    expect(clasificar(msg({ text: '/tarea@okt_bot Comprar libro' }), SELLO)).toEqual({ accion: 'encolar', tipo: 'tarea', texto: 'Comprar libro' });
    expect(clasificar(msg({ text: '/tarea' }), SELLO)).toMatchObject({ accion: 'responder', texto: expect.stringContaining('/tarea') });
  });

  it('/estado, /start, /ayuda y comandos desconocidos', () => {
    expect(clasificar(msg({ text: '/estado' }), SELLO)).toEqual({ accion: 'estado' });
    expect(clasificar(msg({ text: '/start' }), SELLO)).toMatchObject({ accion: 'responder', texto: expect.stringContaining('/tarea') });
    expect(clasificar(msg({ text: '/ayuda' }), SELLO)).toMatchObject({ accion: 'responder' });
    expect(clasificar(msg({ text: '/borrar todo' }), SELLO)).toMatchObject({ accion: 'responder', texto: expect.stringContaining('/ayuda') });
  });

  it('un enlace con comentario corto → enlace; un texto largo con enlace → nota', () => {
    const texto = 'https://www.youtube.com/watch?v=abc mirar luego';
    expect(clasificar(msg({ text: texto, entities: [{ type: 'url', offset: 0, length: 35 }] }), SELLO)).toEqual({
      accion: 'encolar',
      tipo: 'enlace',
      texto,
      url: 'https://www.youtube.com/watch?v=abc',
    });
    const largo = 'Hoy en la clase de cardiología vimos la guía nueva de hipertensión y el profesor recomendó leer https://ejemplo.org/guia antes del examen';
    expect(clasificar(msg({ text: largo, entities: [{ type: 'url', offset: 96, length: 24 }] }), SELLO)).toMatchObject({ tipo: 'nota' });
  });

  it('los offsets de Telegram son del texto sin recortar', () => {
    expect(clasificar(msg({ text: '\n  https://ejemplo.org/guia', entities: [{ type: 'url', offset: 3, length: 24 }] }), SELLO)).toMatchObject({
      tipo: 'enlace',
      url: 'https://ejemplo.org/guia',
    });
  });

  it('un enlace con texto (text_link) usa su url', () => {
    expect(clasificar(msg({ text: 'este artículo', entities: [{ type: 'text_link', offset: 0, length: 13, url: 'https://ejemplo.org/a' }] }), SELLO)).toMatchObject({
      tipo: 'enlace',
      url: 'https://ejemplo.org/a',
    });
  });

  it('foto: la de mayor resolución, con la leyenda como texto', () => {
    const r = clasificar(
      msg({
        caption: 'Pizarra',
        photo: [
          { file_id: 'chica', file_unique_id: 'u1', width: 90, height: 90, file_size: 1000 },
          { file_id: 'grande', file_unique_id: 'u2', width: 1280, height: 960, file_size: 90000 },
        ],
      }),
      SELLO,
    );
    expect(r).toEqual({ accion: 'encolar', tipo: 'archivo', texto: 'Pizarra', archivo: { file_id: 'grande', nombre: 'foto 2026-10-21 1805.jpg', mime: 'image/jpeg' } });
  });

  it('documento: conserva su nombre; sin nombre, uno con la fecha', () => {
    expect(clasificar(msg({ document: { file_id: 'pdf1', file_name: 'Guía HTA.pdf', mime_type: 'application/pdf', file_size: 5000 } }), SELLO)).toEqual({
      accion: 'encolar',
      tipo: 'archivo',
      texto: '',
      archivo: { file_id: 'pdf1', nombre: 'Guía HTA.pdf', mime: 'application/pdf' },
    });
    expect(clasificar(msg({ document: { file_id: 'd2', mime_type: 'application/pdf' } }), SELLO)).toMatchObject({ archivo: { nombre: 'documento 2026-10-21 1805.pdf' } });
  });

  it('rechaza archivos de más de 20 MB (límite de la Bot API)', () => {
    expect(clasificar(msg({ document: { file_id: 'g', file_name: 'g.pdf', mime_type: 'application/pdf', file_size: 21 * 1024 * 1024 } }), SELLO)).toMatchObject({
      accion: 'responder',
      texto: expect.stringContaining('20 MB'),
    });
  });

  it('nota de voz y audio → voz con su duración', () => {
    expect(clasificar(msg({ voice: { file_id: 'v1', duration: 42, mime_type: 'audio/ogg', file_size: 30000 } }), SELLO)).toEqual({
      accion: 'encolar',
      tipo: 'voz',
      texto: '',
      voz: { file_id: 'v1', duracion: 42 },
    });
    expect(clasificar(msg({ audio: { file_id: 'a1', duration: 100, mime_type: 'audio/mpeg' } }), SELLO)).toMatchObject({ tipo: 'voz', voz: { file_id: 'a1', duracion: 100 } });
    expect(clasificar(msg({ caption: 'Clase 3', audio: { file_id: 'a2', duration: 10 } }), SELLO)).toMatchObject({ tipo: 'voz', texto: 'Clase 3' });
  });

  it('lo que no sabe guardar (sticker, ubicación) se responde', () => {
    expect(clasificar(msg({ sticker: { file_id: 's' } }), SELLO)).toMatchObject({ accion: 'responder', texto: expect.stringContaining('Todavía no') });
  });
});
