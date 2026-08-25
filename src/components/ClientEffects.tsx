"use client"

import { useEffect } from "react"

/**
 * Lightweight parallax for [data-parallax] elements.
 * Optional numeric value: data-parallax="0.18" (defaults to 0.12).
 */
export default function ClientEffects() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) return

    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"))
    if (!nodes.length) return

    let raf: number | null = null
    const update = () => {
      const vh = window.innerHeight
      nodes.forEach((n) => {
        const speed = parseFloat(n.dataset.parallax || "") || 0.12
        const r = n.getBoundingClientRect()
        const center = r.top + r.height / 2
        const offset = (center - vh / 2) * -speed
        n.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`
      })
      raf = null
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
