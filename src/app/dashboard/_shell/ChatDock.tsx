"use client";
import React from "react";
import { Icon, Avatar } from "./TopNav";
import { OfferCard, SharedPostCard, VoicePlayer, ChatImageBubble } from "@/components/chat-renderers";
import {
  tryParseMsg, classifyUploadError, uploadChatImage, fmtDur,
  type ImagePayload, type VoicePayload, type OfferPayload,
  type OfferUpdatePayload, type SharedPostPayload,
} from "@/lib/chat-helpers";

// ── Types ─────────────────────────────────────────────────────────────────
export interface ChatMsg {
  id: string; content: string; senderId: string; receiverId?: string;
  createdAt: string; pending?: boolean;
}
export interface DisplayMsg extends ChatMsg { status?: "sending" | "failed"; failReason?: string }
type PendingItem =
  | { type: "voice"; blob: Blob; dur: number }
  | { type: "image"; file: File; caption: string; previewUrl: string }
export interface ChatWindow { name: string; partnerId: string; minimized: boolean }
export interface ConfirmableTrade {
  id: string
  offeredItemTitle: string
  requestedItemTitle: string
  sender: { id: string; name: string }
  receiver: { id: string; name: string }
}

// ── ChatWindowPanel ───────────────────────────────────────────────────────
function ChatWindowPanel({
  win, myId, onClose, onMinimize, confirmTrade, onConfirmSwap,
  completedTrade, onRateSwap,
}: {
  win: ChatWindow; myId: string; onClose: () => void; onMinimize: () => void;
  confirmTrade?: ConfirmableTrade;
  onConfirmSwap?: (trade: ConfirmableTrade) => void;
  completedTrade?: { tradeId: string; partnerName: string };
  onRateSwap?: (tradeId: string, partnerName: string) => void;
}) {
  const [msgs, setMsgs] = React.useState<DisplayMsg[]>([]);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  const [recording, setRecording] = React.useState(false);
  const [recordingSecs, setRecordingSecs] = React.useState(0);
  const [voiceBlob, setVoiceBlob] = React.useState<Blob | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const recordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = React.useRef(false);
  const pendingRef = React.useRef<Map<string, PendingItem>>(new Map());

  const bottomRef = React.useRef<HTMLDivElement>(null);
  const msgsContainerRef = React.useRef<HTMLDivElement>(null);
  const atBottomRef = React.useRef(true);
  const [newMsgPill, setNewMsgPill] = React.useState(false);
  const [typingName, setTypingName] = React.useState<string | null>(null);
  const typingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (win.minimized) return;
    setLoading(true);
    fetch(`/api/messages?partnerId=${win.partnerId}`)
      .then((r) => r.json())
      .then((data: ChatMsg[]) => {
        if (!Array.isArray(data)) { setLoading(false); return; }
        const statusMap = new Map<string, string>();
        data.forEach((m) => {
          const p = tryParseMsg(m.content);
          if (p?.type === "offer_update") {
            const up = p as OfferUpdatePayload;
            statusMap.set(up.offerId, up.status);
          }
        });
        const enriched = statusMap.size > 0
          ? data.map((m) => {
              const p = tryParseMsg(m.content);
              if (p?.type === "offer") {
                const op = p as OfferPayload;
                if (statusMap.has(op.offerId)) {
                  return { ...m, content: JSON.stringify({ ...op, status: statusMap.get(op.offerId) }) };
                }
              }
              return m;
            })
          : data;
        setMsgs(enriched);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [win.partnerId, win.minimized]);

  React.useEffect(() => {
    if (msgs.length === 0) return;
    const last = msgs[msgs.length - 1];
    if (atBottomRef.current || last.senderId === myId) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setNewMsgPill(false);
    } else {
      setNewMsgPill(true);
    }
  }, [msgs, myId]);

  React.useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        cancelledRef.current = true;
        mediaRecorderRef.current.stop();
      }
      pendingRef.current.forEach((item) => {
        if (item.type === "image") URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  React.useEffect(() => {
    const onMsg = (e: Event) => {
      const msg = (e as CustomEvent<ChatMsg>).detail;
      if (msg.senderId !== win.partnerId) return;
      setMsgs((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
    };
    const onOfferUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        offerId: string; status: string; actorName: string; systemMessage: ChatMsg;
        tradeId?: string; offeredItemTitle?: string; requestedItemTitle?: string;
        senderName?: string; receiverName?: string; receiverId?: string;
      };
      const { offerId, status, systemMessage } = detail;
      if (status === "ACCEPTED" && detail.tradeId) {
        window.dispatchEvent(new CustomEvent("baylo:trade-accepted", {
          detail: {
            tradeId: detail.tradeId,
            offeredItemTitle: detail.offeredItemTitle ?? "",
            requestedItemTitle: detail.requestedItemTitle ?? "",
            senderId: myId,
            senderName: detail.senderName ?? "",
            receiverId: detail.receiverId ?? "",
            receiverName: detail.receiverName ?? detail.actorName,
          },
        }));
      }
      setMsgs((prev) => {
        let next = prev.map((m) => {
          const p = tryParseMsg(m.content);
          if (p?.type === "offer" && (p as OfferPayload).offerId === offerId) {
            return { ...m, content: JSON.stringify({ ...p, status }) };
          }
          return m;
        });
        if (systemMessage && !next.some((m) => m.id === systemMessage.id)) {
          next = [...next, systemMessage];
        }
        return next;
      });
    };
    const onTyping = (e: Event) => {
      const { senderId, name } = (e as CustomEvent).detail as { senderId: string; name: string };
      if (senderId !== win.partnerId) return;
      setTypingName(name);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setTypingName(null), 3000);
    };
    const onReconnected = () => {
      fetch(`/api/messages?partnerId=${win.partnerId}`)
        .then((r) => r.json())
        .then((fresh: ChatMsg[]) => {
          if (!Array.isArray(fresh)) return;
          setMsgs((prev) => {
            const knownIds = new Set(prev.filter((m) => !m.id.startsWith("local-")).map((m) => m.id));
            const missed = fresh.filter((m) => !knownIds.has(m.id));
            if (missed.length === 0) return prev;
            return [...prev.filter((m) => m.id.startsWith("local-") || knownIds.has(m.id)), ...missed]
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          });
        })
        .catch(() => {});
    };
    window.addEventListener("baylo:msg", onMsg);
    window.addEventListener("baylo:offer-updated", onOfferUpdated);
    window.addEventListener("baylo:typing", onTyping);
    window.addEventListener("baylo:reconnected", onReconnected);
    return () => {
      window.removeEventListener("baylo:msg", onMsg);
      window.removeEventListener("baylo:offer-updated", onOfferUpdated);
      window.removeEventListener("baylo:typing", onTyping);
      window.removeEventListener("baylo:reconnected", onReconnected);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    };
  }, [win.partnerId]);

  const onImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image file"); return; }
    if (file.size > 10 * 1024 * 1024) { alert("Image must be under 10 MB"); return; }
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    e.target.value = "";
  };

  const removeImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
  };

  const stopRecording = React.useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setRecording(false);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      cancelledRef.current = false;
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!cancelledRef.current) {
          setVoiceBlob(new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" }));
        }
      };
      mr.start();
      setRecording(true);
      setRecordingSecs(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSecs((s) => {
          if (s + 1 >= 120) setTimeout(stopRecording, 0);
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
        alert("Microphone access denied. Please allow microphone permission in your browser settings.");
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        alert("No microphone found on this device.");
      } else {
        alert("Could not access microphone.");
      }
    }
  };

  const cancelRecording = () => {
    cancelledRef.current = true;
    stopRecording();
    setVoiceBlob(null);
    setRecordingSecs(0);
  };

  const doVoiceUpload = async (tempId: string, blob: Blob, dur: number) => {
    const fd = new FormData();
    fd.append("file", blob, "voice.webm");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const upRes = await fetch("/api/upload/audio", { method: "POST", body: fd, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!upRes.ok) {
        const errBody = await upRes.json().catch(() => ({})) as { error?: string };
        const reason = classifyUploadError(upRes.status, errBody.error);
        setMsgs((p) => p.map((m) => m.id === tempId ? { ...m, status: "failed" as const, failReason: reason } : m));
        return;
      }
      const { url } = await upRes.json() as { url: string };
      const content = JSON.stringify({ type: "voice", url, duration: dur } satisfies VoicePayload);
      const msgRes = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiverId: win.partnerId, content }) });
      if (!msgRes.ok) {
        setMsgs((p) => p.map((m) => m.id === tempId ? { ...m, status: "failed" as const, failReason: "Failed to save message" } : m));
        return;
      }
      const msg = await msgRes.json() as ChatMsg;
      pendingRef.current.delete(tempId);
      setMsgs((p) => p.map((m) => m.id === tempId ? { ...msg } : m));
    } catch (err) {
      clearTimeout(timeoutId);
      const reason = err instanceof DOMException && err.name === "AbortError"
        ? "Upload timed out" : "Network error";
      setMsgs((p) => p.map((m) => m.id === tempId ? { ...m, status: "failed" as const, failReason: reason } : m));
    }
  };

  const doImageUpload = async (tempId: string, file: File, caption: string) => {
    try {
      const url = await uploadChatImage(file);
      const content = JSON.stringify({ type: "image", url, caption: caption || null } satisfies ImagePayload);
      const msgRes = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiverId: win.partnerId, content }) });
      if (!msgRes.ok) {
        setMsgs((p) => p.map((m) => m.id === tempId ? { ...m, status: "failed" as const, failReason: "Failed to save message" } : m));
        return;
      }
      const msg = await msgRes.json() as ChatMsg;
      const item = pendingRef.current.get(tempId);
      if (item?.type === "image") URL.revokeObjectURL(item.previewUrl);
      pendingRef.current.delete(tempId);
      setMsgs((p) => p.map((m) => m.id === tempId ? { ...msg } : m));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Upload failed";
      setMsgs((p) => p.map((m) => m.id === tempId ? { ...m, status: "failed" as const, failReason: reason } : m));
    }
  };

  const retryVoice = async (id: string) => {
    const item = pendingRef.current.get(id);
    if (!item || item.type !== "voice") return;
    setMsgs((p) => p.map((m) => m.id === id ? { ...m, status: "sending" as const, failReason: undefined } : m));
    await doVoiceUpload(id, item.blob, item.dur);
  };

  const retryImage = async (id: string) => {
    const item = pendingRef.current.get(id);
    if (!item || item.type !== "image") return;
    setMsgs((p) => p.map((m) => m.id === id ? { ...m, status: "sending" as const, failReason: undefined } : m));
    await doImageUpload(id, item.file, item.caption);
  };

  const deleteMsg = (id: string) => {
    const item = pendingRef.current.get(id);
    if (item?.type === "image") URL.revokeObjectURL(item.previewUrl);
    pendingRef.current.delete(id);
    setMsgs((p) => p.filter((m) => m.id !== id));
  };

  const send = async () => {
    if (sending) return;
    if (imageFile) {
      const file = imageFile;
      const caption = text.trim();
      const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);
      pendingRef.current.set(tempId, { type: "image", file, caption, previewUrl });
      const optimistic: DisplayMsg = {
        id: tempId, senderId: myId, createdAt: new Date().toISOString(),
        content: JSON.stringify({ type: "image", url: previewUrl, caption: caption || null } satisfies ImagePayload),
        status: "sending",
      };
      setMsgs((p) => [...p, optimistic]);
      removeImage();
      setText("");
      await doImageUpload(tempId, file, caption);
      return;
    }
    const content = text.trim();
    if (!content) return;
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: DisplayMsg = { id: tempId, senderId: myId, createdAt: new Date().toISOString(), content, status: "sending" };
    setMsgs((p) => [...p, optimistic]);
    setText("");
    setSending(true);
    try {
      const res = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiverId: win.partnerId, content }) });
      if (res.ok) { const msg = await res.json() as ChatMsg; setMsgs((p) => p.map((m) => m.id === tempId ? { ...msg } : m)); }
      else { setMsgs((p) => p.map((m) => m.id === tempId ? { ...m, status: "failed" as const, failReason: "Failed to send" } : m)); }
    } finally {
      setSending(false);
    }
  };

  const sendVoice = async () => {
    if (!voiceBlob) return;
    if (voiceBlob.size === 0) { alert("No audio was captured. The microphone may have been blocked."); return; }
    if (voiceBlob.size > 10 * 1024 * 1024) { alert("Voice message too large (max 10 MB / ~2 minutes)."); return; }
    const blobToUpload = voiceBlob;
    const dur = recordingSecs;
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setVoiceBlob(null);
    setRecordingSecs(0);
    const optimistic: DisplayMsg = {
      id: tempId, senderId: myId, createdAt: new Date().toISOString(),
      content: JSON.stringify({ type: "voice", url: "", duration: dur } satisfies VoicePayload),
      status: "sending",
    };
    setMsgs((p) => [...p, optimistic]);
    pendingRef.current.set(tempId, { type: "voice", blob: blobToUpload, dur });
    await doVoiceUpload(tempId, blobToUpload, dur);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const isSendable = imageFile ? true : text.trim().length > 0;

  return (
    <div className={"chat-window" + (win.minimized ? " minimized" : "")}>
      {lightboxUrl && (
        <div className="chat-lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="full size" />
        </div>
      )}
      <div className="chat-head" onClick={onMinimize}>
        <Avatar name={win.name} size={28} />
        <span className="chat-head-name">{win.name}</span>
        <button className="chat-head-btn" aria-label="Minimize" onClick={(e) => { e.stopPropagation(); onMinimize(); }}>
          <Icon name="arrowRight" size={16} style={{ transform: win.minimized ? "rotate(-90deg)" : "rotate(90deg)" }} />
        </button>
        <button className="chat-head-btn" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(); }}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {confirmTrade && !win.minimized && (
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
          <button
            onClick={() => onConfirmSwap?.(confirmTrade)}
            style={{
              width: "100%", padding: "8px 0",
              background: "#3C7143", color: "#fff",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Confirm Swap — enter code
          </button>
        </div>
      )}
      {completedTrade && !win.minimized && (
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border, #e5e7eb)", background: "#f0fdf4" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, fontSize: 12, fontWeight: 700, color: "#166534" }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
            </svg>
            Swap completed!
          </div>
          <button
            onClick={() => onRateSwap?.(completedTrade.tradeId, completedTrade.partnerName)}
            style={{
              width: "100%", padding: "8px 0",
              background: "rgba(60,113,67,.1)", color: "#3C7143",
              border: "1.5px solid rgba(60,113,67,.3)", borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ★ Rate {completedTrade.partnerName.split(" ")[0]}
          </button>
        </div>
      )}
      {!win.minimized && (
        <>
          <div
            className="chat-msgs"
            ref={msgsContainerRef}
            onScroll={() => {
              const el = msgsContainerRef.current;
              if (!el) return;
              atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              if (atBottomRef.current) setNewMsgPill(false);
            }}
          >
            {loading ? (
              <div className="chat-empty-msgs">Loading…</div>
            ) : msgs.length === 0 ? (
              <div className="chat-empty-msgs">No messages yet. Say hello!</div>
            ) : msgs.map((m) => {
              const mine = m.senderId === myId;
              const parsed = tryParseMsg(m.content);
              if (parsed?.type === "offer") {
                const offerPayload = parsed as OfferPayload;
                const isSenderOffer = offerPayload.senderId ? offerPayload.senderId === myId : mine;
                return (
                  <div key={m.id} className={"chat-bubble-wrap " + (isSenderOffer ? "mine" : "theirs")}>
                    <OfferCard
                      payload={offerPayload}
                      myId={myId}
                      partnerId={win.partnerId}
                      isSender={isSenderOffer}
                      onAction={(_id, _action, newStatus) => {
                        setMsgs((prev) => prev.map((msg) =>
                          msg.id === m.id
                            ? { ...msg, content: JSON.stringify({ ...offerPayload, status: newStatus }) }
                            : msg
                        ));
                      }}
                    />
                  </div>
                );
              }
              if (parsed?.type === "offer_update") {
                const up = parsed as OfferUpdatePayload;
                return (
                  <div key={m.id} className="chat-system-msg">
                    {up.status === "ACCEPTED" ? `${up.actorName} accepted the offer` : `${up.actorName} declined the offer`}
                  </div>
                );
              }
              if (parsed?.type === "shared_post") {
                return <SharedPostCard key={m.id} sp={parsed as SharedPostPayload} mine={mine} />;
              }
              if (parsed?.type === "image") {
                const ip = parsed as ImagePayload;
                if (m.status === "sending") {
                  const pItem = pendingRef.current.get(m.id);
                  const imgSrc = pItem?.type === "image" ? pItem.previewUrl : ip.url;
                  return (
                    <div key={m.id} className="chat-img-bubble mine chat-img-pending">
                      <img src={imgSrc} alt="sending" />
                      <div className="chat-img-status-overlay"><div className="chat-pending-spinner" /></div>
                    </div>
                  );
                }
                if (m.status === "failed") {
                  const pItem = pendingRef.current.get(m.id);
                  const imgSrc = pItem?.type === "image" ? pItem.previewUrl : ip.url;
                  return (
                    <div key={m.id} className="chat-img-bubble mine chat-img-failed">
                      <img src={imgSrc} alt="failed" />
                      <div className="chat-img-status-overlay chat-fail-overlay">
                        <span className="chat-fail-icon"><Icon name="x" size={14} /></span>
                        <span className="chat-fail-text">Failed to send</span>
                        {m.failReason && <span className="chat-fail-reason">{m.failReason}</span>}
                        <div className="chat-fail-actions">
                          <button className="chat-retry-btn" onClick={() => retryImage(m.id)}>Retry</button>
                          <button className="chat-delete-btn" onClick={() => deleteMsg(m.id)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return <ChatImageBubble key={m.id} url={ip.url} caption={ip.caption} mine={mine} onLightbox={setLightboxUrl} />;
              }
              if (parsed?.type === "voice") {
                const vp = parsed as VoicePayload;
                if (m.status === "sending") {
                  return (
                    <div key={m.id} className="chat-voice mine chat-voice-sending">
                      <div className="chat-pending-spinner" />
                      <div className="voice-progress-wrap">
                        <div className="voice-bar"><div className="voice-fill" style={{ width: "0%" }} /></div>
                        <span className="voice-time">Sending…</span>
                      </div>
                    </div>
                  );
                }
                if (m.status === "failed") {
                  return (
                    <div key={m.id} className="chat-voice mine chat-voice-failed">
                      <span className="chat-fail-icon">⚠</span>
                      <div className="chat-voice-fail-body">
                        <span className="chat-fail-text">Failed to send{m.failReason ? ` — ${m.failReason}` : ""}</span>
                        <div className="chat-fail-actions">
                          <button className="chat-retry-btn" onClick={() => retryVoice(m.id)}>Retry</button>
                          <button className="chat-delete-btn" onClick={() => deleteMsg(m.id)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return <VoicePlayer key={m.id} url={vp.url} duration={vp.duration} mine={mine} />;
              }
              if (!m.content) return null;
              return (
                <div key={m.id} className={"chat-bubble " + (mine ? "mine" : "theirs") + (m.status === "sending" ? " chat-bubble-sending" : m.status === "failed" ? " chat-bubble-failed" : "")}>
                  {m.content}
                  {m.status === "failed" && (
                    <div className="chat-fail-actions" style={{ marginTop: 4 }}>
                      <button className="chat-retry-btn" onClick={() => {
                        setMsgs((p) => p.map((x) => x.id === m.id ? { ...x, status: "sending" as const, failReason: undefined } : x));
                        const content = m.content;
                        const tempId = m.id;
                        fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiverId: win.partnerId, content }) })
                          .then((r) => r.ok ? r.json() : Promise.reject())
                          .then((msg: ChatMsg) => setMsgs((p) => p.map((x) => x.id === tempId ? { ...msg } : x)))
                          .catch(() => setMsgs((p) => p.map((x) => x.id === tempId ? { ...x, status: "failed" as const } : x)));
                      }}>Retry</button>
                      <button className="chat-delete-btn" onClick={() => setMsgs((p) => p.filter((x) => x.id !== m.id))}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
            {typingName && (
              <div className="chat-typing-indicator">
                <span /><span /><span />
                <em>{typingName} is typing</em>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {newMsgPill && (
            <button
              className="new-msg-pill"
              onClick={() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setNewMsgPill(false); }}
            >
              <Icon name="arrowRight" size={13} style={{ transform: "rotate(90deg)" }} />
              New message
            </button>
          )}
          {imagePreview && (
            <div className="chat-img-preview-wrap">
              <div className="chat-img-preview-box">
                <img src={imagePreview} alt="preview" />
                <button className="chat-img-preview-remove" onClick={removeImage} aria-label="Remove image">
                  <Icon name="x" size={10} />
                </button>
              </div>
            </div>
          )}
          {voiceBlob ? (
            <div className="chat-input-row">
              <button className="chat-attach-btn" onClick={() => { setVoiceBlob(null); setRecordingSecs(0); }} aria-label="Discard voice">
                <Icon name="x" size={16} />
              </button>
              <span className="chat-voice-ready-label">
                <Icon name="mic" size={13} />{fmtDur(recordingSecs)}
              </span>
              <button className="chat-send" onClick={sendVoice} disabled={sending}>
                <Icon name="send" size={15} />
              </button>
            </div>
          ) : recording ? (
            <div className="chat-input-row">
              <span className="chat-recording-dot" />
              <span className="chat-recording-time">{fmtDur(recordingSecs)}</span>
              <button className="chat-attach-btn" onClick={stopRecording} aria-label="Stop recording" title="Stop">
                <Icon name="stop" size={13} fill="x" />
              </button>
              <button className="chat-attach-btn" onClick={cancelRecording} aria-label="Cancel recording" title="Cancel">
                <Icon name="x" size={16} />
              </button>
            </div>
          ) : (
            <>
              <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onImagePick} />
              <div className="chat-input-row">
                <button className="chat-attach-btn" onClick={() => imageInputRef.current?.click()} aria-label="Attach image" title="Attach image">
                  <Icon name="image" size={17} />
                </button>
                <button className="chat-attach-btn" onClick={startRecording} aria-label="Record voice message" title="Voice message">
                  <Icon name="mic" size={17} />
                </button>
                <input
                  className="chat-input"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
                    typingDebounceRef.current = setTimeout(() => {
                      fetch("/api/pusher/typing", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ receiverId: win.partnerId }),
                      }).catch(() => {});
                    }, 400);
                  }}
                  onKeyDown={onKey}
                  placeholder={imageFile ? "Add a caption…" : "Type a message…"}
                />
                <button className="chat-send" onClick={send} disabled={sending || !isSendable}>
                  <Icon name="send" size={15} />
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── ChatDock (default export) ─────────────────────────────────────────────
export default function ChatDock({ windows, myId, onClose, onMinimize, confirmableByPartnerId, onConfirmSwap, completedByPartnerId, onRateSwap }: {
  windows: ChatWindow[]; myId: string;
  onClose: (partnerId: string) => void;
  onMinimize: (partnerId: string) => void;
  confirmableByPartnerId?: Record<string, ConfirmableTrade>;
  onConfirmSwap?: (trade: ConfirmableTrade) => void;
  completedByPartnerId?: Record<string, { tradeId: string; partnerName: string }>;
  onRateSwap?: (tradeId: string, partnerName: string) => void;
}) {
  if (windows.length === 0) return null;
  return (
    <div className="chat-dock">
      {[...windows].reverse().map((w) => (
        <ChatWindowPanel key={w.partnerId} win={w} myId={myId}
                         onClose={() => onClose(w.partnerId)}
                         onMinimize={() => onMinimize(w.partnerId)}
                         confirmTrade={confirmableByPartnerId?.[w.partnerId]}
                         onConfirmSwap={onConfirmSwap}
                         completedTrade={completedByPartnerId?.[w.partnerId]}
                         onRateSwap={onRateSwap} />
      ))}
    </div>
  );
}
