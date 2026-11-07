import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

// Live camera preview with a picker, so you can choose the iPhone (Camo)
// over the laptop's own webcam. The parent calls ref.current.snapshot().
const SNAP_WIDTH = 640; // small photos make faster, cheaper AI calls

export default forwardRef(function Camera(_props, ref) {
  const video = useRef(null);
  const stream = useRef(null);
  const [cameras, setCameras] = useState([]);
  const [chosen, setChosen] = useState("");
  const [problem, setProblem] = useState("");

  async function open(deviceId) {
    stream.current?.getTracks().forEach((t) => t.stop());
    setProblem("");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      video.current.srcObject = stream.current;
      // Camera names only appear once permission is granted.
      const all = await navigator.mediaDevices.enumerateDevices();
      setCameras(all.filter((d) => d.kind === "videoinput"));
      setChosen(stream.current.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId);
    } catch (e) {
      setProblem(e.name === "NotAllowedError"
        ? "Camera blocked. Allow it in the address bar, then reload."
        : "No camera found. Open Camo on both devices, then reload.");
    }
  }

  useEffect(() => {
    open("");
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useImperativeHandle(ref, () => ({
    video: () => video.current,
    // One JPEG frame as a data URL. Nothing is saved.
    snapshot() {
      const v = video.current;
      if (!v?.videoWidth) return null;
      const scale = Math.min(1, SNAP_WIDTH / v.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.85);
    },
  }));

  return (
    <div className="camera">
      <video ref={video} autoPlay playsInline muted />
      <div className="camera__zone" aria-hidden>
        <span>Place the tray inside the lines</span>
      </div>
      {problem && <p className="camera__problem">{problem}</p>}
      {cameras.length > 0 && (
        <select className="camera__pick" value={chosen} onChange={(e) => open(e.target.value)}
          aria-label="Camera">
          {cameras.map((c, i) => (
            <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>
          ))}
        </select>
      )}
    </div>
  );
});
