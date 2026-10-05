// slug는 재사용 가능하다. 불변 카페 ID와 접속 당시 주소를 함께 묶어,
// 다른 매장의 주소 재사용과 같은 매장의 주소 변경을 모두 격리한다.
function cafeRoom(cafe) {
  if (!cafe?.id || !cafe?.slug) throw new Error('카페 ID와 slug가 필요합니다');
  return `cafe:${cafe.id}:${cafe.slug}`;
}

function ownerRoom(cafe) {
  return `owner:${cafeRoom(cafe)}`;
}

function disconnectCafe(io, cafe) {
  io?.of('/cafe').in(cafeRoom(cafe)).disconnectSockets(true);
}

module.exports = { cafeRoom, ownerRoom, disconnectCafe };
