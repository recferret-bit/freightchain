/* EN/RU for the lobby, the replay panel, receipts and the error codes the server sends. Order: ?lang= → fc_lang → freightchain.lang → navigator → en. */
import { store } from '../js/util.js';

const en = {
  "consent.title": "REVIEW THE RULES",
  "consent.intro": "Before paid shifts, prizes or rewards, review the Pre-season rules and privacy notice. Training and EASY remain available without acceptance.",
  "consent.draft": "Local devnet preview: these repository texts are drafts with publication details still to be completed.",
  "consent.rules": "Pre-season rules / terms",
  "consent.privacy": "Privacy notice",
  "consent.age": "I am 18 or older",
  "consent.accept": "ACCEPT THESE VERSIONS",
  "consent.decline": "CONTINUE WITHOUT ACCEPTING",
  "consent.saving": "Saving acceptance…",
  "consent.error": "Acceptance could not be saved. Try again.",
  "consent.retry": "Accepted. Repeat your action to continue.",
  "offer.title": "BEFORE A PAID SHIFT",
  "offer.off": "Tick both before a paid shift. A paid button sends you here until they are on.",
  "offer.on": "Both boxes are on. SOL spent on a paid shift can be lost. A prize is not guaranteed.",
  "offer.age": "I AM 18 OR OLDER",
  "offer.ageHint": "Required before any shift that spends SOL.",
  "offer.loss": "SOL SPENT ON A SHIFT CAN BE LOST",
  "offer.lossHint": "A prize is not guaranteed. This is not a deposit or an investment. This build is Solana devnet.",
  'lang.en': 'EN',
  'lang.ru': 'RU',
  'lobby.tab.new': 'NEW RIDE',
  'lobby.tab.live': 'LIVE',
  'lobby.tab.replays': 'REPLAYS',
  'lobby.tab.board': 'LEADERBOARD',
  'lobby.tab.achievements': 'ACHIEVEMENTS',
  'lobby.tab.garage': 'GARAGE',
  'event.title': 'EVENT TOP-20',
  'event.final': 'EVENT RESULTS',
  'event.pending': 'The table is published after the review: ',
  'event.notScheduled': 'not scheduled',
  'event.finalNote': 'Final list. Prizes are paid manually in USDC; the transaction is linked once recorded.',
  'event.prelimNote': 'Preliminary table, subject to review. Appeals close: ',
  'event.wallet': 'Wallet',
  'event.clean': 'Clean',
  'event.prize': 'Prize (USDC)',
  'event.outside': 'outside the prize standings',
  'event.tx': 'transaction',
  'lobby.tab.profile': 'PROFILE',
  'lobby.signOut': 'SIGN OUT',
  'lobby.training.badge': 'TRAINING · NOT IN REPLAYS',
  'lobby.training.hint': 'Training rides are private: not ranked, no TEN4, never shown in replays.',
  'lobby.tier.free': 'TRAINING',
  'lobby.training.result': 'Training ride – no replay is published.',
  'lobby.replays.footer': 'Replays of finished 1-hour rides. Training rides are never shown. Pool rides appear after the pool\'s review ends.',
  'lobby.replays.emptyMine': 'No replays yet. Your training rides are not shown here.',
  'lobby.replays.poolLocked': 'Public after the review',
  'lobby.live.count': 'on the road',
  'replay.play': 'Play',
  'replay.pause': 'Pause',
  'replay.restart': 'Restart',
  'replay.back': '−10s',
  'replay.forward': '+10s',
  'replay.share': 'Share',
  'replay.mute': 'Mute',
  'replay.fullscreen': 'Fullscreen',
  'replay.camera': 'Camera',
  'replay.speed': 'Speed',
  'replay.gear': 'Gear',
  'replay.damage': 'Damage',
  'replay.progress': 'Route',
  'replay.driver': 'Driver',
  'replay.chat': 'Say something…',
  'replay.send': 'SEND',
  'replay.tip': 'Tip the driver',
  'replay.nothing': 'NOTHING TO WATCH',
  'replay.lobby': 'BACK TO THE LOBBY',
  'receipt.watch': 'WATCH REPLAY',
  'receipt.drive': 'TAKE THE WHEEL (DRIVE)',
  'receipt.loading': 'LOADING RIDE',
  'blink.show': 'SHOW',
  'blink.connect': 'CONNECT WALLET',
  'home.lobby': 'Enter the lobby',
  'home.lead': 'A long-haul replay. Training stays private. Tips go to the driver.',
  'legal.notice': 'Devnet SOL has no cash value. Nothing is signed without your wallet.',
  'error.replay_not_available': 'This replay is not available.',
  'error.replay_locked_until_payout': 'This replay opens after the pool pays out.',
  'error.donation_too_small': 'A tip is at least 0.001 SOL.',
  'error.donation_too_large': 'A tip is at most 1 SOL.',
  'error.too_many_open_orders': 'Three tips are already waiting. Finish one first.',
  'error.pledges_disabled': 'Pledges are turned off.',
  'error.chat_banned': 'Chat is closed for this wallet.',
  'error.chat_link_forbidden': 'Links are not allowed in chat.',
  'error.chat_word_forbidden': 'That word is not allowed in chat.',
  'error.live_rate_limited': 'Slow down — five messages a minute.',
  'error.own_ride': 'That action is not available on your own ride.',
  'error.bad_message': 'That message cannot be posted.',
  'error.donation_expired': 'That tip expired. Start it again.',
  'error.not_found': 'Not found.',
};

const ru = {
  "consent.title": "ПРОЧИТАЙТЕ ПРАВИЛА",
  "consent.intro": "Перед платными поездками, призами или наградами прочитайте правила Pre-season и уведомление о конфиденциальности. Тренировки и EASY доступны без согласия.",
  "consent.draft": "Локальная версия devnet: тексты из репозитория — черновики; сведения для публикации ещё не заполнены.",
  "consent.rules": "Правила Pre-season / условия",
  "consent.privacy": "Уведомление о конфиденциальности",
  "consent.age": "Мне исполнилось 18 лет",
  "consent.accept": "ПРИНЯТЬ ЭТИ ВЕРСИИ",
  "consent.decline": "ПРОДОЛЖИТЬ БЕЗ СОГЛАСИЯ",
  "consent.saving": "Сохраняем согласие…",
  "consent.error": "Не удалось сохранить согласие. Попробуйте ещё раз.",
  "consent.retry": "Согласие сохранено. Повторите действие, чтобы продолжить.",
  "offer.title": "ПЕРЕД ПЛАТНОЙ ПОЕЗДКОЙ",
  "offer.off": "Отметьте оба пункта перед платной поездкой. Иначе кнопка поездки вернёт вас сюда.",
  "offer.on": "Оба пункта отмечены. Потраченные на поездку SOL можно потерять. Приз не гарантирован.",
  "offer.age": "МНЕ ИСПОЛНИЛОСЬ 18 ЛЕТ",
  "offer.ageHint": "Обязательно перед любой поездкой с расходованием SOL.",
  "offer.loss": "ПОТРАЧЕННЫЕ НА ПОЕЗДКУ SOL МОЖНО ПОТЕРЯТЬ",
  "offer.lossHint": "Приз не гарантирован. Это не вклад и не инвестиция. Эта версия работает в Solana devnet.",
  'lang.en': 'EN',
  'lang.ru': 'RU',
  'lobby.tab.new': 'НОВАЯ ПОЕЗДКА',
  'lobby.tab.live': 'В ПУТИ',
  'lobby.tab.replays': 'ПОВТОРЫ',
  'lobby.tab.board': 'ТАБЛИЦА',
  'lobby.tab.achievements': 'ДОСТИЖЕНИЯ',
  'lobby.tab.garage': 'ГАРАЖ',
  'event.title': 'ТОП-20 СОБЫТИЯ',
  'event.final': 'ИТОГИ СОБЫТИЯ',
  'event.pending': 'Таблица публикуется после проверки: ',
  'event.notScheduled': 'не назначено',
  'event.finalNote': 'Итоговый список. Призы выплачиваются вручную в USDC; ссылка на транзакцию появится после записи.',
  'event.prelimNote': 'Предварительная таблица, проверка продолжается. Апелляции до: ',
  'event.wallet': 'Кошелёк',
  'event.clean': 'Чистая дистанция',
  'event.prize': 'Приз (USDC)',
  'event.outside': 'вне призового зачёта',
  'event.tx': 'транзакция',
  'lobby.tab.profile': 'ПРОФИЛЬ',
  'lobby.signOut': 'ВЫЙТИ',
  'lobby.training.badge': 'ТРЕНИРОВКА · НЕТ В ПОВТОРАХ',
  'lobby.training.hint': 'Тренировки личные: без рейтинга, без TEN4, их нет в повторах.',
  'lobby.tier.free': 'ТРЕНИРОВКА',
  'lobby.training.result': 'Тренировка — повтор не публикуется.',
  'lobby.replays.footer': 'Повторы завершённых часовых поездок. Тренировок здесь нет. Поездки пула появляются после проверки.',
  'lobby.replays.emptyMine': 'Повторов пока нет. Тренировки сюда не попадают.',
  'lobby.replays.poolLocked': 'Станет публичным после проверки',
  'lobby.live.count': 'на дороге',
  'replay.play': 'Пуск',
  'replay.pause': 'Пауза',
  'replay.restart': 'Сначала',
  'replay.back': '−10 с',
  'replay.forward': '+10 с',
  'replay.share': 'Ссылка',
  'replay.mute': 'Звук',
  'replay.fullscreen': 'На весь экран',
  'replay.camera': 'Камера',
  'replay.speed': 'Скорость',
  'replay.gear': 'Передача',
  'replay.damage': 'Урон',
  'replay.progress': 'Маршрут',
  'replay.driver': 'Водитель',
  'replay.chat': 'Написать…',
  'replay.send': 'ОТПРАВИТЬ',
  'replay.tip': 'Чаевые водителю',
  'replay.nothing': 'СМОТРЕТЬ НЕЧЕГО',
  'replay.lobby': 'НАЗАД В ЛОББИ',
  'receipt.watch': 'СМОТРЕТЬ ПОВТОР',
  'receipt.drive': 'ЗА РУЛЬ',
  'receipt.loading': 'ЗАГРУЗКА ПОЕЗДКИ',
  'blink.show': 'ПОКАЗАТЬ',
  'blink.connect': 'КОШЕЛЁК',
  'home.lobby': 'В лобби',
  'home.lead': 'Повтор длинного рейса. Тренировка остаётся личной. Чаевые идут водителю.',
  'legal.notice': 'Devnet SOL не имеет денежной стоимости. Подпись только через ваш кошелёк.',
  'error.replay_not_available': 'Этот повтор недоступен.',
  'error.replay_locked_until_payout': 'Повтор откроется после выплаты пула.',
  'error.donation_too_small': 'Чаевые не меньше 0,001 SOL.',
  'error.donation_too_large': 'Чаевые не больше 1 SOL.',
  'error.too_many_open_orders': 'Уже ждут три чаевых. Сначала завершите одно.',
  'error.pledges_disabled': 'Обещания отключены.',
  'error.chat_banned': 'Чат для этого кошелька закрыт.',
  'error.chat_link_forbidden': 'Ссылки в чате запрещены.',
  'error.chat_word_forbidden': 'Это слово в чате запрещено.',
  'error.live_rate_limited': 'Медленнее — пять сообщений в минуту.',
  'error.own_ride': 'На своей поездке это недоступно.',
  'error.bad_message': 'Такое сообщение отправить нельзя.',
  'error.donation_expired': 'Чаевые истекли. Начните снова.',
  'error.not_found': 'Не найдено.',
};

export const DICT = { en, ru };

export function resolveLang({ query, stored, storedLegacy, language } = {}) {
  if (query === 'ru' || query === 'en') return query;
  if (stored === 'ru' || stored === 'en') return stored;
  if (storedLegacy === 'ru' || storedLegacy === 'en') return storedLegacy;
  return String(language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function currentLang() {
  let query = null;
  try { query = new URL(location.href).searchParams.get('lang'); } catch { /* no location in a worker */ }
  const lang = resolveLang({ query, stored: store.get('fc_lang'), storedLegacy: store.get('freightchain.lang'), language: typeof navigator === 'undefined' ? '' : navigator.language });
  if (query === 'ru' || query === 'en') saveLang(lang);
  return lang;
}

export function saveLang(lang) {
  store.set('fc_lang', lang);
  store.set('freightchain.lang', lang);
}

export function t(key, lang = currentLang()) {
  const table = DICT[lang] || DICT.en;
  return table[key] || DICT.en[key] || key;
}

export function errorText(code, lang = currentLang()) {
  return t(`error.${code}`, lang);
}

export function applyI18n(root = typeof document === 'undefined' ? null : document) {
  if (!root) return currentLang();
  const lang = currentLang();
  if (root.documentElement) root.documentElement.lang = lang;
  const nodes = root.querySelectorAll ? root.querySelectorAll('[data-i18n]') : [];
  for (const node of nodes) {
    const value = t(node.getAttribute('data-i18n'), lang);
    const attr = node.getAttribute('data-i18n-attr');
    if (attr) node.setAttribute(attr, value);
    else node.textContent = value;
  }
  return lang;
}

export function bootI18n(root = typeof document === 'undefined' ? null : document) {
  if (!root?.addEventListener) return applyI18n(root);
  root.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-set-lang]');
    if (!button) return;
    const lang = button.getAttribute('data-set-lang');
    if (lang !== 'en' && lang !== 'ru') return;
    saveLang(lang);
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    applyI18n(root);
  });
  return applyI18n(root);
}
