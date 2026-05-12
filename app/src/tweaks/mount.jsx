import React from 'react';
import { createRoot } from 'react-dom/client';
import { TweaksPanel } from './TweaksPanel.jsx';
import {
  TweakSection,
  TweakSlider,
} from './controls.jsx';
import {
  applyTweaks,
  loadStoredTweaks,
  saveStoredTweaks,
} from './apply.js';

function App() {
  const [t, setT] = React.useState(loadStoredTweaks);

  // Apply on mount and on every change. The same call covers initial paint
  // (so persisted values take effect before the user opens the panel) and
  // each subsequent edit.
  React.useEffect(() => {
    applyTweaks(t);
    saveStoredTweaks(t);
  }, [t]);

  const set = (key, value) => setT((prev) => ({ ...prev, [key]: value }));

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Glass material">
        <TweakSlider label="Blur"     value={t.blur}     onChange={(v) => set('blur', v)}     min={6}   max={60}  step={1}    unit="px" />
        <TweakSlider label="Saturate" value={t.saturate} onChange={(v) => set('saturate', v)} min={0.6} max={2.4} step={0.05} />
        <TweakSlider label="Edge"     value={t.stroke}   onChange={(v) => set('stroke', v)}   min={0}   max={0.6} step={0.02} />
      </TweakSection>
    </TweaksPanel>
  );
}

export function mountTweaks(container) {
  // Apply persisted defaults synchronously on first paint, before React
  // mounts. This way the user's last theme is in place from frame 1.
  applyTweaks(loadStoredTweaks());
  createRoot(container).render(<App />);
}
