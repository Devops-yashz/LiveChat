import { useEffect, useRef, useState } from 'react';
import { Camera, SwitchCamera, X } from 'lucide-react';
import { Alert, Modal } from './ui';

/** Live camera capture via MediaDevices. The browser permission prompt only appears after the user taps "Allow camera". */
export default function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [canSwitch, setCanSwitch] = useState(false);

  const stop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  useEffect(() => stop, []);

  async function start(mode: 'user' | 'environment') {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) return setError('Camera is not supported in this browser (HTTPS is required).');
    try {
      stop();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      setFacing(mode); setStarted(true);
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (e) {
      const name = (e as DOMException).name;
      setError(name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings and try again.'
        : name === 'NotFoundError' ? 'No camera found on this device.' : 'Could not start the camera.');
    }
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return setError('Could not capture the photo.');
      stop();
      onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  return (
    <Modal title="Take a photo" onClose={() => { stop(); onClose(); }}>
      {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
      {!started ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Your browser will ask for permission to use the camera. The photo is only sent after you press “Send” on the preview.
          </p>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => start(facing)}><Camera className="h-4 w-4" /> Allow camera</button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      ) : null}
      <video ref={videoRef} playsInline muted className={`w-full rounded-xl bg-black ${started ? '' : 'hidden'}`} />
      {started && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <button className="btn-ghost" onClick={() => { stop(); onClose(); }}><X className="h-4 w-4" /> Cancel</button>
          {canSwitch && <button className="btn-outline" onClick={() => start(facing === 'user' ? 'environment' : 'user')}><SwitchCamera className="h-4 w-4" /> Flip</button>}
          <button className="btn-primary" onClick={capture}><Camera className="h-4 w-4" /> Capture</button>
        </div>
      )}
    </Modal>
  );
}
