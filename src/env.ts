// Los bindings y vars vienen de `npx wrangler types` (worker-configuration.d.ts).
// Vuelve a generarlo cada vez que cambies wrangler.jsonc. Aquí solo se declaran
// los secretos, que se suben con `wrangler secret` y no aparecen en la config.

export interface Secrets {
  TELEGRAM_TOKEN: string;
  WEBHOOK_SECRET: string;
  OKT_TOKEN: string;
  CHAT_IDS: string;
}

export type Env = Cloudflare.Env & Secrets;
