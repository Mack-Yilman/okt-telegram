#!/usr/bin/env node
// Asistente de configuración de OKT Telegram. Lee los secretos de .dev.vars.
//
//   node scripts/setup.mjs chat-id              muestra tu chat ID (escríbele /start al bot)
//   node scripts/setup.mjs webhook --url URL    registra el webhook y los comandos del bot
//   node scripts/setup.mjs webhook --quitar     elimina el webhook registrado
//   node scripts/setup.mjs estado               resumen de la configuración y estado del bot

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMANDOS = [
  ['nota', 'Guarda una nota'],
  ['tarea', 'Agrega una tarea a tu nota diaria'],
  ['estado', 'Cuántos elementos esperan en la cola'],
  ['ayuda', 'Qué puedo guardar'],
];

const ok = (m) => console.log(`✅ ${m}`);
const warn = (m) => console.log(`⚠️  ${m}`);
const info = (m) => console.log(`   ${m}`);
const fail = (m) => {
  console.error(`❌ ${m}`);
  process.exit(1);
};

function loadVars() {
  const file = join(ROOT, '.dev.vars');
  if (!existsSync(file)) fail('No existe .dev.vars. Copia .dev.vars.example a .dev.vars y llénalo.');
  const vars = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return vars;
}

// Si existe wrangler.local.jsonc (configuración personal, ignorada por git), se usa ese.
const wranglerPath = existsSync(join(ROOT, 'wrangler.local.jsonc')) ? join(ROOT, 'wrangler.local.jsonc') : join(ROOT, 'wrangler.jsonc');
const readWrangler = () => (existsSync(wranglerPath) ? readFileSync(wranglerPath, 'utf8') : '');

async function telegram(token, method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

// ---------- chat-id ----------

async function cmdChatId(vars) {
  const token = vars.TELEGRAM_TOKEN;
  if (!token) fail('Falta TELEGRAM_TOKEN en .dev.vars.');
  const bot = await telegram(token, 'getMe').catch((e) => fail(`El token del bot no funciona: ${e.message}`));
  ok(`Bot: @${bot.username}`);
  const wh = await telegram(token, 'getWebhookInfo');
  if (wh.url) {
    warn('El webhook ya está activo y el bot no responderá a chats ajenos.');
    info('Para usar este comando, quita primero el webhook con:');
    info('node scripts/setup.mjs webhook --quitar');
    info('Luego vuelve a ejecutar chat-id y finalmente registra el webhook de nuevo.');
    return;
  }
  console.log(`\n👉 Abre https://t.me/${bot.username} y envíale /start. Espero hasta 2 minutos…\n`);
  let offset = 0;
  const fin = Date.now() + 120_000;
  while (Date.now() < fin) {
    const updates = await telegram(token, 'getUpdates', { offset, timeout: 20, allowed_updates: ['message'] });
    for (const u of updates) {
      offset = u.update_id + 1;
      const chat = u.message?.chat;
      if (chat) {
        ok(`Tu chat ID es: ${chat.id}  (${chat.first_name ?? chat.title ?? ''})`);
        info('Agrégalo en .dev.vars como CHAT_IDS.');
        await telegram(token, 'getUpdates', { offset }); // marca los mensajes como leídos
        return;
      }
    }
  }
  fail('No llegó ningún mensaje. ¿Le escribiste /start al bot correcto?');
}

// ---------- webhook ----------

async function cmdWebhook(vars, url, quitar) {
  const token = vars.TELEGRAM_TOKEN;
  if (!token) fail('Falta TELEGRAM_TOKEN en .dev.vars.');

  if (quitar) {
    await telegram(token, 'deleteWebhook', { drop_pending_updates: true });
    ok('Webhook eliminado correctamente.');
    return;
  }

  const secret = vars.WEBHOOK_SECRET;
  if (!secret) fail('Falta WEBHOOK_SECRET en .dev.vars.');
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) fail('WEBHOOK_SECRET debe tener 16+ caracteres: solo letras, números, _ y -.');
  if (!url || !/^https:\/\//.test(url)) fail('Indica la URL de tu Worker: --url https://okt-telegram.<subdominio>.workers.dev');

  const hook = `${url.replace(/\/+$/, '')}/telegram`;
  const ping = await fetch(url).then((r) => r.text()).catch(() => '');
  if (!ping.includes('OKT Telegram')) warn(`${url} no respondió como «OKT Telegram». ¿Ya hiciste npx wrangler deploy?`);

  await telegram(token, 'setWebhook', {
    url: hook,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  ok(`Webhook registrado en ${hook}`);
  await telegram(token, 'setMyCommands', { commands: COMANDOS.map(([command, description]) => ({ command, description })) });
  ok('Comandos del bot registrados (aparecen en el menú «/»).');
}

// ---------- estado ----------

async function cmdEstado(vars) {
  for (const k of ['TELEGRAM_TOKEN', 'WEBHOOK_SECRET', 'OKT_TOKEN', 'CHAT_IDS']) {
    (vars[k] ? ok : warn)(`${k} ${vars[k] ? 'definido' : 'vacío'}`);
  }
  const kv = readWrangler().match(/"binding":\s*"COLA",\s*"id":\s*"([^"]*)"/)?.[1];
  (kv && !kv.startsWith('REEMPLAZA') ? ok : warn)(`KV COLA: ${kv ?? 'sin configurar'}`);

  if (vars.TELEGRAM_TOKEN) {
    const bot = await telegram(vars.TELEGRAM_TOKEN, 'getMe').catch((e) => {
      warn(`Error al consultar getMe: ${e.message}`);
      return null;
    });
    if (bot) {
      ok(`Bot: @${bot.username} (${bot.first_name})`);
    }
    const wh = await telegram(vars.TELEGRAM_TOKEN, 'getWebhookInfo').catch(() => null);
    if (wh) {
      (wh.url ? ok : warn)(`Webhook: ${wh.url || 'no registrado'}`);
      if (wh.last_error_message) warn(`Último error del webhook: ${wh.last_error_message}`);
      if (wh.pending_update_count) info(`Mensajes en cola: ${wh.pending_update_count}`);
    }
  }
}

// ---------- main ----------

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const vars = loadVars();
const run = {
  'chat-id': () => cmdChatId(vars),
  webhook: () => cmdWebhook(vars, opt('--url'), flag('--quitar')),
  estado: () => cmdEstado(vars),
}[cmd];

if (!run) {
  console.log(`Uso:
  node scripts/setup.mjs chat-id              muestra tu chat ID (escríbele /start al bot)
  node scripts/setup.mjs webhook --url URL    registra el webhook y los comandos
  node scripts/setup.mjs webhook --quitar     elimina el webhook registrado
  node scripts/setup.mjs estado               resumen de la configuración y estado del bot`);
  process.exit(cmd ? 1 : 0);
}
await run();
