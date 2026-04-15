const { Telegraf, Markup } = require('telegraf');
const schedule = require('node-schedule');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// ─── Стан користувачів ───
const users = {};
// { chatId: { startDate, day, checked, meals: { breakfast, lunch, dinner }, jobs: [], setupStep } }

function getUser(chatId) {
  if (!users[chatId]) {
    users[chatId] = {
      startDate: null,
      day: 0,
      checked: {},
      meals: null,
      jobs: [],
      setupStep: null,
    };
  }
  return users[chatId];
}

// ─── Розклад прийому ліків ───
const SCHEDULE = {
  morning: {
    label: '🌅 РАНОК',
    slots: [
      { id: 'wake', title: 'Одразу після пробудження', meds: ['Золопент — 1 таб'] },
      { id: 'before_breakfast', title: 'Через 15–20 хв (перед сніданком)', meds: ['Улькавіс — 2 таб', 'Тетрамакс — 1 кап'] },
      { id: 'after_breakfast', title: 'Після сніданку', meds: ['Метронідазол — 2 таб'] },
    ],
  },
  day: {
    label: '☀️ ДЕНЬ',
    slots: [
      { id: 'before_lunch', title: 'За 10–15 хв до обіду', meds: ['Тетрамакс — 1 кап'] },
      { id: 'after_lunch', title: 'Після обіду', meds: ['Метронідазол — 2 таб'] },
      { id: 'between_lunch', title: 'Через 1,5–2 год після обіду', meds: ['Ентерол — 1 кап'] },
    ],
  },
  evening: {
    label: '🌆 ВЕЧІР',
    slots: [
      { id: 'before_dinner_30', title: 'За 30 хв до вечері', meds: ['Золопент — 1 таб'] },
      { id: 'before_dinner_15', title: 'За 10–15 хв до вечері', meds: ['Улькавіс — 2 таб', 'Тетрамакс — 1 кап'] },
      { id: 'after_dinner', title: 'Після вечері', meds: ['Метронідазол — 2 таб'] },
    ],
  },
  night: {
    label: '🌙 НІЧ',
    slots: [
      { id: 'night_enterol', title: 'Через 2 год після вечері', meds: ['Ентерол — 1 кап'] },
      { id: 'before_sleep', title: 'Перед сном', meds: ['Тетрамакс — 1 кап', 'Джилла — 10–15 мл', 'Магній — 300 мг'] },
    ],
  },
};

const PERIOD_ORDER = ['morning', 'day', 'evening', 'night'];

// ─── Парсинг часу "8:30" або "830" або "8.30" ───
function parseTime(str) {
  const clean = str.trim().replace('.', ':').replace('-', ':');
  const match = clean.match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1]);
  const m = parseInt(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

// ─── Додати хвилини до { h, m } ───
function addMinutes(time, mins) {
  const total = time.h * 60 + time.m + mins;
  return { h: Math.floor(total / 60) % 24, m: total % 60 };
}

// ─── Розрахунок часів нагадувань на основі часу їжі ───
function calcReminders(meals) {
  const b = parseTime(meals.breakfast);
  const l = parseTime(meals.lunch);
  const d = parseTime(meals.dinner);

  return {
    morning: addMinutes(b, -20),   // за 20 хв до сніданку (Золопент)
    day: addMinutes(l, -15),       // за 15 хв до обіду (Тетрамакс)
    evening: addMinutes(d, -30),   // за 30 хв до вечері (Золопент)
    night: addMinutes(d, 120),     // через 2 год після вечері (Ентерол + сон)
  };
}

// ─── Форматування часу ───
function fmtTime(t) {
  return `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
}

// ─── Чек-лист ───
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

  text += `⚠️ *За потребою:* Ондансетрон (нудота) | Мебсин (біль)`;
  return { text, buttons };
}

// ─── Прогрес ───
function dayProgress(chatId, day) {
  const user = getUser(chatId);
  let total = 0, done = 0;
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

function buildDayBar(day) {
  let bar = '';
  for (let i = 1; i <= 14; i++) {
    bar += i < day ? '🟢' : i === day ? '🔵' : '⚪';
    if (i === 7) bar += '\n';
  }
  return bar;
}

// ─── Скасувати старі jobs ───
function cancelJobs(chatId) {
  const user = getUser(chatId);
  if (user.jobs && user.jobs.length) {
    user.jobs.forEach(j => j.cancel());
    user.jobs = [];
  }
}

// ─── Запустити нагадування для користувача ───
function scheduleReminders(chatId) {
  cancelJobs(chatId);
  const user = getUser(chatId);
  const times = calcReminders(user.meals);

  const entries = [
    { time: times.morning, period: 'morning' },
    { time: times.day,     period: 'day' },
    { time: times.evening, period: 'evening' },
    { time: times.night,   period: 'night' },
  ];

  entries.forEach(({ time, period }) => {
    const job = schedule.scheduleJob(
      { hour: time.h, minute: time.m },
      async () => {
        if (!user.startDate || user.day > 14) return;

        const diffDays = Math.floor((Date.now() - user.startDate) / 86400000);
        user.day = Math.min(diffDays + 1, 14);

        const { text, buttons } = buildChecklist(chatId, user.day, period);
        try {
          await bot.telegram.sendMessage(
            chatId,
            `⏰ *Час приймати ліки!*\n\n${text}`,
            { parse_mode: 'Markdown', reply_markup: Markup.inlineKeyboard(buttons).reply_markup }
          );
        } catch (e) {
          console.error(`Reminder error ${chatId}:`, e.message);
        }
      }
    );
    user.jobs.push(job);
  });
}

// ════════════════════════════════════════
//  КОМАНДИ ТА ХЕНДЛЕРИ
// ════════════════════════════════════════

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  user.setupStep = 'breakfast';
  user.meals = {};

  await ctx.replyWithMarkdown(
    `👋 *Привіт! Я твій помічник з прийому ліків.*\n\n` +
    `📅 Курс розрахований на *14 днів*\n\n` +
    `Спочатку налаштуємо розклад під твій режим харчування, щоб нагадування приходили у зручний час.\n\n` +
    `🍳 *О котрій годині ти зазвичай снідаєш?*\n` +
    `_(Напиши у форматі 8:30 або 9:00)_`
  );
});

// ─── Діалог налаштування + обробка всіх текстових повідомлень ───
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  const text = ctx.message.text;

  // Кнопки меню — пропускаємо, обробляються через hears нижче
  const menuButtons = ['🌅 Ранок', '☀️ День', '🌆 Вечір', '🌙 Ніч', '📊 Прогрес', '📅 Статус курсу', '⚙️ Змінити розклад'];
  if (menuButtons.includes(text)) return;

  if (!user.setupStep) return;

  const time = parseTime(text);
  if (!time) {
    return ctx.reply('❌ Не розумію формат. Спробуй ще раз, наприклад: 8:30 або 13:00');
  }

  if (user.setupStep === 'breakfast') {
    user.meals.breakfast = text;
    user.setupStep = 'lunch';
    return ctx.replyWithMarkdown(
      `✅ Сніданок: *${fmtTime(time)}*\n\n🍽 *О котрій обідаєш?*\n_(наприклад: 13:00)_`
    );
  }

  if (user.setupStep === 'lunch') {
    user.meals.lunch = text;
    user.setupStep = 'dinner';
    return ctx.replyWithMarkdown(
      `✅ Обід: *${fmtTime(time)}*\n\n🍲 *О котрій вечеряєш?*\n_(наприклад: 19:00)_`
    );
  }

  if (user.setupStep === 'dinner') {
    user.meals.dinner = text;
    user.setupStep = null;

    user.startDate = new Date();
    user.day = 1;
    user.checked = {};

    const times = calcReminders(user.meals);
    scheduleReminders(chatId);

    await ctx.replyWithMarkdown(
      `✅ Вечеря: *${fmtTime(time)}*\n\n` +
      `🎉 *Відмінно! Розклад налаштовано.*\n\n` +
      `⏰ *Нагадування приходитимуть:*\n` +
      `🌅 Ранок — *${fmtTime(times.morning)}* _(за 20 хв до сніданку)_\n` +
      `☀️ День — *${fmtTime(times.day)}* _(за 15 хв до обіду)_\n` +
      `🌆 Вечір — *${fmtTime(times.evening)}* _(за 30 хв до вечері)_\n` +
      `🌙 Ніч — *${fmtTime(times.night)}* _(через 2 год після вечері)_\n\n` +
      `📅 Курс почався сьогодні — *День 1 з 14* 💪\n\n` +
      `Використовуй кнопки нижче 👇`,
      Markup.keyboard([
        ['🌅 Ранок', '☀️ День'],
        ['🌆 Вечір', '🌙 Ніч'],
        ['📊 Прогрес', '📅 Статус курсу'],
        ['⚙️ Змінити розклад'],
      ]).resize()
    );
  }
});

// ─── Кнопки меню ───
const PERIOD_MAP = { '🌅 Ранок': 'morning', '☀️ День': 'day', '🌆 Вечір': 'evening', '🌙 Ніч': 'night' };

bot.hears(['🌅 Ранок', '☀️ День', '🌆 Вечір', '🌙 Ніч'], async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  if (!user.startDate) return ctx.reply('Спочатку натисни /start та налаштуй розклад.');
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
  const times = calcReminders(user.meals);
  await ctx.replyWithMarkdown(
    `📅 *Статус курсу*\n\n` +
    `📍 Поточний день: *${user.day} з 14*\n` +
    `⏳ Залишилось: *${14 - user.day + 1} днів*\n\n` +
    buildDayBar(user.day) + '\n\n' +
    `⏰ *Твій розклад нагадувань:*\n` +
    `🌅 Ранок — ${fmtTime(times.morning)}\n` +
    `☀️ День — ${fmtTime(times.day)}\n` +
    `🌆 Вечір — ${fmtTime(times.evening)}\n` +
    `🌙 Ніч — ${fmtTime(times.night)}`
  );
});

bot.hears('⚙️ Змінити розклад', async (ctx) => {
  const chatId = ctx.chat.id;
  const user = getUser(chatId);
  user.setupStep = 'breakfast';
  user.meals = {};
  await ctx.replyWithMarkdown(
    `⚙️ *Змінюємо розклад*\n\n` +
    `🍳 *О котрій снідаєш?*\n_(наприклад: 8:30)_`
  );
});

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
  } catch (e) {}
  await ctx.answerCbQuery(user.checked[key] ? '✅ Відмічено!' : '↩️ Знято відмітку');
});

// ─── Запуск ───
bot.launch().then(() => console.log('✅ Бот запущено!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
