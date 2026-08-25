"use client"

import { useEffect } from "react"

/**
 * Scroll-reveal for [data-reveal] elements + hero line-mask trigger.
 * Mirrors the reveal behavior in the original HTML design.
 */
export default function RevealScript() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"))
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (reduce) {
      els.forEach((e) => e.classList.add("in"))
      document.querySelector(".hero h1")?.classList.add("hero-ready")
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("in")
            io.unobserve(en.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    )
    els.forEach((e) => io.observe(e))

    // fire the hero headline mask reveal on mount
    const raf = requestAnimationFrame(() =>
      document.querySelector(".hero h1")?.classList.add("hero-ready")
    )

    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
