import type { CatalogCardLook } from '@expanses/catalog';
import { type ReactNode, useId } from 'react';
import { cx } from '../../ui';

/** A hue per issuer, so a card with no catalogue design still shares its bank's colour. */
function issuerHue(issuer: string | null): number | null {
  if (!issuer) return null;
  let hash = 0;
  for (const char of issuer) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function NetworkMark({ network }: { network: string | null }) {
  switch (network) {
    case 'visa':
      return <span className="text-[1.45em] leading-none font-black italic tracking-tight">VISA</span>;
    case 'mastercard':
      return (
        <span className="relative inline-flex h-[1.6em] w-[2.6em]" aria-label="Mastercard">
          <span className="absolute left-0 h-[1.6em] w-[1.6em] rounded-full bg-[#eb001b]" />
          <span className="absolute right-0 h-[1.6em] w-[1.6em] rounded-full bg-[#f79e1b]/90 mix-blend-screen" />
        </span>
      );
    case 'amex':
      return <span className="rounded-sm border border-current px-1 text-[0.9em] leading-tight font-bold tracking-wider">AMEX</span>;
    case 'jcb':
      return <span className="text-[1.2em] leading-none font-black tracking-wide">JCB</span>;
    case 'unionpay':
      return <span className="text-[1em] leading-none font-bold">UnionPay</span>;
    default:
      return null;
  }
}

/** A contact chip with its etched contact pads, in gold or silver. */
function Chip({ kind, md, id }: { kind: 'gold' | 'silver'; md: boolean; id: string }) {
  const [light, dark, line] = kind === 'silver' ? ['#f1f3f5', '#9aa1a9', '#6b7280'] : ['#f6dd9a', '#b8892f', '#8a6424'];
  return (
    <svg aria-hidden viewBox="0 0 46 34" className={md ? 'h-[1.95rem] w-[2.6rem]' : 'h-4 w-5'}>
      <defs>
        <linearGradient id={`${id}chip`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.55" stopColor={dark} />
          <stop offset="1" stopColor={light} />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="45" height="33" rx="6" fill={`url(#${id}chip)`} stroke={line} strokeOpacity="0.5" />
      <g fill="none" stroke={line} strokeOpacity="0.55" strokeWidth="0.9">
        <path d="M0 11h14c3 0 4 2 4 4v4c0 2-1 4-4 4H0M46 11H32c-3 0-4 2-4 4v4c0 2 1 4 4 4h14M18 0v9M28 0v9M18 34v-9M28 34v-9" />
        <rect x="18" y="9" width="10" height="16" rx="3" />
      </g>
    </svg>
  );
}

function Contactless({ md }: { md: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cx('opacity-80', md ? 'h-5 w-5' : 'h-2.5 w-2.5')} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M7.5 8.5a5 5 0 0 1 0 7M11 6a9 9 0 0 1 0 12M14.5 3.5a13 13 0 0 1 0 17M4 11a1.5 1.5 0 0 1 0 2" />
    </svg>
  );
}

/** A drawn illustration in the manner of a card's artwork. Coordinates are the card in tenths of a millimetre. */
function Motif({ look, id }: { look: CatalogCardLook; id: string }) {
  const c = look.motifColour ?? (look.ink === 'light' ? '#ffffff26' : '#00000020');
  const portrait = look.orientation === 'portrait';
  const [w, h] = portrait ? [540, 856] : [856, 540];
  const svg = (children: ReactNode) => (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
      {children}
    </svg>
  );
  switch (look.motif) {
    case 'batik-floral':
      // Flowers, leaves and curling vines, outlined and stippled, repeated edge to edge.
      return svg(
        <>
          <defs>
            <pattern id={`${id}batik`} width="170" height="150" patternUnits="userSpaceOnUse">
              <g fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round">
                <g transform="translate(52 48)">
                  {[0, 60, 120, 180, 240, 300].map((a) => (
                    <ellipse key={a} cx="0" cy="-17" rx="8" ry="16" transform={`rotate(${a})`} />
                  ))}
                  <circle r="7" />
                </g>
                <path d="M70 70c22 10 30 30 58 30s32-24 42-40M0 118c20-12 40-8 56 6s38 16 58 2" />
                <path d="M118 96c-6-14 2-28 16-30-2 14-6 24-16 30zM30 124c14-6 28 0 32 12-14 2-24-2-32-12z" />
                <g transform="translate(140 22) scale(0.55)">
                  {[0, 72, 144, 216, 288].map((a) => (
                    <ellipse key={a} cx="0" cy="-15" rx="7" ry="14" transform={`rotate(${a})`} />
                  ))}
                </g>
              </g>
              <g fill={c}>
                {[
                  [52, 48], [40, 26], [64, 26], [30, 48], [74, 48], [40, 70], [64, 70], [96, 88], [150, 60], [12, 110], [86, 132], [140, 22], [120, 134],
                ].map(([x, y]) => (
                  <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" />
                ))}
              </g>
            </pattern>
          </defs>
          <rect width={w} height={h} fill={`url(#${id}batik)`} />
        </>,
      );
    case 'big-letter':
      // One huge letter A cutting across the face, the way a brand's initial is laid over the card.
      return svg(
        <>
          <path d={portrait ? 'M60 900 300 -40h90l200 940H470L345 250 190 900z' : 'M250 600 520 -60h96l270 660H740L566 150 392 600z'} fill={c} />
          <path d={portrait ? 'M300 -40h90l200 940' : 'M520 -60h96l270 660'} fill="none" stroke={c} strokeWidth="3" />
        </>,
      );
    case 'rosette-tile':
      // Small ornamental rosettes on a tiled grid, with diamonds where the tiles meet.
      return svg(
        <>
          <defs>
            <pattern id={`${id}rosette`} width="64" height="64" patternUnits="userSpaceOnUse">
              <g transform="translate(32 32)" fill="none" stroke={c} strokeWidth="2">
                {[0, 45, 90, 135].map((a) => (
                  <ellipse key={a} rx="5.5" ry="15" transform={`rotate(${a})`} />
                ))}
                <circle r="4.5" fill={c} />
              </g>
              <path d="M0 -6 6 0 0 6 -6 0zM64 -6l6 6-6 6-6-6zM0 58l6 6-6 6-6-6zM64 58l6 6-6 6-6-6z" fill={c} />
            </pattern>
          </defs>
          <rect width={w} height={h} fill={`url(#${id}rosette)`} />
        </>,
      );
    case 'chrome-curves':
      // Sweeping chrome S-curves over a fine honeycomb mesh on the right half.
      return svg(
        <>
          <defs>
            <pattern id={`${id}hex`} width="24" height="41.6" patternUnits="userSpaceOnUse">
              <path d="M12 0l12 7v13.9l-12 7-12-7V7zM12 27.9v13.7" fill="none" stroke={c} strokeWidth="1" />
            </pattern>
          </defs>
          <rect x={w / 2} width={w / 2} height={h} fill={`url(#${id}hex)`} opacity="0.35" />
          <path d="M-40 430C200 540 360 110 560 170S820 420 900 300" fill="none" stroke={c} strokeWidth="26" />
          <path d="M-40 480C220 570 380 170 580 230S840 480 900 360" fill="none" stroke={c} strokeWidth="6" />
          <path d="M-40 380C180 480 340 60 540 110S800 360 900 240" fill="none" stroke={c} strokeWidth="2" />
        </>,
      );
    case 'ikat-diamonds':
      // A woven field of nested diamonds, strongest in the middle where the card glows.
      return svg(
        <>
          <defs>
            <pattern id={`${id}ikat`} width="56" height="56" patternUnits="userSpaceOnUse">
              <g fill="none" stroke={c} strokeWidth="2">
                <path d="M28 2 54 28 28 54 2 28z" />
                <path d="M28 14 42 28 28 42 14 28z" />
              </g>
              <path d="M28 23l5 5-5 5-5-5z" fill={c} />
            </pattern>
            <radialGradient id={`${id}ikatFade`}>
              <stop offset="0.25" stopColor="#fff" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.15" />
            </radialGradient>
            <mask id={`${id}ikatMask`}>
              <rect width={w} height={h} fill={`url(#${id}ikatFade)`} />
            </mask>
          </defs>
          <rect width={w} height={h} fill={`url(#${id}ikat)`} mask={`url(#${id}ikatMask)`} />
        </>,
      );
    case 'engraved-frame':
      // An engraved border and a central oval over fine guilloche lines, like a classic charge card.
      return svg(
        <>
          {Array.from({ length: 22 }, (_, i) => (
            <path key={i} d={`M0 ${40 + i * 22}C140 ${20 + i * 22} 280 ${60 + i * 22} 428 ${40 + i * 22}S716 ${20 + i * 22} 856 ${40 + i * 22}`} fill="none" stroke={c} strokeWidth="1" />
          ))}
          <rect x="26" y="26" width={w - 52} height={h - 52} rx="22" fill="none" stroke={c} strokeWidth="6" />
          <rect x="40" y="40" width={w - 80} height={h - 80} rx="14" fill="none" stroke={c} strokeWidth="2" />
          <ellipse cx="428" cy="270" rx="96" ry="128" fill="none" stroke={c} strokeWidth="8" />
          <ellipse cx="428" cy="270" rx="78" ry="108" fill={c} opacity="0.5" />
        </>,
      );
    case 'portrait-oval':
      // A huge oval medallion filling the left of the card and running off its edges.
      return svg(
        <>
          <ellipse cx="250" cy="300" rx="300" ry="360" fill={c} />
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={i} cx="250" cy="300" rx={330 + i * 26} ry={390 + i * 26} fill="none" stroke={c} strokeWidth="3" />
          ))}
        </>,
      );
    case 'split-waves':
      // A hard diagonal split into two panels, crossed by bundles of fine sine waves.
      return svg(
        <>
          <path d="M470 0H856V540H290z" fill="#ffffff" opacity="0.06" />
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M-20 ${250 + i * 9}C120 ${170 + i * 7} 260 ${360 - i * 5} 430 ${270 + i * 6}S720 ${160 + i * 8} 880 ${260 + i * 9}`} fill="none" stroke={c} strokeWidth={i % 3 === 0 ? 2.4 : 1.2} />
          ))}
        </>,
      );
    case 'colour-blocks':
      // Flat colour blocks: a strip down one edge, a band across the bottom, one small accent.
      return svg(
        <>
          <rect x={w - 110} y="130" width="110" height={h - 130} fill={c} />
          <rect y={h - 150} width={w} height="150" fill={c} />
          <rect x={w - 110} y={h - 250} width="110" height="100" fill="#f59e0b" />
        </>,
      );
    case 'halftone-vortex':
      // Rings of halftone dots swirling out from just right of centre, fading into the dark.
      return svg(
        <>
          {Array.from({ length: 13 }, (_, ring) => {
            const r = 30 + ring * 30;
            const count = Math.round((2 * Math.PI * r) / 22);
            const size = Math.max(1.2, 7 - ring * 0.5);
            return Array.from({ length: count }, (_, k) => {
              const a = (k / count) * 2 * Math.PI + ring * 0.18;
              return <circle key={`${ring}-${k}`} cx={520 + r * Math.cos(a)} cy={270 + r * Math.sin(a) * 0.9} r={size} fill={c} />;
            });
          })}
        </>,
      );
    case 'centre-ring':
      // One bold ring at the centre of the card.
      return svg(
        <>
          <circle cx="428" cy="250" r="100" fill="none" stroke={c} strokeWidth="14" />
          <circle cx="428" cy="250" r="72" fill="none" stroke={c} strokeWidth="3" />
        </>,
      );
    case 'wing-bars':
      // A ring at the centre with stacked bars reaching out to both edges, printed tone on tone.
      return svg(
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} fill={c}>
              <rect x={40 + i * 36} y={206 + i * 22} width={300 - i * 36} height="12" rx="6" />
              <rect x="516" y={206 + i * 22} width={300 - i * 36} height="12" rx="6" />
            </g>
          ))}
          <circle cx="428" cy="250" r="82" fill="none" stroke={c} strokeWidth="16" />
        </>,
      );
    case 'stadium':
      // A packed stadium: red stands above, the green pitch across the middle, the crowd dark in front.
      return svg(
        <>
          <rect width={w} height="200" fill="#8f1d1d" opacity="0.75" />
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M0 ${30 + i * 20}Q428 ${10 + i * 22} 856 ${30 + i * 20}`} fill="none" stroke={c} strokeWidth="2" />
          ))}
          <rect y="200" width={w} height="150" fill="#4f7d34" opacity="0.8" />
          <path d={`M0 540V400${Array.from({ length: 24 }, (_, i) => `q18 -${30 + ((i * 37) % 30)} 36 0`).join('')}V540z`} fill="#141414" opacity="0.85" />
        </>,
      );
    case 'skyline':
      // A fine line drawing of towers and landmarks running across the middle of the card.
      return svg(
        <path
          d="M380 330h40v-60h20v60h30l18-150 18 150h26v-90h40v90h20l40-120 40 120h24v-40c20-60 60-60 80 0v40h30v-200l8-30 8 30v200h30v-70h34v70h40"
          fill="none"
          stroke={c}
          strokeWidth="3"
          strokeLinejoin="round"
        />,
      );
    case 'faceted-ribbon':
      // A crumpled-foil ribbon of sharp facets twisting across the face in a Z.
      return svg(
        <>
          <path d="M-20 120 300 60 360 200 40 260z" fill={c} opacity="0.55" />
          <path d="M300 60 620 330 560 420 360 200z" fill={c} opacity="0.85" />
          <path d="M620 330 880 280 880 420 560 420z" fill={c} opacity="0.45" />
          <path d="M40 260 360 200 330 250z M360 200 560 420 470 380z" fill="#ffffff" opacity="0.18" />
        </>,
      );
    case 'horizon':
      // The glowing edge of a planet seen from space, with a flare where the light breaks over it.
      return svg(
        <>
          <defs>
            <radialGradient id={`${id}flare`}>
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="0.3" stopColor={c} />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </radialGradient>
          </defs>
          <path d="M-60 560C160 300 480 120 920 70" fill="none" stroke={c} strokeWidth="46" opacity="0.18" />
          <path d="M-60 560C160 300 480 120 920 70" fill="none" stroke={c} strokeWidth="14" opacity="0.45" />
          <path d="M-60 560C160 300 480 120 920 70" fill="none" stroke="#ffffff" strokeWidth="3" opacity="0.85" />
          <circle cx="470" cy="150" r="120" fill={`url(#${id}flare)`} />
        </>,
      );
    case 'swirl-edges':
      // Batik swirls and leaves curling along the left and bottom edges.
      return svg(
        <>
          {[
            [10, 150], [-10, 300], [20, 470], [180, 545], [340, 560], [500, 548],
          ].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${i * 47})`} fill="none" stroke={c} strokeWidth="3" strokeLinecap="round">
              <path d="M0 0c0-24 34-24 34 0s-48 30-48-4 60-40 64 8" />
              <path d="M36 10c22-6 38 6 40 24-20 2-34-8-40-24z" />
            </g>
          ))}
        </>,
      );
    case 'flight-line':
      // A small aeroplane pulling one thin glowing line across the middle of the card.
      return svg(
        <>
          <path d="M430 272H880" stroke={c} strokeWidth="10" opacity="0.25" />
          <path d="M430 272H880" stroke={c} strokeWidth="2.5" />
          <path d="M412 272l-40-10-6-28-12 2 4 26-32-8-8-14-8 2 4 30-4 30 8 2 8-14 32-8-4 26 12 2 6-28z" fill={c} />
        </>,
      );
    case 'sparse-diagonals':
      // A plain face cut by a few long thin strokes, the way a metal card carries a single accent.
      return svg(
        <g stroke={c} fill="none" strokeLinecap="round">
          <path d="M486 -20L206 560" strokeWidth="5" />
          <path d="M700 -20L912 430" strokeWidth="5" />
          <path d="M524 -20L300 560" strokeWidth="1.8" opacity="0.55" />
          <path d="M742 -20L946 400" strokeWidth="1.8" opacity="0.55" />
        </g>,
      );
    case 'contour-lines':
      // Wavy lines packed edge to edge, like the contours on a map, covering the whole face.
      return svg(
        <g fill="none" stroke={c} strokeLinecap="round">
          {Array.from({ length: 15 }, (_, i) => {
            const y = -30 + i * 42;
            return <path key={i} d={`M-40 ${y}q110 -46 220 0t220 0t220 0t220 0`} strokeWidth="11" opacity="0.55" />;
          })}
          {Array.from({ length: 15 }, (_, i) => {
            const y = -10 + i * 42;
            return <path key={`t${i}`} d={`M-40 ${y}q110 -46 220 0t220 0t220 0t220 0`} strokeWidth="3" opacity="0.8" />;
          })}
        </g>,
      );
    case 'meridians':
      // The curved grid of a globe, with a small aeroplane crossing it.
      return svg(
        <>
          <g fill="none" stroke={c} strokeWidth="2">
            {Array.from({ length: 10 }, (_, i) => {
              const x = -140 + i * 128;
              return <path key={`m${i}`} d={`M${x} -40C${x + 150} 170 ${x + 150} 370 ${x} 580`} />;
            })}
            {Array.from({ length: 8 }, (_, i) => {
              const y = -40 + i * 96;
              return <path key={`p${i}`} d={`M-40 ${y}C240 ${y + 74} 620 ${y + 74} 900 ${y}`} />;
            })}
          </g>
          <g transform="translate(672 214) rotate(48) scale(0.62) translate(-50 -64)" fill="#f0a92e">
            <path d="M50 0c6 0 10 9 10 22v26l38 26v14l-38-12v26l14 16v10l-24-8-24 8v-10l14-16V76L2 88V74l38-26V22C40 9 44 0 50 0z" />
          </g>
        </>,
      );
    case 'fine-contours':
      // Close-set contour lines running the whole width, for a face that is all texture.
      return svg(
        <g fill="none" stroke={c} strokeWidth="2.2" opacity="0.5">
          {Array.from({ length: 30 }, (_, i) => {
            const y = -12 + i * 20;
            return <path key={i} d={`M-30 ${y}q112 -16 224 0t224 0t224 0t224 0`} />;
          })}
        </g>,
      );
    case 'guilloche-crest':
      // Engine-turned lines inside a double engraved border, with a portrait oval at the centre.
      return svg(
        <g fill="none" stroke={c}>
          <rect x="14" y="14" width={w - 28} height={h - 28} rx="26" strokeWidth="10" opacity="0.85" />
          <rect x="30" y="30" width={w - 60} height={h - 60} rx="20" strokeWidth="3" opacity="0.7" />
          <rect x="40" y="40" width={w - 80} height={h - 80} rx="16" strokeWidth="6" strokeDasharray="3 9" opacity="0.6" />
          <g strokeWidth="2" opacity="0.55">
            {Array.from({ length: 40 }, (_, i) => {
              const y = -8 + i * 15;
              return <path key={i} d={`M-30 ${y}q104 -11 208 0t208 0t208 0t208 0t208 0`} />;
            })}
          </g>
          <g transform={`translate(${w / 2} ${h / 2})`}>
            <ellipse rx="120" ry="146" fill={c} opacity="0.1" />
            <ellipse rx="120" ry="146" fill="none" strokeWidth="9" opacity="0.9" />
            <ellipse rx="106" ry="132" fill="none" strokeWidth="2.5" opacity="0.65" />
            {/* A Spartan helmet in side profile: the crest is seven segments of one arc, computed. */}
            <g transform="scale(0.58) translate(-121 -167)" fill={c} opacity="0.42">
              <path d="M10.9 208.4A122 122 0 0 1 -3.9 154.8L46.1 152.8A72 72 0 0 0 54.8 184.5ZM-4.0 148.8A122 122 0 0 1 9.2 94.8L53.8 117.4A72 72 0 0 0 46.0 149.3ZM12.0 89.6A122 122 0 0 1 49.8 48.8L77.8 90.3A72 72 0 0 0 55.4 114.3ZM54.9 45.6A122 122 0 0 1 107.7 28.4L111.9 78.3A72 72 0 0 0 80.7 88.4ZM113.7 28.1A122 122 0 0 1 168.2 38.8L147.6 84.4A72 72 0 0 0 115.5 78.0ZM173.6 41.4A122 122 0 0 1 216.0 77.4L175.8 107.1A72 72 0 0 0 150.8 85.9ZM219.4 82.2A122 122 0 0 1 239.0 134.3L189.4 140.7A72 72 0 0 0 177.9 110.0Z" />
              <path d="M59.5 176.0A64 64 0 1 1 182.0 147.8L170.0 148.2A52 52 0 1 0 70.5 171.2Z" />
              <path fillRule="evenodd" d="M75.7 165.4A45 45 0 1 1 163.0 150.0L212 98L222 112L210 204L246 306L98 262L86 220L52 250L46 192ZM108 182L182 182L182 208L152 208L152 194L108 194ZM188 214L202 214L202 258L188 258Z" />
            </g>
          </g>
        </g>,
      );
    default:
      return null;
  }
}

/** The simpler repeating textures, for cards whose artwork is mostly colour. */
function Pattern({ look }: { look: CatalogCardLook }) {
  const c = look.patternColour ?? (look.ink === 'light' ? '#ffffff1f' : '#0000001a');
  const layer = 'pointer-events-none absolute inset-0 h-full w-full';
  switch (look.pattern) {
    case 'diagonal-lines':
      return <span aria-hidden className={layer} style={{ backgroundImage: `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 9px)` }} />;
    case 'dots':
      return <span aria-hidden className={layer} style={{ backgroundImage: `radial-gradient(${c} 1px, transparent 1.6px)`, backgroundSize: '9px 9px' }} />;
    case 'grid':
      return <span aria-hidden className={layer} style={{ backgroundImage: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`, backgroundSize: '14px 14px' }} />;
    case 'stripe':
      return <span aria-hidden className={layer} style={{ background: `linear-gradient(${look.angle ?? 135}deg, transparent 47%, ${c} 47% 53%, transparent 53%)` }} />;
    case 'glow':
      return <span aria-hidden className={layer} style={{ background: `radial-gradient(circle at 78% 22%, ${c}, transparent 62%)` }} />;
    case 'waves':
      return (
        <svg aria-hidden className={layer} viewBox="0 0 160 100" preserveAspectRatio="none">
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M0 ${58 + i * 9} C 40 ${40 + i * 9}, 80 ${80 + i * 9}, 160 ${50 + i * 9}`} fill="none" stroke={c} strokeWidth="1.2" />
          ))}
        </svg>
      );
    case 'arcs':
      return (
        <svg aria-hidden className={layer} viewBox="0 0 160 100" preserveAspectRatio="xMaxYMax slice">
          {[30, 50, 70, 90, 110].map((r) => (
            <circle key={r} cx="160" cy="100" r={r} fill="none" stroke={c} strokeWidth="1.2" />
          ))}
        </svg>
      );
    default:
      return null;
  }
}

/** What makes a flat colour read as plastic or metal: fine grain, brushing, a sheen, and a lit edge. */
function Surface({ finish, id }: { finish: CatalogCardLook['finish'] | 'plain'; id: string }) {
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18] mix-blend-overlay">
        <filter id={`${id}grain`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id}grain)`} />
      </svg>
      {finish === 'metallic' && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'repeating-linear-gradient(0deg, #ffffff0a 0 1px, transparent 1px 3px)' }} />
          <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(115deg, transparent 18%, #ffffff30 36%, transparent 50%, #ffffff12 68%, transparent 84%)' }} />
        </>
      )}
      {(finish === 'glossy' || finish === 'plain') && (
        <span aria-hidden className="pointer-events-none absolute -top-1/2 -left-1/4 h-[120%] w-[90%] -rotate-12 rounded-full bg-gradient-to-b from-white/20 to-transparent blur-md" />
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.28), inset 0 -1px 0 rgb(0 0 0 / 0.3)' }} />
    </>
  );
}

/**
 * A drawn card face, laid out the same way for every card: the bank top left, the card's name top right,
 * the network bottom right, the chip and contactless mark on the left, the digits and holder below.
 *
 * A catalogue card is redrawn from its official picture (colours, finish, texture or illustration) without
 * shipping the bank's artwork. Any other card gets a plain face in its bank's colour.
 */
export function CardFace({
  issuer,
  name,
  last4,
  holderName,
  network,
  look,
  size = 'md',
  behind = false,
  className,
}: {
  issuer: string | null;
  name: string;
  last4: string | null;
  holderName?: string | null;
  network?: string | null;
  look?: CatalogCardLook | null;
  size?: 'sm' | 'md';
  /** Drawn behind another card: only its colour shows, so its edge carries no half-hidden text. */
  behind?: boolean;
  className?: string;
}) {
  // SVG ids must be unique on the page and plain enough for url(#…).
  const id = `face${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const md = size === 'md';
  const portrait = look?.orientation === 'portrait';
  const hue = issuerHue(issuer);
  const background = look
    ? look.colours.length === 1
      ? look.colours[0]
      : `linear-gradient(${look.angle ?? 135}deg, ${look.colours.join(', ')})`
    : hue === null
      ? 'linear-gradient(135deg, hsl(215 20% 42%), hsl(222 30% 20%))'
      : `linear-gradient(135deg, hsl(${hue} 55% 40%), hsl(${(hue + 35) % 360} 60% 18%))`;
  const dark = look?.ink === 'dark';
  // The bank is printed on its own, so "BCA KrisFlyer" names the card as "KrisFlyer".
  const product = issuer && name.toLowerCase().startsWith(`${issuer.toLowerCase()} `) ? name.slice(issuer.length + 1) : name;
  const bank = look?.bankMark === undefined ? issuer : look.bankMark;
  const cardName = look?.wordmark ?? product;
  const emboss = dark ? '0 1px 0 rgb(255 255 255 / 0.45), 0 -1px 0 rgb(0 0 0 / 0.2)' : '0 1px 0 rgb(0 0 0 / 0.55), 0 -1px 0 rgb(255 255 255 / 0.18)';
  const inset = md ? (portrait ? 12 : 16) : 9;

  return (
    <div
      role={behind ? undefined : 'img'}
      aria-hidden={behind || undefined}
      aria-label={behind ? undefined : `${name}${last4 ? ` ending ${last4}` : ''}${holderName ? `, ${holderName}` : ''}`}
      data-testid="card-face"
      className={cx(
        'relative shrink-0 overflow-hidden rounded-[0.9rem] shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)] select-none',
        dark ? 'text-slate-900' : 'text-white',
        portrait ? 'aspect-[0.6305]' : 'aspect-[1.586]',
        portrait ? (md ? 'w-[9.5rem] text-[10px]' : 'w-24 text-[7px]') : md ? 'w-60 text-xs' : 'w-36 text-[8px]',
        className,
      )}
      style={{ background, textShadow: dark ? undefined : '0 1px 2px rgb(0 0 0 / 0.35)' }}
    >
      {look?.motif ? <Motif look={look} id={id} /> : look ? <Pattern look={look} /> : null}
      <Surface finish={look?.finish ?? 'plain'} id={id} />
      {!behind && (
        <>
          <div className="absolute flex items-start justify-between gap-2" style={{ top: inset - 2, left: inset, right: inset }}>
            <div className="min-w-0 truncate font-bold tracking-wide">{bank}</div>
            <div className={cx('min-w-0 truncate text-right leading-tight font-semibold tracking-tight', md ? (cardName.length > 14 ? 'text-[13px]' : 'text-[15px]') : 'text-[10px]')}>
              {cardName}
            </div>
          </div>
          <div className={cx('absolute flex items-center gap-2', portrait ? 'top-[34%]' : 'top-[37%]')} style={{ left: inset }}>
            {look?.chip !== 'none' && <Chip kind={look?.chip === 'silver' ? 'silver' : 'gold'} md={md} id={id} />}
            <Contactless md={md} />
          </div>
          <div className="absolute flex items-end justify-between gap-2" style={{ bottom: inset - 4, left: inset, right: inset }}>
            <div className="min-w-0">
              <div className={cx('tabular tracking-[0.18em] whitespace-nowrap', md ? 'text-[15px]' : 'text-[10px]')} style={{ textShadow: emboss }}>
                •••• {last4 ?? '····'}
              </div>
              {holderName && (
                <div className="truncate tracking-[0.12em] uppercase opacity-85" style={{ textShadow: emboss }}>
                  {holderName}
                </div>
              )}
            </div>
            <NetworkMark network={network ?? null} />
          </div>
        </>
      )}
    </div>
  );
}
