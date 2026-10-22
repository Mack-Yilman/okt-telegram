// Transcripción de notas de voz con Whisper de Workers AI. El audio no se guarda en ninguna parte.
/// <reference types="node" />
import { Buffer } from 'node:buffer';

export const MAX_SEGUNDOS = 600;

/**
 * Base64 del audio con Buffer (nodejs_compat), que lo hace en código nativo. La versión en JavaScript
 * (String.fromCharCode + btoa) gastó 43 ms de CPU con una nota de 2 minutos, y el plan gratuito da 10 ms.
 */
export function base64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64');
}

export async function transcribir(ai: Ai, modelo: string, audio: ArrayBuffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (await ai.run(modelo as any, { audio: base64(audio), language: 'es', task: 'transcribe', vad_filter: true } as any)) as { text?: string };
  return (r?.text ?? '').trim();
}
