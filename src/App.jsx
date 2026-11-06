import PrismHero from './PrismHero.jsx';

export default function App() {
  return (
    <main>
      <PrismHero intro />

      <section className="object" id="object">
        <div className="object-inner">
          <p className="eyebrow">
            <span className="eyebrow-line" aria-hidden="true" />
            The object
          </p>
          <h2 className="object-title">
            A prism is a promise that colour was always there.
          </h2>

          <div className="object-cols">
            <p>
              Cut from a single block of dense optical flint, the prism is polished
              on all five faces and finished by hand at its edges. Nothing about it
              is decorative: its only function is to slow each wavelength by a
              different amount, and to let the difference show.
            </p>
            <p>
              Suspended in a beam of white light, it gathers the spectrum into a
              narrow ribbon of colour. Rotate the glass and the beam finds new
              faces. Move the light and the spectrum follows, or vanishes entirely
              when the beam passes by.
            </p>
          </div>

          <dl className="object-specs">
            <div>
              <dt>Material</dt>
              <dd>Optical flint glass</dd>
            </div>
            <div>
              <dt>Refractive index</dt>
              <dd>1.750 n<sub>d</sub></dd>
            </div>
            <div>
              <dt>Dispersion</dt>
              <dd>Abbe 35.0</dd>
            </div>
            <div>
              <dt>Spectrum</dt>
              <dd>400–700 nm</dd>
            </div>
          </dl>
        </div>
      </section>

      <footer className="site-foot">
        <div className="foot-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Speculum</span>
        </div>
        <p className="foot-note">Objects for looking closely.</p>
        <nav className="foot-links" aria-label="Footer">
          <a href="#top">Top</a>
          <a href="#object">The object</a>
          <a href="mailto:studio@speculum.example">Contact</a>
        </nav>
      </footer>
    </main>
  );
}
