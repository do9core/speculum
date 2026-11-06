import { useEffect, useRef, useState } from 'react';
import { PrismExperience } from './scene/PrismExperience.js';
import fallbackDesktop from './assets/fallback-desktop.jpg';
import fallbackPortrait from './assets/fallback-portrait.jpg';

const FALLBACK = (
  <div className="prism-fallback" aria-hidden="true">
    <picture>
      <source media="(max-aspect-ratio: 0.95)" srcSet={fallbackPortrait} />
      <img src={fallbackDesktop} alt="" />
    </picture>
  </div>
);

export default function PrismHero({ intro = true }) {
  const stageRef = useRef(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let experience;
    try {
      experience = new PrismExperience(stage, {
        intro,
        onHintChange: (state) => setHintVisible(state === 'show'),
      });
    } catch (error) {
      console.error('Prism scene unavailable', error);
      setFailed(true);
      return undefined;
    }
    return () => experience.dispose();
  }, [intro]);

  useEffect(() => {
    if (!hintVisible) return undefined;
    const timer = setTimeout(() => setHintVisible(false), 9000);
    return () => clearTimeout(timer);
  }, [hintVisible]);

  return (
    <section className="hero" id="top">
      <div className="hero-stage" ref={stageRef} aria-hidden="true" />
      {failed ? FALLBACK : null}

      <header className="site-head">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true" />
          Speculum
        </a>
        <a className="head-link" href="#object">
          Optical objects
        </a>
      </header>

      <div className="hero-copy">
        <p className="eyebrow">
          <span className="eyebrow-line" aria-hidden="true" />
          Optical study Nº 01
        </p>
        <h1>
          White light,
          <br />
          <em>undone.</em>
        </h1>
        <p className="lede">
          A solid prism of dispersive glass, one thin beam — and every colour it
          was carrying.
        </p>
        <a className="cta" href="#object">
          <span>Study the object</span>
          <svg width="18" height="10" viewBox="0 0 18 10" fill="none" aria-hidden="true">
            <path d="M0 5h16M12 1l4 4-4 4" stroke="currentColor" strokeWidth="1" />
          </svg>
        </a>
      </div>

      <div className="hero-foot">
        <p className={`hint ${hintVisible ? 'is-visible' : ''}`}>
          <span className="hint-dot" aria-hidden="true" />
          <span>Drag the glass</span>
          <span className="hint-sep" aria-hidden="true" />
          <span>drag the light</span>
          <span className="hint-mod">Shift lifts the beam</span>
        </p>
        <a className="scroll-cue" href="#object" aria-label="Scroll to the object">
          <span>Scroll</span>
          <span className="scroll-line" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
