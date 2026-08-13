import './ContactTab.css';

export default function ContactTab({ provider }) {
  const subject = 'Caffeine Flow 문의';
  const to      = 'sngmng6506@gmail.com';
  const mailUrl = provider === 'naver'
    ? `https://mail.naver.com/write?to=${to}&subject=${encodeURIComponent(subject)}`
    : `https://mail.google.com/mail/?view=cm&to=${to}&su=${encodeURIComponent(subject)}`;

  return (
    <div className="contact-wrap">
      <h3 className="contact-title">서비스 문의</h3>
      <div className="contact-box">
        <p className="contact-desc">
          운영 중 불편한 점이나 필요한 기능이 있다면 메일로 알려주세요.
        </p>
        <a href={mailUrl} target="_blank" rel="noreferrer" className="contact-btn">
          메일 보내기
        </a>
      </div>
    </div>
  );
}
