const ADJECTIVES = [
  '따뜻한', '달콤한', '졸린', '신나는', '조용한', '설레는', '향긋한', '느긋한', '반짝이는', '배고픈',
  '몽글몽글한', '포근한', '사르르한', '두근두근한', '나른한', '촉촉한', '쌉싸름한', '새콤달콤한', '고소한', '진한',
  '가벼운', '깊은', '부드러운', '산뜻한', '상큼한', '시원한', '아늑한', '여유로운', '은은한', '잔잔한',
  '청량한', '포슬포슬한', '풍성한', '흐릿한', '기분좋은', '나긋한', '달달한', '뽀송한', '살랑살랑한', '구름같은',
  '꿈같은', '노을빛', '눈부신', '비오는날의', '빛나는', '솔솔한', '수줍은', '안개낀', '자꾸생각나는', '첫눈같은',
];

const NOUNS = [
  '라떼', '아메리카노', '에스프레소', '카푸치노', '모카', '바닐라', '카라멜', '말차', '얼그레이', '루이보스',
  '콜드브루', '플랫화이트', '마키아토', '리스트레토', '더블샷', '오트라떼', '아인슈페너', '비엔나커피', '코코아', '샷추가',
  '크루아상', '마들렌', '스콘', '브라우니', '티라미수', '치즈케이크', '휘낭시에', '카눌레', '마카롱', '레몬타르트',
  '바게트', '소금빵', '시나몬롤', '팡도르', '에클레어', '타르트', '몽블랑', '밀크티', '쟈스민티', '페퍼민트',
  '딸기라떼', '흑임자라떼', '고구마라떼', '복숭아티', '유자차', '생강차', '대추차', '레몬에이드', '자몽에이드', '청포도에이드',
];

function generate() {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num  = Math.floor(Math.random() * 100);
  return `${adj} ${noun}${num}`;
}

export function getDeviceName() {
  let name = localStorage.getItem('cf_device_name');
  if (!name) {
    name = generate();
    localStorage.setItem('cf_device_name', name);
  }
  return name;
}

export function getVisitorId() {
  let id = localStorage.getItem('cf_visitor_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('cf_visitor_id', id);
  }
  return id;
}
