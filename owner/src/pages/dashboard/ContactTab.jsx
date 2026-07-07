import './ContactTab.css';

export default function ContactTab({ provider }) {
  const subject = 'Caffeine Flow 문의';
  const to      = 'sngmng6506@gmail.com';
  const mailUrl = provider === 'naver'
    ? `https://mail.naver.com/write?to=${to}&subject=${encodeURIComponent(subject)}`
    : `https://mail.google.com/mail/?view=cm&to=${to}&su=${encodeURIComponent(subject)}`;

  return (
    <div className="contact-wrap">
      <h3 className="contact-title">개발자 문의</h3>
      <div className="contact-box">
        <p className="contact-desc">
          사장님, 안녕하세요. <br />
        운영 중 불편한 점, 필요한 기능, 떠오른 아이디어가 있으시면 <br />
        아래 버튼을 눌러 메일을 보내주세요. <br />
        <br />
        작은 기능 개선부터, <br />
        “이런 것도 앱으로 가능할까?” 싶은 새로운 아이디어까지 모두 환영합니다.<br />

         <br />
        </p>
        <a href={mailUrl} target="_blank" rel="noreferrer" className="contact-btn">
          메일 보내기
        </a>
      </div>
    </div>
  );
}
