// The cup's outline (our own drawing) in a 100 × 110 box: the Cup component (SVG) and the share
// card (canvas) draw the same shape.
export const CUP_PATHS = {
  handleLeft: 'M27 13c-12 0-17 6-15.5 14.5C13 37 21 45 32 48',
  handleRight: 'M73 13c12 0 17 6 15.5 14.5C87 37 79 45 68 48',
  bowl: 'M23 6h54v20c0 20-11 33-27 37-16-4-27-17-27-37z',
  stem: 'M45 63h10l-1.5 15h-7z',
  base: 'M33 84h34l4 15H29z',
  star: 'm50 18 3.1 6.4 7 1-5.1 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5.1-4.9 7-1z',
  crown: 'M36 20l6 6 8-10 8 10 6-6-3 16H39z',
};
/** Metal colours: [highlight, body, shadow, sheen] and the darker edge [from, mid, to]. */
export const METALS = {
  gold: {
    face: ['#fff4cf', '#f5c84c', '#a8770f', '#f7d774'],
    edge: ['#8a5d06', '#f2c94c', '#7a5205'],
  },
  silver: {
    face: ['#ffffff', '#cfd8e6', '#7f8ba0', '#e8eef7'],
    edge: ['#5d6878', '#dfe6f1', '#566070'],
  },
  bronze: {
    face: ['#ffe2c4', '#dc9456', '#8a4f1f', '#eaa970'],
    edge: ['#6e3d15', '#dd9b5f', '#643712'],
  },
  // The ultimate achievement: a holographic cup.
  holo: {
    face: ['#f6ffb8', '#7debd6', '#8f7bf0', '#ff9ed2'],
    edge: ['#4b3fb0', '#9ff0e0', '#b0478a'],
  },
};
