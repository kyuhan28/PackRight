/**
 * @author: @dorianbaffier
 * @description: Wind. Streamlines that part around the cursor, swirl in its wake and scatter on click.
 * @version: 2.0.0
 * @date: 2026-10-14
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 */
import { useEffect, useRef } from 'react'
import './flow-field.css'

const cn = (...c) => c.filter(Boolean).join(' ')

const BASE_COUNT = 700
const WIND = 64
const NOISE_SCALE = 340
const TURN = 1.15
const RESPONSE = 9
const TRAIL_TAU = 0.22
const DISC_RADIUS = 64
const DISC_FOLLOW = 18
const DISC_RISE = 7
const SHED_SPEED = 150
const SHED_MS = 42
const MAX_VORTICES = 30
const VORTEX_CORE = 30
const VORTEX_GAIN = 0.62 * Math.PI * 2 * VORTEX_CORE * 0.5
const VORTEX_TAU = 1.1
const VORTEX_SPREAD = 0.5
const MAX_CURSOR_SPEED = 1600
const GUST_MS = 1300
const GUST_SPEED = 0.62
const GUST_WIDTH = 64
const GUST_STRENGTH = 560

const BUCKETS = [0.18, 0.34, 0.54, 0.8]
const MAX_SEGMENT = 40
const IDLE_FRAME_MS = 33
const CLEANUP_MS = 1000
const CLEANUP_ALPHA = 0.24
const STILL_LINES = 340
const STILL_STEPS = 18
const STILL_DT = 0.05

function createNoise(seed) {
  const p = Array.from({ length: 256 }, (_, i) => i)
  let state = seed >>> 0 || 1
  const random = () => { state = (state * 1_664_525 + 1_013_904_223) >>> 0; return state / 4_294_967_296 }
  for (let i = 255; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (a, b, t) => a + (b - a) * t
  const grad = (hash, x, y, z) => {
    const h = hash & 15
    const u = h < 8 ? x : y
    let v = z
    if (h < 4) v = y
    else if (h === 12 || h === 14) v = x
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
    const fx = x - Math.floor(x), fy = y - Math.floor(y), fz = z - Math.floor(z)
    const u = fade(fx), v = fade(fy), w = fade(fz)
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z
    return lerp(
      lerp(lerp(grad(perm[AA], fx, fy, fz), grad(perm[BA], fx - 1, fy, fz), u),
        lerp(grad(perm[AB], fx, fy - 1, fz), grad(perm[BB], fx - 1, fy - 1, fz), u), v),
      lerp(lerp(grad(perm[AA + 1], fx, fy, fz - 1), grad(perm[BA + 1], fx - 1, fy, fz - 1), u),
        lerp(grad(perm[AB + 1], fx, fy - 1, fz - 1), grad(perm[BB + 1], fx - 1, fy - 1, fz - 1), u), v),
      w)
  }
}

const out = { x: 0, y: 0 }

function baseWind(air, x, y) {
  const t = air.time
  const angle = air.noise((x - t * WIND * 0.6) / NOISE_SCALE, y / NOISE_SCALE, t * 0.06) * TURN
  out.x = Math.cos(angle) * air.wind
  out.y = Math.sin(angle) * air.wind
}

function addDisc(disc, x, y) {
  const radius = DISC_RADIUS * disc.amount
  const dx = x - disc.x, dy = y - disc.y
  const r2 = Math.max(dx * dx + dy * dy, radius * radius)
  const k = (radius * radius) / (r2 * r2)
  const rx = out.x - disc.vx, ry = out.y - disc.vy
  const p = dx * dx - dy * dy, q = -2 * dx * dy
  out.x -= k * (rx * p - ry * q)
  out.y += k * (rx * q + ry * p)
}

function addVortices(vortices, x, y) {
  for (const v of vortices) {
    const dx = x - v.x, dy = y - v.y
    const r2 = dx * dx + dy * dy + 1
    const core = VORTEX_CORE * VORTEX_CORE * (1 + v.age / VORTEX_SPREAD)
    const swirl = ((v.gamma * Math.exp(-v.age / VORTEX_TAU)) / (2 * Math.PI * r2)) * (1 - Math.exp(-r2 / core))
    out.x -= swirl * dy
    out.y += swirl * dx
  }
}

function addGusts(gusts, now, x, y) {
  for (const g of gusts) {
    const age = now - g.start
    const dx = x - g.x, dy = y - g.y
    const r = Math.hypot(dx, dy) + 0.001
    const d = r - age * GUST_SPEED
    const fadeOut = 1 - age / GUST_MS
    const push = GUST_STRENGTH * fadeOut * fadeOut * Math.exp(-(d * d) / (2 * GUST_WIDTH * GUST_WIDTH))
    out.x += (push * dx) / r
    out.y += (push * dy) / r
  }
}

function velocityAt(air, x, y) {
  baseWind(air, x, y)
  if (air.disc.amount > 0.002) addDisc(air.disc, x, y)
  if (air.vortices.length > 0) addVortices(air.vortices, x, y)
  if (air.gusts.length > 0) addGusts(air.gusts, air.now, x, y)
}

function stepDisc(disc, vortices, dt, now) {
  const px = disc.x, py = disc.y
  const follow = 1 - Math.exp(-DISC_FOLLOW * dt)
  disc.x += (disc.targetX - disc.x) * follow
  disc.y += (disc.targetY - disc.y) * follow
  const goal = disc.on ? 1 : 0
  disc.amount += (goal - disc.amount) * (1 - Math.exp(-DISC_RISE * dt))
  if (disc.amount < 0.002 && !disc.on) disc.amount = 0
  const smooth = 1 - Math.exp(-14 * dt)
  disc.vx += ((disc.x - px) / dt - disc.vx) * smooth
  disc.vy += ((disc.y - py) / dt - disc.vy) * smooth
  const speed = Math.hypot(disc.vx, disc.vy)
  if (speed < SHED_SPEED || disc.amount < 0.5 || now - disc.lastShed < SHED_MS) return
  disc.lastShed = now
  disc.side = -disc.side
  const ux = disc.vx / speed, uy = disc.vy / speed
  const radius = DISC_RADIUS * disc.amount

  vortices.push({
    x: disc.x - ux * radius * 0.9 - uy * disc.side * radius * 0.55,
    y: disc.y - uy * radius * 0.9 + ux * disc.side * radius * 0.55,
    gamma: disc.side * VORTEX_GAIN * Math.min(speed, MAX_CURSOR_SPEED),
    age: 0,
  })
  if (vortices.length > MAX_VORTICES) vortices.shift()
}

function stepWake(air, dt) {
  for (const v of air.vortices) {
    baseWind(air, v.x, v.y)
    v.x += out.x * 0.85 * dt
    v.y += out.y * 0.85 * dt
    v.age += dt
  }
  while (air.vortices.length > 0 && air.vortices[0].age > VORTEX_TAU * 3.5) air.vortices.shift()
  while (air.gusts.length > 0 && air.now - air.gusts[0].start > GUST_MS) air.gusts.shift()
}

class Particles {
  count = 0
  width = 0
  height = 0
  x = new Float32Array(0)
  y = new Float32Array(0)
  vx = new Float32Array(0)
  vy = new Float32Array(0)
  life = new Float32Array(0)
  maxLife = new Float32Array(0)
  pace = new Float32Array(0)

  resize(count, width, height) {
    if (count === this.count) {

      const sx = this.width > 0 ? width / this.width : 1
      const sy = this.height > 0 ? height / this.height : 1
      for (let i = 0; i < count; i++) { this.x[i] *= sx; this.y[i] *= sy }
      this.width = width
      this.height = height
      return
    }
    this.width = width
    this.height = height
    this.count = count
    this.x = new Float32Array(count)
    this.y = new Float32Array(count)
    this.vx = new Float32Array(count)
    this.vy = new Float32Array(count)
    this.life = new Float32Array(count)
    this.maxLife = new Float32Array(count)
    this.pace = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      this.spawn(i, width, height)

      this.life[i] = Math.random() * this.maxLife[i]
    }
  }

  spawn(i, width, height) {
    this.x[i] = Math.random() * width
    this.y[i] = Math.random() * height
    this.vx[i] = 0
    this.vy[i] = 0
    this.life[i] = 0
    this.maxLife[i] = 3 + Math.random() * 5
    this.pace[i] = 0.75 + Math.random() * 0.5
  }
}

const envelope = (life, maxLife) => Math.min(1, life / 0.6, (maxLife - life) / 0.6)
const bucketOf = (intensity) => Math.max(0, Math.min(BUCKETS.length - 1, Math.floor(intensity * 4)))

function wrap(v, size) {
  if (v < -8) return v + size + 16
  if (v > size + 8) return v - size - 16
  return v
}

function keepOutOfDisc(p, i, disc) {
  if (disc.amount === 0) return
  const radius = DISC_RADIUS * disc.amount
  const dx = p.x[i] - disc.x, dy = p.y[i] - disc.y
  const r2 = dx * dx + dy * dy
  if (r2 >= radius * radius || r2 < 0.0001) return
  const r = Math.sqrt(r2)
  p.x[i] = disc.x + (dx / r) * radius
  p.y[i] = disc.y + (dy / r) * radius
}

function stepParticle(c, i) {
  const { air, particles: p, dt } = c
  p.life[i] += dt
  if (p.life[i] > p.maxLife[i]) { p.spawn(i, c.width, c.height); return }
  const x0 = p.x[i], y0 = p.y[i]
  velocityAt(air, x0, y0)
  const take = 1 - Math.exp(-RESPONSE * dt)
  p.vx[i] += (out.x * p.pace[i] - p.vx[i]) * take
  p.vy[i] += (out.y * p.pace[i] - p.vy[i]) * take
  p.x[i] = wrap(x0 + p.vx[i] * dt, c.width)
  p.y[i] = wrap(y0 + p.vy[i] * dt, c.height)
  keepOutOfDisc(p, i, air.disc)
  const sx = p.x[i] - x0, sy = p.y[i] - y0
  if (sx * sx + sy * sy > MAX_SEGMENT * MAX_SEGMENT) return

  const pace = Math.hypot(p.vx[i], p.vy[i]) / (air.wind * 2.4 + 1)
  const intensity = envelope(p.life[i], p.maxLife[i]) * Math.min(1, 0.4 + pace)
  const path = c.paths[bucketOf(intensity)]
  path.moveTo(x0, y0)
  path.lineTo(p.x[i], p.y[i])
}

function strokeBuckets(ctx, paths) {
  for (let b = 0; b < BUCKETS.length; b++) { ctx.globalAlpha = BUCKETS[b]; ctx.stroke(paths[b]) }
  ctx.globalAlpha = 1
}

function drawStill(ctx, air, size, lines) {
  const paths = BUCKETS.map(() => new Path2D())
  for (let n = 0; n < lines; n++) {
    let x = Math.random() * size.width
    let y = Math.random() * size.height
    for (let s = 0; s < STILL_STEPS; s++) {
      baseWind(air, x, y)
      const nx = x + out.x * STILL_DT, ny = y + out.y * STILL_DT

      const path = paths[bucketOf((s / STILL_STEPS) * 0.75)]
      path.moveTo(x, y)
      path.lineTo(nx, ny)
      x = nx
      y = ny
    }
  }
  strokeBuckets(ctx, paths)
}

function createAir(speed) {
  return {
    noise: createNoise(7),
    time: 0,

    wind: WIND * (speed > 0 ? speed : 1),
    disc: { x: 0, y: 0, targetX: 0, targetY: 0, vx: 0, vy: 0, amount: 0, on: false, lastShed: 0, side: 1 },
    vortices: [],
    gusts: [],
    now: 0,
  }
}

function bindPointer(root, air, wake, isVisible) {
  const local = (event) => {
    const rect = root.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height }
  }
  const onLeave = () => { air.disc.on = false }
  const onMove = (event) => {

    if (!isVisible() || (event.pointerType === 'touch' && event.buttons === 0)) return
    const point = local(event)
    const disc = air.disc
    if (!point.inside) { disc.on = false; return }
    if (disc.amount < 0.05) {

      disc.x = point.x; disc.y = point.y; disc.vx = 0; disc.vy = 0
    }
    disc.targetX = point.x
    disc.targetY = point.y
    disc.on = true
    wake()
  }
  const onOut = (event) => { if (!event.relatedTarget) onLeave() }
  const onUp = (event) => { if (event.pointerType === 'touch') onLeave() }
  const onDown = (event) => {
    if (!isVisible() || event.button !== 0) return

    const target = event.target instanceof Element ? event.target : null
    if (target?.closest("a, button, input, textarea, select, label, [role='button']")) return
    const point = local(event)
    if (!point.inside) return
    air.gusts.push({ x: point.x, y: point.y, start: performance.now() })
    if (air.gusts.length > 4) air.gusts.shift()
    onMove(event)
    wake()
  }
  const options = { passive: true }
  window.addEventListener('pointermove', onMove, options)
  window.addEventListener('pointerdown', onDown, options)
  window.addEventListener('pointerup', onUp, options)
  window.addEventListener('pointercancel', onLeave, options)
  document.addEventListener('pointerout', onOut, options)
  window.addEventListener('blur', onLeave)
  return () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onLeave)
    document.removeEventListener('pointerout', onOut)
    window.removeEventListener('blur', onLeave)
  }
}

export default function FlowField({ className, children, density = 1, speed = 1, interactive = true }) {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!(root && canvas && ctx)) return

    const still = speed <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const air = createAir(speed)
    const particles = new Particles()
    const size = { width: 0, height: 0 }
    let color = ''
    let raf = 0, lastStep = 0, lastCleanup = 0
    let visible = true

    const countFor = (w) => Math.round(BASE_COUNT * Math.max(density, 0) * (w < 520 ? 0.6 : 1))
    const paintStill = () => {
      ctx.clearRect(0, 0, size.width, size.height)
      ctx.strokeStyle = color
      const lines = (countFor(size.width) * STILL_LINES) / BASE_COUNT
      drawStill(ctx, air, size, Math.round(lines))
    }

    const resize = () => {

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      size.width = canvas.clientWidth
      size.height = canvas.clientHeight
      canvas.width = Math.round(size.width * dpr)
      canvas.height = Math.round(size.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'butt'
      ctx.lineWidth = 1.2
      color = getComputedStyle(canvas).color
      particles.resize(countFor(size.width), size.width, size.height)
      if (still) paintStill()
    }

    const isActive = () => air.disc.on || air.disc.amount > 0 || air.vortices.length > 0 || air.gusts.length > 0

    const fade = (dt, now) => {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = '#000'
      ctx.globalAlpha = 1 - Math.exp(-dt / TRAIL_TAU)
      ctx.fillRect(0, 0, size.width, size.height)
      if (dt < 0.025 && now - lastCleanup > CLEANUP_MS) {
        lastCleanup = now
        ctx.globalAlpha = CLEANUP_ALPHA
        ctx.fillRect(0, 0, size.width, size.height)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }

    const frame = (now) => {
      raf = 0
      if (!visible) return
      raf = requestAnimationFrame(frame)
      if (!isActive() && now - lastStep < IDLE_FRAME_MS - 4) return
      const dt = lastStep ? Math.min((now - lastStep) / 1000, 0.05) : 1 / 60
      lastStep = now
      air.now = now
      air.time += dt * speed
      stepDisc(air.disc, air.vortices, dt, now)
      stepWake(air, dt)
      fade(dt, now)
      const paths = BUCKETS.map(() => new Path2D())
      const step = { air, particles, paths, width: size.width, height: size.height, dt }
      for (let i = 0; i < particles.count; i++) stepParticle(step, i)
      ctx.strokeStyle = color
      strokeBuckets(ctx, paths)
    }

    const start = () => { if (!raf && visible && !still) { lastStep = 0; raf = requestAnimationFrame(frame) } }

    resize()
    canvas.style.opacity = '1'
    start()

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)

    let dprQuery = null
    const onDpr = () => { resize(); watchDpr() }
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', onDpr)
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      dprQuery.addEventListener('change', onDpr)
    }
    watchDpr()

    let onScreen = true
    const update = () => { visible = onScreen && document.visibilityState === 'visible'; start() }
    const intersection = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; update() })
    intersection.observe(root)
    document.addEventListener('visibilitychange', update)

    const colorTimer = window.setInterval(() => {
      if (!visible) return
      const next = getComputedStyle(canvas).color
      if (next !== color) { color = next; if (still) paintStill() }
    }, 500)

    const unbind = interactive && !still ? bindPointer(root, air, start, () => visible) : undefined

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      dprQuery?.removeEventListener('change', onDpr)
      intersection.disconnect()
      document.removeEventListener('visibilitychange', update)
      window.clearInterval(colorTimer)
      unbind?.()
    }
  }, [density, speed, interactive])

  return (
    <div className={cn('kff', className)} ref={rootRef}>
      <div aria-hidden="true" className="kff__layer">
        <canvas className="kff__canvas" ref={canvasRef} />
      </div>
      {children === undefined || children === null ? null : <div className="kff__content">{children}</div>}
    </div>
  )
}
