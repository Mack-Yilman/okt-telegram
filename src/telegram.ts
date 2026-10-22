// Cliente mínimo de la Bot API de Telegram (fetch inyectable para las pruebas).

type FetchFn = typeof fetch;

export class TelegramError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(`Telegram ${status}: ${description}`);
  }
}

export class Telegram {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly token: string,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? ((input, init) => fetch(input, init));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async call(method: string, body: Record<string, unknown>): Promise<any> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!data.ok) throw new TelegramError(res.status, data.description ?? 'error');
    return data.result;
  }

  /** Envía en HTML (el texto variable va escapado con esc). */
  send(chatId: string, html: string): Promise<{ message_id: number }> {
    return this.call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }

  /** Descarga un archivo por su file_id. La Bot API solo entrega archivos de hasta 20 MB. */
  async descargar(fileId: string): Promise<Response> {
    const f = (await this.call('getFile', { file_id: fileId })) as { file_path?: string };
    if (!f.file_path) throw new TelegramError(404, 'archivo sin ruta');
    const res = await this.fetchFn(`https://api.telegram.org/file/bot${this.token}/${f.file_path}`);
    if (!res.ok) throw new TelegramError(res.status, 'no se pudo descargar el archivo');
    return res;
  }
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
