import Link from "next/link"
import Image from "next/image"

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

export default function SiteFooter() {
  return (
    <footer className="footer" id="contact">
      <div className="wrap">
        {/* small links row + divider */}
        <div className="footer-links">
        </div>

        {/* giant statement left · image right */}
        <div className="footer-main">
          <div className="footer-left-inner">
            <div>
              <h2 className="footer-statement" data-reveal>
                Nothing wasted.<br />
                <span className="accent">Everything traded.</span>
              </h2>
              <p className="footer-meta" data-reveal data-reveal-delay="1">
                Baylo Labs · Cebu IT Park, Apas<br />
                Cebu City 6000, Philippines<br />
                <a href="mailto:hello@baylo.ph">hello@baylo.ph</a> · +63 32 000 0000
              </p>
            </div>

            <div style={{ marginTop: "auto" }}>
              <Link
                href="/auth/register"
                className="btn solid"
                style={{ marginTop: "clamp(34px, 4vw, 56px)" }}
              >
                Sign up free
                <span className="arrow"><ArrowIcon /></span>
              </Link>

              <div className="footer-socials" data-reveal data-reveal-delay="2">
                <a href="#" aria-label="Instagram">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
                  </svg>
                </a>
                <a href="#" aria-label="Facebook">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M14 8h2V5h-2c-2 0-3 1.3-3 3.2V10H9v3h2v6h3v-6h2.2L17 10h-3V8.6c0-.4.3-.6.7-.6Z" fill="currentColor" />
                  </svg>
                </a>
                <a href="#" aria-label="TikTok">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M14 4c.4 2.3 1.8 3.7 4 4v3c-1.5 0-2.9-.5-4-1.3V15a5 5 0 1 1-5-5v3a2 2 0 1 0 2 2V4h3Z" fill="currentColor" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          <div className="footer-visual" data-reveal data-reveal-delay="1" aria-hidden="true">
            <Image src="/footerimage.png" alt="" fill style={{ objectFit: "cover" }} />
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="footer-bottom">
          <span>© 2026 Baylo Labs · Toward a local circular economy</span>
          <div className="legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
