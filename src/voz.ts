// Transcripción de notas de voz con Whisper de Workers AI. El audio no se guarda en ninguna parte.

export const MAX_SEGUNDOS = 600;

/**
 * Base64 del audio. Usa Uint8Array.prototype.toBase64 (nativo y rápido) si el runtime lo tiene: el plan
 * gratuito da 10 ms de CPU. Si no, por trozos (String.fromCharCode con todo el arreglo desborda la pila).
 */
export function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf) as Uint8Array & { toBase64?: () => string };
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

export async function transcribir(ai: Ai, modelo: string, audio: ArrayBuffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (await ai.run(modelo as any, { audio: base64(audio), language: 'es', task: 'transcribe', vad_filter: true } as any)) as { text?: string };
  return (r?.text ?? '').trim();
}
