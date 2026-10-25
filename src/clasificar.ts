// Decide qué hacer con un mensaje de Telegram. Puro: no toca KV ni la red.

import { TTL_COLA, type Tipo } from './cola';
import { MAX_SEGUNDOS } from './voz';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Mensaje = Record<string, any>;

export type Espera = 'nota' | 'tarea';

export type Decision =
  | { accion: 'responder'; texto: string }
  | { accion: 'estado' }
  | { accion: 'esperar'; tipo: Espera }
  | {
      accion: 'encolar';
      tipo: Tipo;
      texto: string;
      url?: string;
      archivo?: { file_id: string; nombre: string; mime: string };
      voz?: { file_id: string; duracion: number };
    };

const MAX_BYTES = 20 * 1024 * 1024; // límite de descarga de la Bot API
const PALABRAS_COMENTARIO = 12; // un enlace con un comentario corto es un enlace; con más texto, una nota
export const MINUTOS_ESPERA = 10; // /tarea o /nota sin texto esperan el siguiente mensaje

const MB = MAX_BYTES / 1024 / 1024;
const SIN_VIDEOS = 'Los videos no se guardan: mándame su enlace (YouTube o Drive).';

// Los límites salen de las mismas constantes que los aplican, para que la ayuda no se desfase.
export const AYUDA = [
  '<b>🧠 OKT · captura a tu segundo cerebro</b>',
  '',
  'Todo lo que me mandes queda en la 📥 Bandeja de tu vault. Se baja a la PC al abrir Claude Code o Antigravity en el vault, o con <code>okt telegram bajar</code>. Cada captura guardada recibe un ✓: si no llega en un minuto, reenvíala.',
  '',
  '<b>📝 Notas</b>',
  '• Escribe cualquier texto, o <code>/nota texto</code>.',
  `• <code>/nota</code> o <code>/tarea</code> sin texto (desde el menú «/»): el siguiente mensaje se guarda así. Espero ${MINUTOS_ESPERA} min.`,
  '',
  '<b>✅ Tareas</b>',
  '• <code>/tarea texto</code>: va a las tareas de tu nota diaria.',
  '',
  '<b>🎙️ Voz</b>',
  `• Nota de voz o audio de hasta ${MAX_SEGUNDOS / 60} min: la transcribo y guardo solo el texto. Revisa nombres y cifras.`,
  '',
  '<b>🔗 Enlaces</b>',
  `• Una web o un video de YouTube, solo o con un comentario corto (hasta ${PALABRAS_COMENTARIO} palabras). Al abrir el vault se trae sola la página completa con sus imágenes, o la transcripción del video.`,
  '• Con más texto, se guarda como nota con el enlace dentro.',
  '',
  '<b>🖼️ Fotos y archivos</b>',
  `• Fotos, PDF y otros archivos de hasta ${MB} MB, con leyenda si quieres.`,
  '• Telegram comprime las fotos: para la calidad original, mándala como archivo.',
  '• Un álbum llega como una captura por foto.',
  '',
  '<b>⚠️ Límites</b>',
  `• ${MB} MB por archivo (límite de Telegram para los bots).`,
  `• ${MAX_SEGUNDOS / 60} min por nota de voz: divide las más largas.`,
  `• ${SIN_VIDEOS}`,
  '• Un texto de más de 4096 caracteres llega partido en varias capturas.',
  `• Lo que no se baje en ${TTL_COLA / 86400} días se borra de la cola.`,
  '',
  '<b>ℹ️ Comandos</b>',
  '• <code>/estado</code>: cuántas capturas esperan en la cola.',
  '• <code>/ayuda</code>: este mensaje.',
].join('\n');

const responder = (texto: string): Decision => ({ accion: 'responder', texto });

// Los offsets de Telegram son del texto original, sin recortar.
function enlaceDe(m: Mensaje): string | null {
  const texto: string = m.text ?? m.caption ?? '';
  for (const e of (m.entities ?? m.caption_entities ?? []) as any[]) {
    if (e.type === 'text_link' && e.url) return e.url;
    if (e.type === 'url') return texto.slice(e.offset, e.offset + e.length);
  }
  return null;
}

/**
 * `espera`: si el mensaje anterior fue /tarea o /nota sin texto (el menú de Telegram los envía así),
 * el siguiente texto suelto se toma con ese tipo.
 */
export function clasificar(m: Mensaje, sello: string, espera: Espera | null = null): Decision {
  const texto: string = (m.text ?? m.caption ?? '').trim();

  const cmd = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(texto);
  if (m.text && cmd) {
    const nombre = cmd[1]!.toLowerCase();
    const resto = cmd[2]!.trim();
    if (nombre === 'nota' || nombre === 'tarea') {
      if (!resto) return { accion: 'esperar', tipo: nombre };
      return { accion: 'encolar', tipo: nombre, texto: resto };
    }
    if (nombre === 'estado') return { accion: 'estado' };
    if (nombre === 'start' || nombre === 'ayuda' || nombre === 'help') return responder(AYUDA);
    return responder('No conozco ese comando. Mira /ayuda.');
  }

  if (m.voice || m.audio) {
    const a = m.voice ?? m.audio;
    if (a.file_size > MAX_BYTES) return responder('Telegram solo me deja bajar archivos de hasta 20 MB.');
    return { accion: 'encolar', tipo: 'voz', texto, voz: { file_id: a.file_id, duracion: a.duration ?? 0 } };
  }

  if (m.photo?.length) {
    const foto = m.photo[m.photo.length - 1];
    if (foto.file_size > MAX_BYTES) return responder('Telegram solo me deja bajar archivos de hasta 20 MB.');
    return { accion: 'encolar', tipo: 'archivo', texto, archivo: { file_id: foto.file_id, nombre: `foto ${sello}.jpg`, mime: 'image/jpeg' } };
  }

  if (m.document) {
    const d = m.document;
    if (d.file_size > MAX_BYTES) return responder('Telegram solo me deja bajar archivos de hasta 20 MB.');
    const mime: string = d.mime_type ?? 'application/octet-stream';
    const ext = mime === 'application/pdf' ? '.pdf' : '';
    return { accion: 'encolar', tipo: 'archivo', texto, archivo: { file_id: d.file_id, nombre: d.file_name ?? `documento ${sello}${ext}`, mime } };
  }

  if (m.text && espera) return { accion: 'encolar', tipo: espera, texto };

  if (m.text) {
    const url = enlaceDe(m);
    if (url) {
      const comentario = texto.replace(url, '').trim();
      const palabras = comentario ? comentario.split(/\s+/).length : 0;
      if (palabras <= PALABRAS_COMENTARIO) return { accion: 'encolar', tipo: 'enlace', texto, url };
    }
    return { accion: 'encolar', tipo: 'nota', texto };
  }

  if (m.video || m.video_note || m.animation) return responder(`${SIN_VIDEOS} Mira /ayuda.`);
  return responder('Todavía no guardo ese tipo de mensaje. Mira /ayuda.');
}
