export default function ContactTab({ provider }) {
  const subject = 'Caffeine Flow 문의';
  const to      = 'sngmng6506@gmail.com';
  const mailUrl = provider === 'naver'
    ? `https://mail.naver.com/write?to=${to}&subject=${encodeURIComponent(subject)}`
    : `https://mail.google.com/mail/?view=cm&to=${to}&su=${encodeURIComponent(subject)}`;

  return (
    <div style={contactStyles.wrap}>
      <h3 style={contactStyles.title}>개발자 문의</h3>
      <div style={contactStyles.box}>
        <p style={contactStyles.desc}>
          사장님, 안녕하세요. <br />
        운영 중 불편한 점, 필요한 기능, 떠오른 아이디어가 있으시면 <br />
        아래 버튼을 눌러 메일을 보내주세요. <br />
        <br />
        작은 기능 개선부터, <br />
        “이런 것도 앱으로 가능할까?” 싶은 새로운 아이디어까지 모두 환영합니다.<br />

         <br />
        </p>
        <a href={mailUrl} target="_blank" rel="noreferrer" style={contactStyles.btn}>
          메일 보내기
        </a>
      </div>
    </div>
  );
}

const contactStyles = {
  wrap:  { paddingTop: 16 },
  title: { fontSize: 15, fontWeight: 700, marginBottom: 16 },
  box:   { background: '#f8f8f8', borderRadius: 12, padding: 24 },
  desc:  { fontSize: 14, color: '#666', lineHeight: 1.8, marginBottom: 20 },
  btn:   { display: 'block', background: '#1a1a2e', color: '#fff', textAlign: 'center', borderRadius: 8, padding: '13px', fontSize: 14, fontWeight: 700, textDecoration: 'none' },
};
