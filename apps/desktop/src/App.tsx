import { useEffect, useState } from 'react';
import { RuntimeClient } from './api/client';
import QuickAssistant from './windows/QuickAssistant';
import FloatingBall from './windows/FloatingBall';
import WorkbenchWindow from './windows/WorkbenchWindow';
import { Toaster } from './components/ui/sonner';
import './styles/ui.css';
import './styles/tokens.css';
import './styles/app.css';

export default function App() {
  const label = new URLSearchParams(window.location.search).get('window');
  if (label !== null && !['main', 'quick', 'ball'].includes(label)) return <main><p role="alert">未知或已移除的产品窗口</p></main>;
  // 球在连接组件之外分流，永不领取Runtime凭据或业务事实。
  return label === 'ball' ? <FloatingBall /> : <><ConnectedWindow label={label} /><Toaster /></>;
}

function ConnectedWindow({ label }: { label: string | null }) {
  const [client, setClient] = useState<RuntimeClient>();
  const [error, setError] = useState('');
  useEffect(() => {
    let ignore = false;
    RuntimeClient.connect().then(client => { if (!ignore) setClient(client); })
      .catch(() => { if (!ignore) setError('无法连接产品 Runtime，请检查桌面宿主状态'); });
    return () => { ignore = true; };
  }, []);
  if (!client) return <main>{error ? <p role="alert">{error}</p> : <p role="status">正在启动 Runtime…</p>}</main>;
  return label === 'quick' ? <QuickAssistant client={client} /> : <WorkbenchWindow client={client} />;
}
