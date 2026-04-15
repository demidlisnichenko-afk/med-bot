const { Telegraf, Markup } = require('telegraf');
const schedule = require('node-schedule');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// ─── Стан користувачів (в пам'яті; для prod — замінити на SQLite/Redis) ───
const users = {}; // { chatId: { startDate, day, checked: { "1_morning_0": true, ... } } }

function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = { startDate: null, day: 0, checked: {} };
  }
  return users[chatId];
}

// ─── Розклад прийому ліків ───
const SCHEDULE = {
  morning: {
    label: '🌅 РАНОК',
    slots: [
      {
        id: 'wake',
        title: 'Одразу після пробудження',
        meds: ['Золопент — 1 таб'],
      },
      {
        id: 'before_breakfast',
        title: 'Через 15–20 хв (перед сніданком)',
        meds: ['Улькавіс — 2 таб', 'Тетрамакс — 1 кап'],
      },
      {
        id: 'after_breakfast',
        title: 'Після сніданку',
        meds: ['Метронідазол — 2 таб'],
      },
    ],
  },
  day: {
    label: '☀️ ДЕНЬ',
    slots: [
      {
        id: 'before_lunch',
        title: 'За 10–15 хв до обіду',
        meds: ['Тетрамакс — 1 кап'],
      },
      {
        id: 'after_lunch',
        title: 'Після обіду',
        meds: ['Метронідазол — 2 таб'],
      },
      {
        id: 'between_lunch',
        title: 'Через 1,5–2 год після обіду',
        meds: ['Ентерол — 1 кап'],
      },
    ],
  },
  evening: {
    label: '🌆 ВЕЧІР',
    slots: [
      {
        id: 'before_dinner_30',
        title: 'За 30 хв до вечері',
        meds: ['Золопент — 1 таб'],
      },
      {
        id: 'before_dinner_15',
        title: 'За 10–15 хв до вечері',
        meds: ['Улькавіс — 2 таб', 'Тетрамакс — 1 кап'],
      },
      {
        id: 'after_dinner',
        title: 'Після вечері',
        meds: ['Метронідазол — 2 таб'],
      },
    ],
  },
  night: {
    label: '🌙 НІЧ',
    slots: [
      {
        id: 'night_enterol',
        title: 'Через 2 год після вечері',
        meds: ['Ентерол — 1 кап'],
      },
      {
        id: 'before_sleep',
        title: 'Перед сном',
        meds: ['Тетрамакс — 1 кап', 'Джилла — 10–15 мл', 'Магній — 300 мг'],
      },
    ],
  },
};

const PERIOD_ORDER = ['morning', 'day', 'evening', 'night'];

// ─── Формування чек-листу для певного периоду ───
function buildChecklist(chatId, day, period) {
  const user = getUser(chatId);
  const periodData = SCHEDULE[period];
  let text = `*${periodData.label} — День ${day}/14*\n\n`;
  const buttons = [];

  periodData.slots.forEach((slot, slotIdx) => {
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

  text += `\n⚠️ *За потребою:* Ондансетрон (нудота) | Мебсин (біль)`;
  return { text, buttons };
}

// ─── Підрахунок прогресу за день ───
function dayProgress(chatId, day) {
  const user = getUser(chatId);
  let total = 0;
  let done = 0;
  PERIOD_ORDER.forEach((period) => {
    SCHEDULE[period].slots.forEach((slot, slotIdx) => {
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

// ─── /start ───
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  user.startDate = new Date();
  user.day = 1;
  user.checked = {};

  await ctx.replyWithMarkdown(
    `👋 *Привіт! Я твій помічник з прийому ліків.*\n\n` +
    `📅 Курс розрахований на *14 днів*\n` +
    `⏰ Я буду надсилати нагадування 4 рази на день\n\n` +
    `*Розклад нагадувань:*\n` +
    `🌅 Ранок — 08:00\n` +
    `☀️ День — 13:00\n` +
    `🌆 Вечір — 19:00\n` +
    `🌙 Ніч — 22:00\n\n` +
    `Використовуй кнопки нижче для керування:`,
    Markup.keyboard([
      ['🌅 Ранок', '☀️ День'],
      ['🌆 Вечір', '🌙 Ніч'],
      ['📊 Прогрес', '📅 Статус курсу'],
    ]).resize()
  );
});

// ─── Кнопки нижнього меню ───
const PERIOD_MAP = {
  '🌅 Ранок': 'morning',
  '☀️ День': 'day',
  '🌆 Вечір': 'evening',
  '🌙 Ніч': 'night',
};

bot.hears(['🌅 Ранок', '☀️ День', '🌆 Вечір', '🌙 Ніч'], async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  if (!user.startDate) {
    return ctx.reply('Спочатку натисни /start');
  }
  const period = PERIOD_MAP[ctx.message.text];
  const { text, buttons } = buildChecklist(chatId, user.day, period);
  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
});

bot.hears('📊 Прогрес', async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  if (!user.startDate) return ctx.reply('Спочатку натисни /start');

  const { done, total, pct, bar } = dayProgress(chatId, user.day);
  await ctx.replyWithMarkdown(
    `📊 *Прогрес — День ${user.day}/14*\n\n` +
    `\`[${bar}] ${pct}%\`\n` +
    `Прийнято: ${done} з ${total} прийомів\n\n` +
    (pct === 100 ? '🎉 Всі ліки на сьогодні прийняті!' : `⏳ Залишилось: ${total - done} прийомів`)
  );
});

bot.hears('📅 Статус курсу', async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  if (!user.startDate) return ctx.reply('Спочатку натисни /start');

  const daysLeft = 14 - user.day + 1;
  const start = user.startDate.toLocaleDateString('uk-UA');
  await ctx.replyWithMarkdown(
    `📅 *Статус курсу*\n\n` +
    `🗓 Початок: ${start}\n` +
    `📍 Поточний день: *${user.day} з 14*\n` +
    `⏳ Залишилось: *${daysLeft} днів*\n\n` +
    buildProgressBar(user.day)
  );
});

function buildProgressBar(day) {
  let bar = '';
  for (let i = 1; i <= 14; i++) {
    bar += i < day ? '🟢' : i === day ? '🔵' : '⚪';
    if (i === 7) bar += '\n';
  }
  return bar;
}

// ─── Callback: відмітити ліки ───
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
  } catch (e) {
    // повідомлення не змінилось
  }
  await ctx.answerCbQuery(user.checked[key] ? '✅ Відмічено!' : '↩️ Знято відмітку');
});

// ─── Автоматичні нагадування ───
function setupReminders() {
  const reminderConfig = [
    { cron: '0 8 * * *', period: 'morning' },
    { cron: '0 13 * * *', period: 'day' },
    { cron: '0 19 * * *', period: 'evening' },
    { cron: '0 22 * * *', period: 'night' },
  ];

  reminderConfig.forEach(({ cron, period }) => {
    schedule.scheduleJob(cron, async () => {
      for (const [chatId, user] of Object.entries(users)) {
        if (!user.startDate || user.day > 14) continue;

        // Оновити день
        const today = new Date();
        const diffDays = Math.floor((today - user.startDate) / (1000 * 60 * 60 * 24));
        user.day = Math.min(diffDays + 1, 14);

        const { text, buttons } = buildChecklist(chatId, user.day, period);
        try {
          await bot.telegram.sendMessage(chatId, `⏰ *Час приймати ліки!*\n\n${text}`, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
          });
        } catch (e) {
          console.error(`Не вдалось надіслати нагадування ${chatId}:`, e.message);
        }
      }
    });
  });
}

setupReminders();

// ─── Запуск ───
bot.launch().then(() => {
  console.log('✅ Бот запущено!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
