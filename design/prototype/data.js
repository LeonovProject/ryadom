/* Fictional content for a local design prototype. No API or persistent storage. */
window.RYADOM_DEMO = {
  people: {
    admin: { name: 'Марина Соколова', initials: 'МС', systemRole: 'ADMIN' },
    alex: { name: 'Алексей Миронов', initials: 'АМ' },
    anna: { name: 'Анна Лебедева', initials: 'АЛ' },
    ilya: { name: 'Илья Соколов', initials: 'ИС' },
    masha: { name: 'Мария Белова', initials: 'МБ' },
    kirill: { name: 'Кирилл Волков', initials: 'КВ' },
    lena: { name: 'Елена Орлова', initials: 'ЕО' }
  },
  organizations: [
    { id:'temp', name:'Темп', initials:'Т', owner:'anna', status:'APPROVED', joinMode:'OPEN',
      members:[{user:'anna',status:'CONFIRMED'},{user:'masha',status:'CONFIRMED'},{user:'lena',status:'CONFIRMED'}],
      description:'Спортивное сообщество для тех, кому нравится двигаться вместе. Бегаем, играем и пробуем новые виды спорта — в своём темпе и без гонки за результатами.',
      interests:['Бег','Теннис','Волейбол'], submittedAt:'2026-10-15T10:00:00+07:00', decidedAt:'2026-10-16T12:00:00+07:00' },
    { id:'spoke', name:'Велоклуб «Спица»', initials:'С', owner:'ilya', status:'APPROVED', joinMode:'OPEN',
      members:[{user:'ilya',status:'CONFIRMED'},{user:'kirill',status:'CONFIRMED'}],
      description:'Спокойные велопрогулки по городу и выезды на набережную. Присоединяйся с любым велосипедом — темп выбираем по группе.',
      interests:['Велосипед'], submittedAt:'2026-10-12T09:00:00+07:00', decidedAt:'2026-10-13T11:00:00+07:00' },
    { id:'sunrise', name:'Йога на рассвете', initials:'Й', owner:'lena', status:'APPROVED', joinMode:'OPEN',
      members:[{user:'lena',status:'CONFIRMED'},{user:'masha',status:'CONFIRMED'},{user:'alex',status:'CONFIRMED'},{user:'kirill',status:'CONFIRMED'}],
      description:'Мягкая йога и дыхательные практики в парке по утрам. Коврики свои, хорошее настроение общее.',
      interests:['Зарядка','Йога'], submittedAt:'2026-10-10T08:00:00+07:00', decidedAt:'2026-10-11T10:00:00+07:00' },
    { id:'wave', name:'Плавательный клуб «Волна»', initials:'В', owner:'masha', status:'APPROVED', joinMode:'APPROVAL',
      members:[{user:'masha',status:'CONFIRMED'},{user:'anna',status:'CONFIRMED'},{user:'ilya',status:'PENDING'}],
      description:'Групповые заплывы в бассейне и летом на открытой воде. Вступление по заявке: кратко расскажи о своём опыте плавания.',
      interests:['Плавание'], submittedAt:'2026-10-11T15:00:00+07:00', decidedAt:'2026-10-12T12:00:00+07:00' },
    { id:'route', name:'Турклуб «Маршрут»', initials:'М', owner:'kirill', status:'APPROVED', joinMode:'APPROVAL',
      members:[{user:'kirill',status:'CONFIRMED'},{user:'lena',status:'CONFIRMED'}],
      description:'Пешие походы выходного дня и ночёвки в палатках. Заявки рассматриваем вместе с составом группы — нам важна безопасность.',
      interests:['Походы'], submittedAt:'2026-10-13T12:00:00+07:00', decidedAt:'2026-10-14T09:00:00+07:00' },
    { id:'rook', name:'Шахматный кружок «Ход»', initials:'Х', owner:'anna', status:'PENDING', joinMode:'OPEN', members:[{user:'anna',status:'CONFIRMED'}],
      description:'Играем дружеские партии и разбираем позиции. Приглашаем начинающих и любителей шахмат.',
      interests:['Шахматы'], submittedAt:'2026-10-18T11:00:00+07:00' },
    { id:'pulse', name:'Беговой клуб «Пульс»', initials:'П', owner:'anna', status:'PENDING', joinMode:'OPEN', members:[{user:'anna',status:'CONFIRMED'}],
      description:'Организуем совместные пробежки по городским маршрутам. Темп и расстояние указываем в каждой встрече.',
      interests:['Бег'], submittedAt:'2026-10-18T14:00:00+07:00' },
    { id:'yard', name:'Дворовые встречи', initials:'ДВ', owner:'anna', status:'NOT_SUBMITTED', joinMode:'OPEN', members:[{user:'anna',status:'CONFIRMED'}],
      description:'Зарядка по выходным и простые командные игры для соседей.', interests:['Зарядка','Волейбол'] },
    { id:'height', name:'Клуб «Высота»', initials:'В', owner:'anna', status:'REJECTED', joinMode:'OPEN', members:[{user:'anna',status:'CONFIRMED'}],
      description:'Сообщество для совместных тренировок.', interests:['Зарядка'],
      submittedAt:'2026-10-16T10:00:00+07:00', decidedAt:'2026-10-17T16:00:00+07:00',
      reason:'В описании недостаточно информации о деятельности и формате встреч клуба.' }
  ],
  events: [
    { id: 'run', title: 'Бежим вдоль Енисея', sport: 'Бег', icon: 'run', date: '2026-10-24T09:00:00+07:00', city: 'Красноярск', place: 'Набережная Енисея', meetingPoint: 'Встречаемся у центрального входа на набережную, рядом с лестницей к воде.', mode: 'OPEN', owner: 'anna', organization: null, description: 'Начнём субботу с лёгкой пробежки и хорошей компании. Пробежим около 5 км вдоль реки, полюбуемся осенним городом и при желании зайдём за кофе.\n\nТемп разговорный: можно бежать и спокойно общаться. Никого не оставляем позади — подстроимся под группу.', conditions: 'Подойдёт, если уже можешь пробежать несколько километров. Возьми удобные кроссовки, воду и одежду по погоде.', tagline: 'Спокойный темп · около 5 км', participants: [{user:'masha',status:'CONFIRMED'},{user:'kirill',status:'CONFIRMED'},{user:'lena',status:'CONFIRMED'}], messages: [{user:'masha',body:'А если бегаю медленно, можно присоединиться?',time:'18:40'},{user:'anna',body:'Конечно! Бежим в разговорном темпе и ждём друг друга. Главное — хорошая компания.',time:'18:52'}] },
    { id: 'tennis', title: 'Теннис без спешки', sport: 'Теннис', icon: 'tennis', date: '2026-10-25T14:00:00+07:00', city: 'Красноярск', place: 'Корты на острове Татышев', meetingPoint: 'Собираемся у входа на корты. Организатор будет с красной спортивной сумкой.', mode: 'APPROVAL', owner: 'anna', organization: 'temp', description: 'Поиграем парами, разомнёмся и потренируем подачу. Подходит тем, кто уже знаком с основными правилами, но хочет больше игровой практики.\n\nПары составим на месте. После заявки организатор уточнит состав и подтвердит участие.', conditions: 'Нужны сменная спортивная обувь и своя ракетка. Если ракетки нет, задай вопрос в обсуждении — попробуем найти запасную.', tagline: 'Для любителей · парная игра', participants: [{user:'ilya',status:'CONFIRMED'},{user:'lena',status:'CONFIRMED'},{user:'kirill',status:'PENDING'}], messages: [{user:'lena',body:'Можно приехать немного раньше и размяться?',time:'12:10'},{user:'anna',body:'Да, буду на месте за 15 минут до начала.',time:'12:16'}] },
    { id: 'chess', title: 'Шахматы за одним столом', sport: 'Шахматы', icon: 'chess', date: '2026-10-24T16:00:00+07:00', city: 'Красноярск', place: 'Читальный зал «Открыто»', meetingPoint: 'Второй этаж, большой стол у окна. Участие согласовано с площадкой в рамках вымышленного примера.', mode: 'OPEN', owner: 'ilya', organization: null, description: 'Несколько спокойных партий в субботу. Разберём интересные позиции, поменяемся соперниками и познакомимся.\n\nПриходи с любым уровнем: здесь можно спросить правило или подумать над ходом подольше.', conditions: 'Дополнительных требований нет. Доски и фигуры будут на столе.', tagline: 'Любой уровень · без турнира', participants: [{user:'masha',status:'CONFIRMED'},{user:'anna',status:'CONFIRMED'}], messages: [] },
    { id: 'volley', title: 'Волейбол после работы', sport: 'Волейбол', icon: 'ball', date: '2026-10-27T19:00:00+07:00', city: 'Красноярск', place: 'Спортивный зал «Старт»', meetingPoint: 'Главный вход, встреча за 10 минут до начала.', mode: 'APPROVAL', owner: 'anna', organization: 'temp', description: 'Соберём две команды и сыграем несколько дружеских партий. Без судейской строгости, но с уважением к правилам и друг другу.', conditions: 'Базовое знание правил и сменная обувь. Опыт участия в соревнованиях не требуется.', tagline: 'Базовый уровень · командная игра', participants: [{user:'lena',status:'CONFIRMED'},{user:'kirill',status:'CONFIRMED'}], messages: [] },
    { id: 'exercise', title: 'Утро начинается с движения', sport: 'Зарядка', icon: 'stretch', date: '2026-10-25T10:00:00+07:00', city: 'Красноярск', place: 'Парк у озера', meetingPoint: 'На площадке рядом с беседкой.', mode: 'OPEN', owner: 'masha', organization: null, description: 'Мягкая разминка, немного упражнений на подвижность и свежий воздух. Двигаемся в комфортном для себя темпе и знакомимся с соседями.', conditions: 'Удобная одежда. Можно взять коврик, но это необязательно.', tagline: 'Мягкая разминка · 30 минут', participants: [{user:'lena',status:'CONFIRMED'}], messages: [] },
    { id: 'petanque', title: 'Попробуем петанк?', sport: 'Петанк', icon: 'target', date: '2026-10-31T13:00:00+07:00', city: 'Красноярск', place: 'Площадка на острове Татышев', meetingPoint: 'Песчаная площадка у пешеходной дорожки.', mode: 'OPEN', owner: 'ilya', organization: null, description: 'Новый повод встретиться на улице. Покажем правила петанка, разделимся на команды и сыграем. Специальная подготовка не нужна.', conditions: 'Дополнительных требований нет. Инвентарь принесёт организатор.', tagline: 'Знакомство с новым спортом', participants: [], messages: [] }
  ]
};

// Stable fictional message dates and identifiers for the moderation walkthrough.
for (const event of window.RYADOM_DEMO.events) {
  event.publication = 'PUBLISHED';
  event.participants.forEach(participation => { participation.createdAt = '2026-10-18T14:00:00+07:00'; });
  event.messages.forEach((message, index) => {
    message.id = `${event.id}-message-${index + 1}`;
    message.createdAt = `2026-10-18T${message.time}:00+07:00`;
    message.hidden = false;
  });
}
