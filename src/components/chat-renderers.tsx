"use client"
import React from "react"
import { Icon } from "@/app/dashboard/_shell/TopNav"
import type {
  OfferPayload, OfferUpdatePayload, SharedPostPayload, ImagePayload, VoicePayload,
} from "@/lib/chat-helpers"
import { fmtDur } from "@/lib/chat-helpers"

// ── OfferCard ─────────────────────────────────────────────────────────────
export function OfferCard({ payload, myId, partnerId: _partnerId, isSender, onAction }: {
  payload: OfferPayload; myId: string; partnerId: string; isSender: boolean;
  onAction: (offerId: string, action: "accept" | "decline", newStatus: string) => void;
}) {
  const [acting, setActing] = React.useState(false)
  const status = payload.status

  const act = async (action: "accept" | "decline") => {
    setActing(true)
    try {
      const res = await fetch(`/api/offers/${payload.offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        const data = await res.json() as {
          status: string; tradeId?: string; offeredItemTitle?: string; requestedItemTitle?: string;
          senderId?: string; senderName?: string; receiverId?: string; receiverName?: string;
        }
        onAction(payload.offerId, action, data.status)
        if (action === "accept" && data.tradeId) {
          window.dispatchEvent(new CustomEvent("baylo:trade-accepted", {
            detail: {
              tradeId: data.tradeId,
              offeredItemTitle: data.offeredItemTitle ?? payload.offeredItems[0]?.title ?? "Item",
              requestedItemTitle: data.requestedItemTitle ?? payload.postItem.title,
              senderId: data.senderId ?? payload.senderId ?? "",
              senderName: data.senderName ?? payload.senderName,
              receiverId: data.receiverId ?? myId,
              receiverName: data.receiverName ?? "",
            },
          }))
        }
      }
    } finally {
      setActing(false)
    }
  }

  const offeredLabel = isSender ? "You offer" : `${payload.senderName} offers`
  const offeredDesc =
    payload.offeredItems.map((i) => i.title).join(", ") +
    (payload.offeredLeaves ? ` + ${payload.offeredLeaves} Leaves` : "") ||
    (payload.offeredLeaves ? `${payload.offeredLeaves} Leaves` : "—")

  return (
    <div className="offer-card">
      <div className="offer-card-label">Trade offer</div>
      <div className="offer-card-items">
        <div className="offer-card-side">
          <span className="offer-card-side-label">{offeredLabel}</span>
          <strong>{offeredDesc}</strong>
        </div>
        <span className="offer-card-swap"><Icon name="swap" size={15} /></span>
        <div className="offer-card-side">
          <span className="offer-card-side-label">For</span>
          <strong>{payload.postItem.title}</strong>
        </div>
      </div>
      {payload.userMessage && <p className="offer-card-msg">&ldquo;{payload.userMessage}&rdquo;</p>}
      {!isSender && status === "PENDING" ? (
        <div className="offer-card-actions">
          <button className="btn-accent sm" disabled={acting} onClick={() => act("accept")}>Accept</button>
          <button className="btn-soft sm" disabled={acting} onClick={() => act("decline")}>Decline</button>
        </div>
      ) : (
        <div className={"offer-card-status " + status.toLowerCase()}>
          {status === "PENDING"   && <><Icon name="clock" size={13} /> Offer sent — waiting for response</>}
          {status === "ACCEPTED"  && (isSender ? <><Icon name="check" size={13} /> Offer accepted</> : <><Icon name="check" size={13} /> You accepted this offer</>)}
          {status === "DECLINED"  && (isSender ? <><Icon name="x" size={13} /> Offer declined</> : <><Icon name="x" size={13} /> You declined this offer</>)}
        </div>
      )}
    </div>
  )
}

// ── SharedPostCard ────────────────────────────────────────────────────────
export function SharedPostCard({ sp, mine }: { sp: SharedPostPayload; mine: boolean }) {
  return (
    <a href={`/post/${sp.postId}`}
       className={"shared-post-card " + (mine ? "mine" : "theirs")}
       target="_blank" rel="noreferrer">
      {sp.imageUrl && (
        <div className="shared-post-thumb">
          <img src={sp.imageUrl} alt={sp.postItem} />
        </div>
      )}
      <div className="shared-post-body">
        <span className="shared-post-item">{sp.postItem}</span>
        <span className="shared-post-user">by {sp.postUser}</span>
        {sp.postType && sp.postType !== "complete" && (
          <span className={"shared-post-badge " + sp.postType}>
            {sp.postType === "offer" ? "Offering" : "Looking for"}
          </span>
        )}
      </div>
    </a>
  )
}

// ── VoicePlayer ───────────────────────────────────────────────────────────
export function VoicePlayer({ url, duration, mine }: { url: string; duration: number; mine: boolean }) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [realDur, setRealDur] = React.useState(duration)

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play().catch(() => {}); setPlaying(true) }
  }

  return (
    <div className={"chat-voice " + (mine ? "mine" : "theirs")}>
      <audio ref={audioRef} src={url}
             onTimeUpdate={() => setProgress(audioRef.current?.currentTime ?? 0)}
             onLoadedMetadata={() => setRealDur(audioRef.current?.duration ?? duration)}
             onEnded={() => { setPlaying(false); setProgress(0) }} />
      <button className="voice-play-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        <Icon name={playing ? "pause" : "play"} size={11} fill="x" />
      </button>
      <div className="voice-progress-wrap">
        <div className="voice-bar">
          <div className="voice-fill" style={{ width: realDur ? `${(progress / realDur) * 100}%` : "0%" }} />
        </div>
        <span className="voice-time">{fmtDur(playing ? progress : realDur)}</span>
      </div>
    </div>
  )
}

// ── ChatImageBubble ───────────────────────────────────────────────────────
export function ChatImageBubble({
  url, caption, mine, onLightbox,
}: {
  url: string; caption?: string | null; mine: boolean; onLightbox?: (url: string) => void
}) {
  return (
    <div className={"chat-img-bubble " + (mine ? "mine" : "theirs")}>
      <img src={url} alt="image" onClick={onLightbox ? () => onLightbox(url) : undefined} />
      {caption && <p className="chat-img-caption">{caption}</p>}
    </div>
  )
}
