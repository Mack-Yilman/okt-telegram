// Transcripción de notas de voz con Whisper de Workers AI. El audio no se guarda en ninguna parte.

export const MAX_SEGUNDOS = 600;

/** Base64 por trozos: String.fromCharCode con todo el arreglo desborda la pila en audios largos. */
export function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

export async function transcribir(ai: Ai, modelo: string, audio: ArrayBuffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (await ai.run(modelo as any, { audio: base64(audio), language: 'es', task: 'transcribe', vad_filter: true } as any)) as { text?: string };
  return (r?.text ?? '').trim();
}
