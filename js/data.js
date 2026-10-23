// Данные игры «Железный Меридиан». Всё, что можно настраивать, лежит здесь.

export const VERSION = '0.7.0 (экономика, новый интерфейс, тактическая карта)';


// Вымышленные названия провинций
export const NAMES = [
  'Ардена', 'Бельмонт', 'Вэйстон', 'Гарнхольм', 'Дорвик', 'Эльстрем', 'Фрайберг', 'Гросвен', 'Хальден', 'Ирвинг',
  'Йорсвик', 'Кастелла', 'Лорнвуд', 'Мирабель', 'Нордхейм', 'Остара', 'Пайнрок', 'Квинтар', 'Ринвальд', 'Сторвик',
  'Тарвен', 'Уэлдон', 'Вестмарч', 'Ксандер', 'Ярнхейм', 'Зальцберг', 'Аквила', 'Броннер', 'Кэрнфорд', 'Дальвик',
  'Эстермарк', 'Фьельстад', 'Горнстад', 'Хельмут', 'Исбьерг', 'Кронвальд', 'Леонис', 'Мальверн', 'Нерида', 'Оберн',
  'Приморье-Ост', 'Рикенау', 'Силвана', 'Торнхолл', 'Ульвик', 'Вальгард', 'Винтерхолм', 'Акрополь', 'Бореас', 'Кассия',
  'Дамаск-Ост', 'Эмбер', 'Фаргрейв', 'Галвен', 'Хоровиц', 'Иллирия', 'Кадмус', 'Лагуна', 'Мартель', 'Некрон-Холл',
  'Овернь-Ост', 'Пеллас', 'Рейнхард', 'Сольвейг', 'Таллин-Ост', 'Урсула', 'Вельтан', 'Эрдвин', 'Зефира', 'Бранденвик',
  'Касторп', 'Дувр-Ост', 'Эйлиф', 'Фрейя-Бей', 'Гласхольм', 'Харвик', 'Инверно', 'Юнгфрау', 'Кельтон', 'Лиссабор',
  'Альтенау', 'Бирнхольм', 'Ворхейм', 'Грюнвальд', 'Дрезден-Ост', 'Ильмар', 'Каррен', 'Лоренсбург', 'Мельхиор', 'Нордвальд', 'Оттенхейм', 'Пирсвик', 'Равенхолл', 'Свенборг', 'Тирнау', 'Эйнхольм', 'Ястребиный Мыс', 'Белая Гавань', 'Серебряный Ключ', 'Железный Брод', 'Каменка', 'Озёрный', 'Приморск-Ост', 'Северный Предел', 'Тихая Бухта', 'Золотая Долина', 'Ветролом', 'Громовая', 'Дубрава', 'Еловая', 'Ясный Берег', 'Волчий Лог', 'Зелёный Холм', 'Лунная Пристань', 'Медный Рудник', 'Новый Стрелецк', 'Орлиное', 'Рассвет', 'Соколиный', 'Туманный', 'Угольный', 'Хрустальный', 'Чёрная Скала', 'Шторм-Бей', 'Янтарная', 'Арден-Тор', 'Брекенридж', 'Валлорн', 'Гэлвей-Ост', 'Дорнхейм', 'Эстуария', 'Форт-Рейн', 'Гранитный', 'Хэвенмор', 'Ирония', 'Кингсмарк', 'Ластхольм', 'Монтерра', 'Нордкап', 'Окрестность', 'Портеро', 'Квартхейм', 'Ривервуд', 'Сансет-Холл', 'Тэрнбридж',
];

export const RES = ['money', 'steel', 'fuel', 'electronics', 'gold', 'rare', 'ore', 'food'];
export const TRADE_RES = ['ore', 'steel', 'fuel', 'food', 'electronics', 'gold', 'rare']; // то, чем можно торговать
export const RES_LABEL = {
  money: 'Деньги',
  steel: 'Сталь',
  fuel: 'Топливо',
  electronics: 'Электроника',
  gold: 'Золото',
  rare: 'Редкие металлы',
  ore: 'Руда',
  food: 'Еда',
  energy: 'Энергия',
};
export const RES_ICON = { money: '💰', steel: '🔩', fuel: '⛽', electronics: '🔌', gold: '🪙', rare: '💎', ore: '⛰️', food: '🌾', energy: '⚡' };
// Справочная цена за единицу (деньги). От неё считаются все сделки.
export const BASE_PRICE = { ore: 0.8, steel: 1.2, fuel: 1.5, food: 2, electronics: 12, gold: 6, rare: 5 };
// Целевой запас: выше него рыночная цена продажи падает (до 40% базовой)
export const STOCK_TARGET = { ore: 600, steel: 500, fuel: 500, food: 400, electronics: 150, gold: 150, rare: 150 };

// Месторождения: что это, чем добывается
export const DEPOSITS = {
  steel: { name: 'Руда', icon: '⛰️', building: 'mine' },
  oil: { name: 'Нефть', icon: '🛢', building: 'refinery' },
  gold: { name: 'Золото', icon: '🪙', building: 'goldmine' },
  rare: { name: 'Редкие металлы', icon: '💎', building: 'raremine' },
};
export const DEPOSIT_KINDS = Object.keys(DEPOSITS);

// Вымышленные государства (без реальных флагов и названий)
export const STATES_DEF = [
  { id: 0, name: 'Нордия', color: '#5b8fd9', desc: 'Холодный север: много руды и редких металлов, мало нефти, нет золота.',
    deposits: { steel: 'A', rare: 'A', oil: 'S', gold: 0 }, trait: { greed: 1.0, hostile: 0.5 }, pers: { aggr: 0.5, honor: 0.7, greed: 0.5, caution: 0.6, ideo: 'order' }, bonus: { ore: 1.15 }, perk: '+15% к добыче руды' },
  { id: 1, name: 'Аурелия', color: '#d9a441', desc: 'Торговая республика: золото и нефть, но нет руды.',
    deposits: { gold: 'A', oil: 'A', rare: 'S', steel: 0 }, trait: { greed: 1.25, hostile: 0.2 }, pers: { aggr: 0.2, honor: 0.45, greed: 0.85, caution: 0.7, ideo: 'trade' }, bonus: { tax: 1.15, sell: 1.15 }, perk: '+15% к налогам и продажам' },
  { id: 2, name: 'Каспия', color: '#c4574f', desc: 'Нефтяная федерация: нефть и руда, нет редких металлов.',
    deposits: { oil: 'A', steel: 'A', gold: 'S', rare: 0 }, trait: { greed: 0.9, hostile: 0.8 }, pers: { aggr: 0.8, honor: 0.4, greed: 0.6, caution: 0.3, ideo: 'order' }, bonus: { fuel: 1.15 }, perk: '+15% к выпуску топлива' },
  { id: 3, name: 'Венедия', color: '#6aa86a', desc: 'Лесной союз: золото и редкие металлы, мало нефти и руды.',
    deposits: { gold: 'A', rare: 'A', steel: 'S', oil: 'S' }, trait: { greed: 1.0, hostile: 0.3 }, pers: { aggr: 0.25, honor: 0.8, greed: 0.45, caution: 0.55, ideo: 'freedom' }, bonus: { growth: 1.1 }, perk: '+10% к росту населения' },
];
// 'A' — богатые недра (несколько месторождений), 'S' — одно скромное, 0 — нет совсем.

// Дипломатия: базовое отношение пар государств (к нему тянется со временем) и параметры
export const DIP_BASE = { '0-1': 15, '0-2': -25, '0-3': 10, '1-2': 5, '1-3': 28, '2-3': -12 };
export const DIP = {
  friendMin: 20, allyMin: 55, tradeBonus: 0.12, closedTension: 0.35,
  offerLife: 14, warPeaceDays: 40, giftRel: 6,
  // --- модель отношений ---
  halfLife: 70,           // период полураспада обид и услуг, дней
  wTrust: 0.4, wInterest: 1, wThreat: 0.22, wRespect: 0.1, wBase: 0.5,
  repStart: 62, repGain: 0.05, repViolation: 16, repSuddenWar: 11, aggrSuddenWar: 24, aggrWarWithCb: 6,
  powerSmooth: 0.08,      // сглаживание мощи
  // --- дипвес ---
  infStart: 24, infCap: 120, infBase: 0.35, infPerEmbassy: 0.6, infPerMfa: 1.8, infPerAmb: 0.08,
  ambBase: 2, ambPerEmbassy: 1,
  // --- кризисы и война ---
  ultDays: 7, callDays: [3, 7], crisisStepDays: 3, cbDays: 40, truceDays: 30, warCooldown: 45,
  mobilizeCost: 0.04, blockadePort: 0.5, sanctionCut: 0.12, tributeShare: 0.1,
  warDmg: 0.03, exhRate: 0.35,
  // --- экономика ---
  tradeAgreeCap: 0.15, tradeAgreeSell: 0.05, allyShareRate: 4, loanRate: 0.0012,
  // --- события ---
  eventEvery: 14, knowGain: 0.35, knowEmbassy: 0.6,
};
// Стоимость действий в очках влияния
export const DIP_COST = {
  relations: 3, amb: 2, gift: 3, deal: 1, trade: 4, friend: 5, nap: 4, defense: 8, offense: 10, ally: 12, protect: 14,
  truce: 3, whitepeace: 3, peacetreaty: 4, aid: 3, loan: 4, mediate: 6, scout: 5, protest: 2, show: 5, ultimatum: 8, mobilize: 8, blockade: 10, sanction: 6, war: 0,
};
// Лестница договоров: условия, срок (0 — бессрочный), оговорки
export const TREATIES = {
  trade:   { name: 'Торговое соглашение', icon: '📦', days: 90, tier: 1, info: '+15% к лимиту торговли, +5% к цене продажи, граница открыта.' },
  friend:  { name: 'Договор о дружбе', icon: '🤝', days: 0, tier: 1, info: 'Тёплые отношения, взаимная выгода от торговли.' },
  nap:     { name: 'Пакт о ненападении', icon: '🕊️', days: 90, tier: 2, info: 'Стороны не нападают друг на друга. Не прекращает войну и не защищает от третьих стран.' },
  defense: { name: 'Оборонный пакт', icon: '🛡️', days: 120, tier: 3, info: 'При нападении на партнёра вы получаете призыв о помощи.', clauses: ['binding', 'noChain'] },
  offense: { name: 'Наступательный пакт', icon: '⚔️', days: 60, tier: 3, info: 'Совместная война против указанной цели.', needsTarget: true },
  ally:    { name: 'Союз', icon: '🏛️', days: 0, tier: 4, info: 'Обязательная взаимная защита, общий рынок снабжения.' },
  protect: { name: 'Протекторат', icon: '👑', days: 0, tier: 4, info: 'Покровитель защищает слабого и получает 10% его налогов. Вассал не вправе воевать и заключать договоры сам.' },
  truce:   { name: 'Перемирие', icon: '🏳️', days: 30, tier: 0, info: 'Огонь прекращён на срок. После срока война заканчивается.' },
  whitepeace: { name: 'Белый мир', icon: '☮️', days: 0, tier: 0, info: 'Война окончена без условий.' },
  peacetreaty: { name: 'Мирный договор', icon: '📜', days: 90, tier: 0, info: 'Мир с контрибуцией и демилитаризованной зоной (боевая часть подключится вместе с армиями).' },
};
// Лестница эскалации
export const ESCALATION = [
  { id: 'protest', name: 'Протест', icon: '📣', info: 'Дипломатическая нота: цель знает о претензии.' },
  { id: 'show', name: 'Демонстрация силы', icon: '🎖️', info: 'Показ мощи у границы. Стоит денег, пугает соседа.' },
  { id: 'ultimatum', name: 'Ультиматум', icon: '⏳', info: 'Требование со сроком. Отказ даёт повод к войне.' },
  { id: 'mobilize', name: 'Мобилизация', icon: '🚨', info: 'Обе страны несут расходы, производство падает.' },
  { id: 'blockade', name: 'Блокада и эмбарго', icon: '🚢', info: 'Торговля цели режется, порты блокированы.' },
  { id: 'war', name: 'Война', icon: '💥', info: 'Объявление войны.' },
];
// Сложность дипломатии ботов
export const DIP_DIFF = {
  easy:   { aggr: 0.55, lenient: 8, noise: 1.2, coalition: 0.6, event: 0.7 },
  normal: { aggr: 1, lenient: 0, noise: 1, coalition: 1, event: 1 },
  hard:   { aggr: 1.1, lenient: -4, noise: 0.45, coalition: 1.5, event: 1.15 },
};
export const PERS_NAMES = { aggr: 'Агрессивность', honor: 'Честь', greed: 'Жадность', caution: 'Осторожность', ideo: 'Идеология' };
export const IDEO_NAMES = { trade: 'торговая', order: 'порядок', freedom: 'свобода' };


export const TERRAIN = {
  plains: { name: 'Равнина', color: '#7e9a5a' },
  hills: { name: 'Холмы', color: '#a08f5c' },
  mountains: { name: 'Горы', color: '#8a8a8f' },
  coast: { name: 'Побережье', color: '#a9b98a' },
};

// Стартовые ресурсы любого государства
export const START = { money: 700, steel: 110, fuel: 90, electronics: 0, gold: 15, rare: 10, ore: 40, food: 800 };

// Здания.
// cost — цена 1 уровня (каждый следующий дороже в LEVEL_COST_MULT раз)
// days — время строительства, jobs — рабочие места (за уровень)
// housing — вместимость жилья (за уровень), energy — потребление (<0 означает выработку)
// produces/consumes — в день при полном обеспечении (за уровень)
// needs — нужно месторождение в провинции
export const LEVEL_COST_MULT = 1.6;
export const MAX_LEVEL = 3;

export const BUILDINGS = {
  housing: {
    name: 'Жилой квартал', icon: '🏘️', cost: { money: 300, steel: 20 }, days: 6,
    jobs: 20, housing: 400, energy: 2,
    desc: 'Даёт жильё: население растёт и платит налоги.',
  },
  mine: {
    name: 'Рудник', icon: '⛏️', cost: { money: 450, steel: 10 }, days: 8,
    jobs: 300, energy: 6, produces: { ore: 12 }, needs: 'steel',
    desc: 'Добывает руду. Нужно месторождение руды. Из руды на заводе плавят сталь.',
  },
  refinery: {
    name: 'НПЗ', icon: '🛢️', cost: { money: 650, steel: 40 }, days: 10,
    jobs: 350, energy: 8, produces: { fuel: 12 }, needs: 'oil',
    desc: 'Перерабатывает нефть в топливо. Нужно месторождение нефти.',
  },
  power: {
    name: 'Электростанция', icon: '⚡', cost: { money: 800, steel: 60 }, days: 10,
    jobs: 150, energy: -30, consumes: { fuel: 2 },
    desc: 'Вырабатывает энергию для всех зданий государства. Жжёт топливо.',
  },
  steelworks: {
    name: 'Сталелитейный завод', icon: '🏭', cost: { money: 900, steel: 60 }, days: 12,
    jobs: 450, energy: 12, consumes: { ore: 6, fuel: 1 }, produces: { steel: 10 },
    desc: 'Руда и топливо → сталь. Сталь нужна для стройки и электроники.',
  },
  farm: {
    name: 'Ферма', icon: '🌾', cost: { money: 350, steel: 10 }, days: 6,
    jobs: 120, energy: 2, produces: { food: 24 }, needsFlat: true,
    desc: 'Выращивает еду. Только на ровной земле без леса. Город ест 1 ед. в день на 100 жителей.',
  },
  hydro: {
    name: 'Гидростанция', icon: '💧', cost: { money: 700, steel: 50 }, days: 10,
    jobs: 120, energy: -22, needsRiver: true,
    desc: 'Даёт энергию без топлива. Строится только у реки.',
  },
  warehouse: {
    name: 'Склад', icon: '📦', cost: { money: 600, steel: 50 }, days: 7,
    jobs: 40, energy: 1, storage: 3000,
    desc: 'Увеличивает лимит хранения каждого ресурса на 3000 за уровень.',
  },
  embassy: { name: 'Посольский квартал', icon: '🏛️', desc: 'Даёт очки влияния и места для послов. Нужен для дипломатии.', cost: { money: 450, steel: 30 }, days: 8, jobs: 40, energy: 2, influence: 1 },
  mfa: { name: 'Министерство иностранных дел', icon: '🕴️', desc: 'Много очков влияния: хватает на договоры, ультиматумы и посредничество.', cost: { money: 1300, steel: 70 }, days: 14, jobs: 80, energy: 4, influence: 3 },
  port: {
    name: 'Порт / торговый пост', icon: '⚓', cost: { money: 900, steel: 60 }, days: 10,
    jobs: 150, energy: 4, market: 120,
    desc: 'Увеличивает дневной лимит торговли на мировом рынке на 120 ед. за уровень.',
  },
  goldmine: {
    name: 'Золотой рудник', icon: '🪙', cost: { money: 700, steel: 30 }, days: 9,
    jobs: 280, energy: 6, produces: { gold: 3 }, needs: 'gold',
    desc: 'Добывает золото. Нужно месторождение золота. Золото ценится в торговле.',
  },
  raremine: {
    name: 'Рудник редких металлов', icon: '💎', cost: { money: 800, steel: 40 }, days: 10,
    jobs: 300, energy: 7, produces: { rare: 3 }, needs: 'rare',
    desc: 'Добывает редкие металлы для электроники.',
  },
  electronics: {
    name: 'Завод электроники', icon: '🔌', cost: { money: 1000, steel: 80 }, days: 12,
    jobs: 400, energy: 10, consumes: { steel: 4, gold: 0.5, rare: 0.8 }, produces: { electronics: 3 },
    desc: 'Сталь, золото и редкие металлы → электроника. Нужна для техники и ракет.',
  },
};

export const BUILD_ORDER = ['housing', 'farm', 'power', 'hydro', 'mine', 'refinery', 'steelworks', 'electronics', 'goldmine', 'raremine', 'warehouse', 'port', 'embassy', 'mfa'];

// Города: уровень зависит от населения, определяет число слотов
export const CITY_LEVELS = [
  { min: 0, slots: 6, name: 'Посёлок' },
  { min: 2000, slots: 8, name: 'Город' },
  { min: 5000, slots: 10, name: 'Крупный город' },
];

export const ECON = {
  upkeepRate: 0.004,      // содержание здания в день от его цены за уровень
  storageBase: 2000,      // лимит хранения любого ресурса без складов
  marketBase: 40,         // дневной лимит торговли на рынке (ед.)
  sellFloor: 0.4,         // нижняя граница цены продажи от базовой
  buyMarkup: 1.25,        // наценка покупки
  overflowPrice: 0.4,     // по какой доле базовой цены продаётся излишек сверх склада
  foodPer100: 1,          // еды в день на 100 жителей
  famineDays: 10,         // сколько дней голода до убыли населения
  hireShare: 0.3,         // доля свободных рабочих соседей, которых можно нанять
  upgElecDiv: 60,         // электроника для улучшения до 3 ур. = деньги / это число
  energyValue: 0.6,       // условная цена единицы энергии (для прогноза окупаемости)
  cancelRefund: 0.8,      // возврат при отмене стройки
  botEvery: { easy: 8, normal: 4, hard: 2 },
  botIncome: { easy: 0.9, normal: 1, hard: 1.15 },
  workerShare: 0.6, // доля населения, которая может работать
  taxPerPop: 0.006,
  taxPerJob: 0.03,
  extractorFloor: 0.3, // добыча идёт от автономных генераторов даже без сети
  growth: 0.004,
  baseCapCapital: 3500,
  baseCapOther: 700,
  demolishRefund: 0.3,
};

export const SPEEDS = [0, 0.2, 0.5, 1.2]; // игровых дней в секунду (1 день = 5 секунд на обычной скорости)

// ---- цвета и параметры стиля 3D-карты (меняйте здесь) ----
export const TERRAIN_COLORS = {
  deep: [16, 62, 112], mid: [28, 108, 164], shallow: [78, 176, 200], foam: [232, 244, 240],
  sand: [226, 210, 158],
  low: [128, 172, 76], mid2: [112, 160, 66], hill: [148, 160, 84], rock: [146, 138, 124], snow: [240, 243, 247],
  forest: [58, 114, 58], river: [30, 118, 220], bank: [176, 218, 238], urban: [170, 162, 140],
  road: [182, 150, 100], roadEdge: [120, 96, 64],
};
export const THEME = {
  sea: 0x0e345c, hemiSky: 0xe3efff, hemiGround: 0x4d5a3c, hemiPower: 1.9, sun: 0xfff1d6, sunPower: 1.8,
  quarterWidth: 2.1, quarterHalf: [2.35, 2.0], quarterRadius: 0.8, tilt: 1.26,
};
export const QUALITY = { low: { dpr: 1, trees: false, cars: false }, medium: { dpr: 1.5, trees: true, cars: true }, high: { dpr: 2, trees: true, cars: true } };
