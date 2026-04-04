import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import DisclaimerPage from './pages/DisclaimerPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  const [cafe, setCafe]   = useState(null);
  const [ready, setReady] = useState(false); // disclaimer 완료 여부

  useEffect(() => {
    const token     = localStorage.getItem('token');
    const cafeRaw   = localStorage.getItem('cafe');
    const disclaimer = localStorage.getItem('disclaimer');
    if (token && cafeRaw) {
      setCafe(JSON.parse(cafeRaw));
      setReady(!!disclaimer);
    }
  }, []);

  function handleLogin(cafeData) {
    setCafe(cafeData);
    const disclaimer = localStorage.getItem('disclaimer');
    setReady(!!disclaimer);
  }

  function handleDisclaimer() {
    localStorage.setItem('disclaimer', '1');
    setReady(true);
  }

  function handleLogout() {
    localStorage.clear();
    setCafe(null);
    setReady(false);
  }

  if (!cafe)  return <LoginPage onLogin={handleLogin} />;
  if (!ready) return <DisclaimerPage onAccept={handleDisclaimer} />;
  return <DashboardPage cafe={cafe} onLogout={handleLogout} />;
}
