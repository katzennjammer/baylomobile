import Link from "next/link"
import Image from "next/image"
import RevealScript from "@/components/RevealScript"
import ClientEffects from "@/components/ClientEffects"
import BrowseGateButton from "@/components/BrowseGateButton"
import CategoryGateLink from "@/components/CategoryGateLink"

/* Static counts mirror the HTML design. To show live counts, swap `count`
   for a prisma query, e.g. in an async Home():
     const counts = await prisma.item.groupBy({ by: ["category"],
       where: { status: "AVAILABLE" }, _count: { id: true } }) */
const CATEGORIES = [
  { key: "CLOTHING",    num: "01", name: "Apparel & Thrift",  count: "2,400+ listings", img: "/apparel.png" },
  { key: "BOOKS",       num: "02", name: "Books & Media",     count: "1,100+ listings", img: "/booksandmedia.png" },
  { key: "ELECTRONICS", num: "03", name: "Tech & Gadgets",    count: "860+ listings",   img: "/techandgadgets.png" },
  { key: "FURNITURE",   num: "04", name: "Home & Living",     count: "1,500+ listings", img: "/homeandliving.png" },
  { key: "TOYS",        num: "05", name: "Kids & Baby",       count: "640+ listings",   img: "/kidsandbaby.png" },
  { key: "SPORTS",      num: "06", name: "Sports & Outdoors", count: "720+ listings",   img: "/sportsandoutdoors.png" },
]

const EVENTS = [
  { d: "14", m: "Jun", title: "Sunday Swap Meet",   where: "Plaza Independencia, Cebu City", tag: "Free entry" },
  { d: "21", m: "Jun", title: "Campus Barter Bazaar", where: "USC Talamban, Cebu",           tag: "Students" },
  { d: "05", m: "Jul", title: "Pre-loved Tech Fair",  where: "Ayala Center Cebu",            tag: "Gadgets" },
  { d: "19", m: "Jul", title: "Slow Fashion Swap",    where: "The Outpost, Lahug",           tag: "Apparel" },
]

const GALLERY = [
  { cls: "g-a",    speed: "0.10", img: "/communityswap-wideshot.png" },
  { cls: "g-b",    speed: "0.16", img: "/happy.png" },
  { cls: "g-c",    speed: "0.12", img: "/marketstall.png" },
  { cls: "g-d",    speed: "0.20", img: "/handovergoods.png" },
  { cls: "g-e",    speed: "0.14", img: "/phonetheapp.png" },
  { cls: "g-wide", speed: "0.08", img: "/pre-lovedfinds.png" },
]

function Arrow({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Home() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="hero" id="top">
        <div className="hero-media" aria-hidden="true">
          <video
            src="https://res.cloudinary.com/dm7ctbxq7/video/upload/v1781167091/IntroVideo-baylo_hve7u2.mp4"
            autoPlay
            loop
            muted
            playsInline
          />
        </div>
        <div className="hero-inner wrap">
          <p className="kicker" data-reveal>A circular economy, built on barter</p>
          <h1 className="display">
            <span className="line-mask"><span>Trade what</span></span>
            <span className="line-mask"><span>you have for</span></span>
            <span className="line-mask"><span>what you <em style={{ fontStyle: "normal", color: "var(--accent)" }}>need.</em></span></span>
          </h1>
          <div className="hero-foot">
            <p className="lede" data-reveal data-reveal-delay="2">
              Baylo is the moneyless marketplace where Cebu swaps, shares and circulates
              goods — through points and trust, not cash.
            </p>
          </div>
        </div>
      </section>

      {/* ── Statement ────────────────────────────────────────── */}
      <section className="statement wrap" id="how">
        <p data-reveal>
          Beyond the price tag
          <span className="inl" aria-hidden="true" style={{ position: "relative" }}>
            <Image src="/peopleswapping.png" alt="" fill style={{ objectFit: "cover" }} />
          </span>{" "}Baylo turns the things you
          <span className="inl" aria-hidden="true" style={{ position: "relative" }}>
            <Image src="/thriftedjacket.png" alt="" fill style={{ objectFit: "cover" }} />
          </span>{" "}already own into a{" "}
          <span className="accent">living, circular</span> community
          <span className="inl" aria-hidden="true" style={{ position: "relative" }}>
            <Image src="/stackedbooks.png" alt="" fill style={{ objectFit: "cover" }} />
          </span>{" "}of swaps, second lives
          <span className="inl" aria-hidden="true" style={{ position: "relative" }}>
            <Image src="/repairedbike.png" alt="" fill style={{ objectFit: "cover" }} />
          </span>{" "}and fair trades.
        </p>
        <div className="statement-sub">
          <p data-reveal data-reveal-delay="1">
            Humanity now consumes resources <strong style={{ color: "var(--text)" }}>1.75&times; faster</strong>{" "}
            than the Earth can regenerate — and a throwaway culture keeps perfectly good
            things in landfills. Baylo decouples{" "}
            <em style={{ fontStyle: "normal", color: "var(--text)" }}>getting what you need</em> from
            buying something new, replacing the &ldquo;double coincidence of wants&rdquo; with
            virtual points and a reputation you can trust.
          </p>
          <div className="stat-row" data-reveal data-reveal-delay="2">
            <div className="stat"><div className="n">1.75&times;</div><div className="l">Earth&rsquo;s resources used vs. regenerated</div></div>
            <div className="stat"><div className="n">70%</div><div className="l">Projected rise in global waste by 2050</div></div>
            <div className="stat"><div className="n">0</div><div className="l">Cash needed to trade on Baylo</div></div>
          </div>
        </div>
      </section>

      {/* ── Categories ───────────────────────────────────────── */}
      <section className="section wrap" id="categories">
        <div className="section-head">
          <h2 className="display" data-reveal>What you<br />can trade</h2>
          <div className="meta">
            <p className="lede" data-reveal data-reveal-delay="1" style={{ fontSize: "clamp(16px,1.3vw,21px)", color: "var(--muted)", maxWidth: "34ch" }}>
              Six living categories of goods circulating through Cebu — every item earns
              points you can spend anywhere on Baylo.
            </p>
            <BrowseGateButton className="link-pill" data-reveal data-reveal-delay="2">
              Browse all categories <Arrow />
            </BrowseGateButton>
          </div>
        </div>
        <div className="cats">
          {CATEGORIES.map((c, i) => (
            <CategoryGateLink className="cat" href={`/listings?category=${c.key}`} key={c.key} data-reveal data-reveal-delay={((i % 3) + 1) as 1 | 2 | 3}>
              <div className="cat-media" aria-hidden="true">
                <Image src={c.img} alt="" fill style={{ objectFit: "cover" }} />
              </div>
              <div className="cat-body">
                <div>
                  <div className="cat-num">{c.num}</div>
                  <div className="cat-name">{c.name}</div>
                  <div className="cat-count">{c.count}</div>
                </div>
                <span className="cat-go"><Arrow size={16} /></span>
              </div>
            </CategoryGateLink>
          ))}
        </div>
      </section>
      {/* ── Gallery ──────────────────────────────────────────── */}
      <section className="section gallery wrap" id="gallery">
        <div className="section-head">
          <h2 className="display" data-reveal>Baylo<br />in action</h2>
          <div className="meta">
            <p style={{ color: "var(--muted)", fontSize: "clamp(16px,1.3vw,21px)", maxWidth: "30ch", lineHeight: 1.4 }} data-reveal data-reveal-delay="1">
              Real trades, real people, real second lives for everyday things.
            </p>
          </div>
        </div>
        <div className="gallery-grid">
          {GALLERY.map((g) => (
            <div className={"g-item " + g.cls} key={g.cls} data-reveal>
              <div className="pimg" data-parallax={g.speed} aria-hidden="true">
                <Image src={g.img} alt="" fill style={{ objectFit: "cover" }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <RevealScript />
      <ClientEffects />
    </>
  )
}
