const { Telegraf, Markup } = require('telegraf');
const schedule = require('node-schedule');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// ════════════════════════════════════════
//  СТАН КОРИСТУВАЧІВ
// ════════════════════════════════════════
const users = {};
// {
//   chatId: {
//     startDate, day, checked,
//     reminders: [ { id, med, h, m, job } ],
//     setupStep: null | 'pick_med' | 'pick_count' | 'pick_time_N',
//     setupTemp: { med, count, times[] }
//   }
// }

function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = {
      startDate: new Date(),
      day: 1,
      checked: {},
      reminders: [],
      setupStep: null,
      setupTemp: null,
    };
  }
  return users[chatId];
}

// ════════════════════════════════════════
//  СПИСОК ПРЕПАРАТІВ
// ════════════════════════════════════════
const MEDS = [
  'Золопент',
  'Улькавіс',
  'Тетрамакс',
  'Метронідазол',
  'Ентерол',
  'Джилла',
  'Магній',
  'Ондансетрон',
  'Мебсин',
];

// ════════════════════════════════════════
//  РОЗКЛАД ЛІКІВ (чек-лист)
// ════════════════════════════════════════
function getSchedule(day) {
  const isEarly = day <= 5;
  return {
    morning: {
      label: '🌅 РАНОК',
      slots: isEarly ? [
        { id: 'wake',            title: 'Одразу після пробудження',       meds: ['Золопент — 1 таб'] },
        { id: 'wait_15',         title: '⏳ Зачекай 15 хвилин…',          meds: [] },
        { id: 'before_b',        title: 'Через 15 хв (перед сніданком)',   meds: ['Улькавіс — 2 таб', 'Тетрамакс — 1 кап'] },
        { id: 'after_b',         title: 'Після сніданку',                  meds: ['Метронідазол — 2 таб'] },
      ] : [
        { id: 'wake',            title: 'Одразу після пробудження',       meds: ['Золопент — 1 таб'] },
        { id: 'before_b',        title: 'Через 15–20 хв (перед сніданком)', meds: ['Улькавіс — 2 таб', 'Тетрамакс — 1 кап'] },
        { id: 'after_b',         title: 'Після сніданку',                  meds: ['Метронідазол — 2 таб'] },
      ],
    },
    day: {
      label: '☀️ ДЕНЬ',
      slots: [
        { id: 'before_l',        title: 'За 10–15 хв до обіду',           meds: ['Тетрамакс — 1 кап'] },
        { id: 'after_l',         title: 'Після обіду',                     meds: ['Метронідазол — 2 таб'] },
        { id: 'between_l',       title: 'Через 1,5–2 год після обіду',    meds: ['Ентерол — 1 кап'] },
      ],
    },
    evening: {
      label: '🌆 ВЕЧІР',
      slots: isEarly ? [
        { id: 'before_d30',      title: 'За 30 хв до вечері',             meds: ['Золопент — 1 таб'] },
        { id: 'wait_15_eve',     title: '⏳ Зачекай 15 хвилин…',          meds: [] },
        { id: 'before_d15',      title: 'За 10–15 хв до вечері',          meds: ['Улькавіс — 2 таб', 'Тетрамакс — 1 кап'] },
        { id: 'after_d',         title: 'Після вечері',                    meds: ['Метронідазол — 2 таб'] },
      ] : [
        { id: 'before_d30',      title: 'За 30 хв до вечері',             meds: ['Золопент — 1 таб'] },
        { id: 'before_d15',      title: 'За 10–15 хв до вечері',          meds: ['Улькавіс — 2 таб', 'Тетрамакс — 1 кап'] },
        { id: 'after_d',         title: 'Після вечері',                    meds: ['Метронідазол — 2 таб'] },
      ],
    },
    night: {
      label: '🌙 НІЧ',
      slots: [
        { id: 'night_e',         title: 'Через 2 год після вечері',       meds: ['Ентерол — 1 кап'] },
        { id: 'before_sleep',    title: 'Перед сном',                      meds: ['Тетрамакс — 1 кап', 'Джилла — 10–15 мл', 'Магній — 300 мг'] },
      ],
    },
  };
}

const PERIOD_ORDER = ['morning', 'day', 'evening', 'night'];

// ════════════════════════════════════════
//  ДОПОМІЖНІ ФУНКЦІЇ
// ════════════════════════════════════════
function parseTime(str) {
  const clean = str.trim().replace(/[.\-,]/, ':');
  const match = clean.match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1]);
  const m = parseInt(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

function fmtTime(t) {
  return `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
}

function buildDayBar(day) {
  let bar = '';
  for (let i = 1; i <= 14; i++) {
    bar += i < day ? '🟢' : i === day ? '🔵' : '⚪';
    if (i === 7) bar += '\n';
  }
  return bar;
}

// ════════════════════════════════════════
//  ЧЕК-ЛИСТ
// ════════════════════════════════════════
function buildChecklist(chatId, day, period) {
  const user = getUser(chatId);
  const sched = getSchedule(day);
  const periodData = sched[period];
  const isEarly = day <= 5;

  let text = `*${periodData.label} — День ${day}/14*`;
  if (isEarly && (period === 'morning' || period === 'evening')) {
    text += ` _(Золопент окремо, дні 1–5)_`;
  }
  text += '\n\n';

  const buttons = [];

  periodData.slots.forEach((slot, slotIdx) => {
    if (slot.meds.length === 0) {
      text += `${slot.title}\n\n`;
      return;
    }
    text += `*${slot.title}*\n`;
    slot.meds.forEach((med, medIdx) => {
      const key = `${day}_${period}_${slotIdx}_${medIdx}`;
      const done = user.checked[key];
      text += `${done ? '✅' : '⬜'} ${med}\n`;
      buttons.push([
        Markup.button.callback(
          `${done ? '✅' : '⬜'} ${med}`,
          `check:${day}:${period}:${slotIdx}:${medIdx}`
        ),
      ]);
    });
    text += '\n';
  });

  text += `⚠️ *За потребою:* Ондансетрон (нудота) | Мебсин (біль)`;
  return { text, buttons };
}

function dayProgress(chatId, day) {
  const user = getUser(chatId);
  const sched = getSchedule(day);
  let total = 0, done = 0;
  PERIOD_ORDER.forEach((period) => {
    sched[period].slots.forEach((slot, slotIdx) => {
      slot.meds.forEach((_, medIdx) => {
        total++;
        if (user.checked[`${day}_${period}_${slotIdx}_${medIdx}`]) done++;
      });
    });
  });
  const pct = Math.round((done / total) * 100);
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  return { done, total, pct, bar };
}

// ════════════════════════════════════════
//  СИСТЕМА НАГАДУВАНЬ
// ════════════════════════════════════════

// Створити одне нагадування і повернути job
function createReminderJob(chatId, remId, med, h, m) {
  return schedule.scheduleJob({ hour: h, minute: m }, async () => {
    try {
      await bot.telegram.sendMessage(
        chatId,
        `💊 *Час прийняти ${med}!*`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Прийнято', `taken:${remId}`)],
          ]).reply_markup,
        }
      );
    } catch (e) {
      console.error(`Reminder job error [${chatId}]:`, e.message);
    }
  });
}

// Зареєструвати нагадування у стані користувача
function addReminder(chatId, med, h, m) {
  const user = getUser(chatId);
  const remId = `${med}_${h}_${m}_${Date.now()}`;
  const job = createReminderJob(chatId, remId, med, h, m);
  user.reminders.push({ id: remId, med, h, m, job });
  return remId;
}

// Видалити одне нагадування
function removeReminder(chatId, remId) {
  const user = getUser(chatId);
  const idx = user.reminders.findIndex(r => r.id === remId);
  if (idx === -1) return false;
  user.reminders[idx].job.cancel();
  user.reminders.splice(idx, 1);
  return true;
}

// Список нагадувань для показу
function buildRemindersList(chatId) {
  const user = getUser(chatId);
  if (!user.reminders.length) {
    return { text: '🔔 *Нагадування*\n\nУ тебе ще немає нагадувань.', buttons: [] };
  }

  // Групуємо по препарату
  const grouped = {};
  user.reminders.forEach(r => {
    if (!grouped[r.med]) grouped[r.med] = [];
    grouped[r.med].push(r);
  });

  let text = '🔔 *Активні нагадування:*\n\n';
  const buttons = [];

  Object.entries(grouped).forEach(([med, rems]) => {
    const times = rems.map(r => fmtTime({ h: r.h, m: r.m })).join(', ');
    text += `💊 *${med}* — ${times}\n`;
    rems.forEach(r => {
      buttons.push([
        Markup.button.callback(
          `🗑 ${med} о ${fmtTime({ h: r.h, m: r.m })}`,
          `del_rem:${r.id}`
        ),
      ]);
    });
  });

  text += '\nНатисни на нагадування щоб видалити:';
  return { text, buttons };
}

// ════════════════════════════════════════
//  МЕНЮ
// ════════════════════════════════════════
const MAIN_MENU = Markup.keyboard([
  ['🌅 Ранок', '☀️ День'],
  ['🌆 Вечір', '🌙 Ніч'],
  ['🔔 Нагадування', '📊 Прогрес'],
  ['📅 Статус курсу'],
]).resize();

const PERIOD_MAP = {
  '🌅 Ранок': 'morning',
  '☀️ День': 'day',
  '🌆 Вечір': 'evening',
  '🌙 Ніч': 'night',
};

const MENU_BUTTONS = [
  '🌅 Ранок', '☀️ День', '🌆 Вечір', '🌙 Ніч',
  '🔔 Нагадування', '📊 Прогрес', '📅 Статус курсу',
];

// ════════════════════════════════════════
//  HANDLERS
// ════════════════════════════════════════

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  user.startDate = new Date();
  user.day = 1;
  user.checked = {};
  user.setupStep = null;
  user.setupTemp = null;

  await ctx.replyWithMarkdown(
    `👋 *Привіт! Я твій помічник з прийому ліків.*\n\n` +
    `📅 Курс на *14 днів* вже розпочато — *День 1*\n\n` +
    `*Що я вмію:*\n` +
    `🌅☀️🌆🌙 — Чек-лист ліків по часу дня\n` +
    `🔔 — Власні нагадування для будь-якого препарату\n` +
    `📊 — Прогрес за поточний день\n\n` +
    `Використовуй кнопки нижче 👇`,
    MAIN_MENU
  );
});

// ── Чек-лист кнопки ──
bot.hears(['🌅 Ранок', '☀️ День', '🌆 Вечір', '🌙 Ніч'], async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  const period = PERIOD_MAP[ctx.message.text];
  const { text, buttons } = buildChecklist(chatId, user.day, period);
  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
});

// ── Прогрес ──
bot.hears('📊 Прогрес', async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  const { done, total, pct, bar } = dayProgress(chatId, user.day);
  await ctx.replyWithMarkdown(
    `📊 *Прогрес — День ${user.day}/14*\n\n` +
    `\`[${bar}] ${pct}%\`\n` +
    `Прийнято: ${done} з ${total} прийомів\n\n` +
    (pct === 100 ? '🎉 Всі ліки на сьогодні прийняті!' : `⏳ Залишилось: ${total - done} прийомів`)
  );
});

// ── Статус курсу ──
bot.hears('📅 Статус курсу', async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  await ctx.replyWithMarkdown(
    `📅 *Статус курсу*\n\n` +
    `📍 Поточний день: *${user.day} з 14*\n` +
    `⏳ Залишилось: *${14 - user.day + 1} днів*\n\n` +
    buildDayBar(user.day)
  );
});

// ── Нагадування — головне меню ──
bot.hears('🔔 Нагадування', async (ctx) => {
  const chatId = ctx.chat.id;
  const { text, buttons } = buildRemindersList(chatId);
  buttons.push([Markup.button.callback('➕ Додати нагадування', 'rem_add')]);
  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
});

// ── Callback: додати нагадування → вибір препарату ──
bot.action('rem_add', async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  user.setupStep = 'pick_med';
  user.setupTemp = { med: null, count: 0, times: [] };

  // Кнопки з препаратами (по 3 в ряд)
  const medButtons = [];
  for (let i = 0; i < MEDS.length; i += 3) {
    medButtons.push(
      MEDS.slice(i, i + 3).map(m => Markup.button.callback(m, `rem_med:${m}`))
    );
  }
  medButtons.push([Markup.button.callback('❌ Скасувати', 'rem_cancel')]);

  await ctx.editMessageText(
    '💊 *Оберіть препарат:*',
    { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(medButtons).reply_markup }
  );
});

// ── Callback: вибрано препарат → вибір кількості ──
bot.action(/^rem_med:(.+)$/, async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  const med = ctx.match[1];
  user.setupTemp.med = med;
  user.setupStep = 'pick_count';

  const countButtons = [
    [1, 2, 3].map(n => Markup.button.callback(`${n}x`, `rem_count:${n}`)),
    [4, 5].map(n => Markup.button.callback(`${n}x`, `rem_count:${n}`)),
    [Markup.button.callback('❌ Скасувати', 'rem_cancel')],
  ];

  await ctx.editMessageText(
    `💊 *${med}*\n\nСкільки разів на день потрібне нагадування?`,
    { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(countButtons).reply_markup }
  );
});

// ── Callback: вибрано кількість → введення першого часу ──
bot.action(/^rem_count:(\d+)$/, async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  const count = parseInt(ctx.match[1]);
  user.setupTemp.count = count;
  user.setupTemp.times = [];
  user.setupStep = 'pick_time_0';

  await ctx.editMessageText(
    `💊 *${user.setupTemp.med}* — ${count}x на день\n\n` +
    `⏰ Введи час для нагадування 1 з ${count}:\n_(наприклад: 8:00 або 20:30)_`,
    { parse_mode: 'Markdown' }
  );
});

// ── Callback: видалити нагадування ──
bot.action(/^del_rem:(.+)$/, async (ctx) => {
  const chatId = ctx.chat.id;
  const remId = ctx.match[1];
  const removed = removeReminder(chatId, remId);

  await ctx.answerCbQuery(removed ? '🗑 Нагадування видалено' : '❌ Не знайдено');

  // Оновити список
  const { text, buttons } = buildRemindersList(chatId);
  buttons.push([Markup.button.callback('➕ Додати нагадування', 'rem_add')]);
  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  } catch (e) {}
});

// ── Callback: "Прийнято" у нагадуванні ──
bot.action(/^taken:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('✅ Відмічено!');
  try {
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ _Прийнято_',
      { parse_mode: 'Markdown' }
    );
  } catch (e) {}
});

// ── Callback: скасувати налаштування ──
bot.action('rem_cancel', async (ctx) => {
  const user = getUser(ctx.chat.id);
  user.setupStep = null;
  user.setupTemp = null;
  await ctx.editMessageText('❌ Скасовано.');
});

// ── Callback: відмітити ліки в чек-листі ──
bot.action(/check:(\d+):(\w+):(\d+):(\d+)/, async (ctx) => {
  const [, day, period, slotIdx, medIdx] = ctx.match;
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  const key = `${day}_${period}_${slotIdx}_${medIdx}`;
  user.checked[key] = !user.checked[key];

  const { text, buttons } = buildChecklist(chatId, parseInt(day), period);
  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  } catch (e) {}
  await ctx.answerCbQuery(user.checked[key] ? '✅ Відмічено!' : '↩️ Знято відмітку');
});

// ── Введення часу (текстові повідомлення) ──
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  const text = ctx.message.text;

  if (MENU_BUTTONS.includes(text)) return;
  if (!user.setupStep || !user.setupStep.startsWith('pick_time_')) return;

  const idx = parseInt(user.setupStep.split('_').pop());
  const time = parseTime(text);

  if (!time) {
    return ctx.reply('❌ Не розумію формат. Спробуй: 8:00 або 20:30');
  }

  user.setupTemp.times.push(time);

  if (user.setupTemp.times.length < user.setupTemp.count) {
    const next = user.setupTemp.times.length;
    user.setupStep = `pick_time_${next}`;
    return ctx.replyWithMarkdown(
      `✅ *${fmtTime(time)}* збережено.\n\n` +
      `⏰ Введи час для нагадування ${next + 1} з ${user.setupTemp.count}:`
    );
  }

  // Всі часи зібрані — створюємо нагадування
  const { med, times } = user.setupTemp;
  times.forEach(t => addReminder(chatId, med, t.h, t.m));

  const timesList = times.map(t => `⏰ ${fmtTime(t)}`).join('\n');
  user.setupStep = null;
  user.setupTemp = null;

  await ctx.replyWithMarkdown(
    `✅ *Нагадування встановлено!*\n\n` +
    `💊 *${med}*\n${timesList}\n\n` +
    `Щодня о цьому часі я нагадаю тобі прийняти ліки.`,
    MAIN_MENU
  );
});

// ════════════════════════════════════════
//  ЗАПУСК
// ════════════════════════════════════════
bot.launch().then(() => console.log('✅ Бот запущено!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
