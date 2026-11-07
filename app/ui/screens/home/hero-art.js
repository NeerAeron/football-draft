// Home hero illustration: floodlight towers and beams over a perspective pitch, with a
// gold-foil cup. Pure SVG (our own drawing), decorative.
import { html } from '../../lib/html.js';

export function HeroArt() {
  return html`<svg
    class="hero-art"
    viewBox="0 0 400 240"
    preserveAspectRatio="xMidYMax slice"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="hero-beam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#eaf2ff" stop-opacity="0.34" />
        <stop offset="1" stop-color="#eaf2ff" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="hero-pitch" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1c7546" stop-opacity="0" />
        <stop offset="0.35" stop-color="#1a6e40" stop-opacity="0.75" />
        <stop offset="1" stop-color="#135733" />
      </linearGradient>
      <linearGradient id="hero-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff4cf" />
        <stop offset="0.3" stop-color="#f5c84c" />
        <stop offset="0.55" stop-color="#a8770f" />
        <stop offset="0.78" stop-color="#f7d774" />
        <stop offset="1" stop-color="#fff1c4" />
      </linearGradient>
      <linearGradient id="hero-gold-dark" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8a5d06" />
        <stop offset="0.5" stop-color="#f2c94c" />
        <stop offset="1" stop-color="#7a5205" />
      </linearGradient>
      <radialGradient id="hero-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#f5c84c" stop-opacity="0.55" />
        <stop offset="0.45" stop-color="#cdf545" stop-opacity="0.12" />
        <stop offset="1" stop-color="#cdf545" stop-opacity="0" />
      </radialGradient>
    </defs>

    <!-- floodlight beams -->
    <path d="M28 18 128 240H-60Z" fill="url(#hero-beam)" />
    <path d="M372 18 272 240H460Z" fill="url(#hero-beam)" />
    <path d="M60 6 200 240H40Z" fill="url(#hero-beam)" opacity="0.5" />
    <path d="M340 6 200 240H360Z" fill="url(#hero-beam)" opacity="0.5" />

    <!-- light rigs -->
    <g class="hero-art__rig">
      <rect x="10" y="10" width="36" height="16" rx="3" />
      <rect x="354" y="10" width="36" height="16" rx="3" />
    </g>
    <g class="hero-art__lamps">
      ${[0, 1, 2, 3].map(
        i =>
          html`<circle cx=${16 + i * 8} cy="15" r="2.2" /><circle
              cx=${16 + i * 8}
              cy="21"
              r="2.2"
            />
            <circle cx=${360 + i * 8} cy="15" r="2.2" /><circle
              cx=${360 + i * 8}
              cy="21"
              r="2.2"
            />`,
      )}
    </g>

    <!-- perspective pitch -->
    <path d="M110 150H290L400 240H0Z" fill="url(#hero-pitch)" />
    <g class="hero-art__lines">
      <path d="M110 150H290L400 240H0Z" />
      <path d="M150 150 132 172H268L250 150" />
      <path d="M55 195H345" />
      <ellipse cx="200" cy="195" rx="46" ry="11" />
    </g>

    <!-- trophy -->
    <circle cx="200" cy="104" r="86" fill="url(#hero-glow)" />
    <g class="hero-art__cup">
      <path
        d="M177 61c-12 0-17 6-15.5 14.5C163 85 171 93 182 96"
        fill="none"
        stroke="url(#hero-gold-dark)"
        stroke-width="5"
        stroke-linecap="round"
      />
      <path
        d="M223 61c12 0 17 6 15.5 14.5C237 85 229 93 218 96"
        fill="none"
        stroke="url(#hero-gold-dark)"
        stroke-width="5"
        stroke-linecap="round"
      />
      <path d="M173 54h54v20c0 20-11 33-27 37-16-4-27-17-27-37z" fill="url(#hero-gold)" />
      <path d="M173 54h54v6h-54z" fill="#fff4cf" opacity="0.6" />
      <path d="M195 111h10l-1.5 15h-7z" fill="url(#hero-gold-dark)" />
      <rect x="189" y="125" width="22" height="6" rx="3" fill="url(#hero-gold)" />
      <path d="M183 132h34l4 15h-42z" fill="url(#hero-gold)" />
      <rect x="176" y="147" width="48" height="9" rx="2" fill="url(#hero-gold-dark)" />
      <path
        d="m200 66 3.1 6.4 7 1-5.1 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5.1-4.9 7-1z"
        fill="#fff8de"
        opacity="0.92"
      />
      <path
        d="M178 58c2 22 8 35 18 44"
        fill="none"
        stroke="#fff8de"
        stroke-width="2"
        opacity="0.5"
      />
    </g>
  </svg>`;
}
