import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// StrictMode is intentionally not used: it double-invokes effects in dev, which would double-acquire
// the camera/microphone and double-send call signalling.
createRoot(document.getElementById('root')!).render(<App />);
