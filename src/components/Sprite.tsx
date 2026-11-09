import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ImgHTMLAttributes,
  type ReactNode,
} from 'react';
import { useHydrated } from '../lib/useHydrated';

const MotionContext = createContext({
  enabled: false,
  reduced: false,
  ready: false,
  toggle: () => {},
});
const preferenceKey = 'naturedex.motion.v1';
const reducedQuery = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia(reducedQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
function reducedSnapshot() {
  return window.matchMedia(reducedQuery).matches;
}
function serverReducedSnapshot() {
  return false;
}
function savedPausePreference() {
  try {
    return localStorage.getItem(preferenceKey) === 'paused';
  } catch {
    return false;
  }
}

export function SpriteMotionProvider({ children }: { children: ReactNode }) {
  const [pauseOverride, setPaused] = useState<boolean | null>(null);
  const ready = useHydrated();
  const reduced = useSyncExternalStore(
    subscribeReducedMotion, reducedSnapshot, serverReducedSnapshot,
  );
  const paused = pauseOverride ?? (ready && savedPausePreference());
  const enabled = ready && !reduced && !paused;
  function toggle() {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(preferenceKey, next ? 'paused' : 'on');
    } catch {
      /* Keep the in-memory preference. */
    }
  }
  return (
    <MotionContext.Provider value={{ enabled, reduced, ready, toggle }}>
      {children}
    </MotionContext.Provider>
  );
}

export function SpriteMotionControl() {
  const { enabled, reduced, ready, toggle } = useContext(MotionContext);
  const label = reduced
    ? 'Reduced motion'
    : enabled
      ? 'Pause sprites'
      : 'Animate sprites';
  return (
    <>
      <button
        className="sprite-motion-toggle"
        type="button"
        onClick={toggle}
        disabled={!ready || reduced}
        aria-pressed={enabled}
        aria-describedby={reduced ? 'sprite-motion-explanation' : undefined}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          {enabled ? (
            <>
              <path d="M2 2h3v8H2zM7 2h3v8H7z" />
            </>
          ) : (
            <path d="M3 1v10l7-5z" />
          )}
        </svg>
        {label}
      </button>
      {reduced && (
        <span id="sprite-motion-explanation" className="sr-only">
          Sprite animations are off because reduced motion is enabled in your
          device settings.
        </span>
      )}
    </>
  );
}

export default function Sprite({
  src,
  animatedSrc,
  spriteId,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  alt: string;
  /** Three-pose animation shown while motion is on; without it the still stays. */
  animatedSrc?: string | null;
  spriteId: string;
}) {
  const { enabled } = useContext(MotionContext);
  const animated = enabled && !!animatedSrc;
  const source = animated ? animatedSrc : src;
  return (
    // Original pixel SVGs already provide their exact size and animation frames.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={alt}
      src={source}
      data-sprite={spriteId}
      data-animated={animated ? 'true' : 'false'}
    />
  );
}
