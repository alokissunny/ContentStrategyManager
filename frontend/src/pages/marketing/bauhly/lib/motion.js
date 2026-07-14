export const heroPop = (delay = 0) => ({
  initial: { opacity: 0, y: 48, scale: 0.94 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { type: 'spring', stiffness: 110, damping: 16, delay },
})

export const pop = {
  initial: { opacity: 0, y: 48, scale: 0.94 },
  whileInView: { opacity: 1, y: 0, scale: 1 },
  viewport: { once: true, margin: '-80px' },
  transition: { type: 'spring', stiffness: 110, damping: 16 },
}

export const popDelayed = (delay) => ({
  ...pop,
  transition: { ...pop.transition, delay },
})

export const bob = (delay = 0, dist = 10, duration = 4.5) => ({
  animate: { y: [0, -dist, 0] },
  transition: { repeat: Infinity, duration, ease: 'easeInOut', delay },
})

/* cards slide in from a direction with a slight rotation settle —
   softer spring so entrances overlap and feel continuous, not popped */
export const slide = (i = 0, dir = 1) => ({
  initial: { opacity: 0, x: 44 * dir, y: 24, rotate: 2.2 * dir },
  whileInView: { opacity: 1, x: 0, y: 0, rotate: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { type: 'spring', stiffness: 80, damping: 15, delay: i * 0.08 },
})

export const heroSlide = (delay = 0, dir = 1) => ({
  initial: { opacity: 0, x: 44 * dir, y: 24, rotate: 2.2 * dir },
  animate: { opacity: 1, x: 0, y: 0, rotate: 0 },
  transition: { type: 'spring', stiffness: 80, damping: 15, delay },
})
