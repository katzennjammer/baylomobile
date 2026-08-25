"use client"

import { useState, useEffect, useRef } from "react"
import { formatDate } from "@/lib/utils"
import toast from "react-hot-toast"
import { subscribeChannel, unsubscribeChannel } from "@/lib/pusher-client"
import AvatarImage from "@/components/AvatarImage"
import { Icon } from "@/app/dashboard/_shell/TopNav"
import { OfferCard, SharedPostCard, VoicePlayer, ChatImageBubble } from "@/components/chat-renderers"
import {
  tryParseMsg, uploadChatImage,
  type OfferPayload, type OfferUpdatePayload,
  type SharedPostPayload, type ImagePayload, type VoicePayload,
} from "@/lib/chat-helpers"

type Conversation = {
  partnerId: string
  partnerName: string
  partnerAvatar: string | null
  lastMessage: string
  lastMessageDate: string
  unread: boolean
}

type Message = {
  id: string
  content: string
  senderId: string
  createdAt: string
  status?: "sending"
}

export default function MessagesClient({
  conversations: initialConversations,
  currentUserId,
  initialPartnerId,
}: {
  conversations: Conversation[]
  currentUserId: string
  initialPartnerId?: string
}) {
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations)
  const [selected, setSelected] = useState<Conversation | null>(
    initialPartnerId ? (initialConversations.find((c) => c.partnerId === initialPartnerId) ?? null) : null
  )
  const [messages, setMessages] = useState<Message[]>([])
  const [newMsg, setNewMsg] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImagesRef = useRef<Map<string, string>>(new Map())

  const bottomRef = useRef<HTMLDivElement>(null)
  const msgsContainerRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const [newMsgPill, setNewMsgPill] = useState(false)
  const selectedRef = useRef<Conversation | null>(null)
  selectedRef.current = selected

  useEffect(() => {
    if (messages.length === 0) return
    const last = messages[messages.length - 1]
    if (atBottomRef.current || last.senderId === currentUserId) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
      setNewMsgPill(false)
    } else {
      setNewMsgPill(true)
    }
  }, [messages, currentUserId])

  useEffect(() => {
    const channel = subscribeChannel(`private-user-${currentUserId}`)
    if (!channel) return

    channel.bind("new-message", (data: Message & { senderName: string; senderAvatar: string | null }) => {
      const partnerId = data.senderId

      if (selectedRef.current?.partnerId === partnerId) {
        setMessages((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data])
      }

      setConversations((prev) => {
        const preview = (() => {
          try {
            const p = JSON.parse(data.content)
            if (p.type === "offer") return "Sent a trade offer"
            if (p.type === "offer_update") return `Offer ${String(p.status ?? "updated").toLowerCase()}`
            if (p.type === "shared_post") return `Shared: ${p.postItem}`
            if (p.type === "image") return "Sent an image"
            if (p.type === "voice") return "Sent a voice message"
          } catch { /* plain text */ }
          return data.content.slice(0, 60)
        })()

        const isActive = selectedRef.current?.partnerId === partnerId
        const idx = prev.findIndex((c) => c.partnerId === partnerId)
        if (idx !== -1) {
          const updated = [...prev]
          updated[idx] = { ...updated[idx], lastMessage: preview, lastMessageDate: data.createdAt, unread: !isActive }
          return updated
        }
        return [{
          partnerId,
          partnerName: data.senderName,
          partnerAvatar: data.senderAvatar ?? null,
          lastMessage: preview,
          lastMessageDate: data.createdAt,
          unread: !isActive,
        }, ...prev]
      })
    })

    return () => {
      unsubscribeChannel(`private-user-${currentUserId}`)
    }
  }, [currentUserId])

  async function openConversation(conv: Conversation) {
    setSelected(conv)
    setLoading(true)
    setConversations((prev) => prev.map((c) => c.partnerId === conv.partnerId ? { ...c, unread: false } : c))
    try {
      const res = await fetch(`/api/messages?partnerId=${conv.partnerId}`)
      const data = await res.json()
      setMessages(data)
    } catch {
      toast.error("Failed to load messages")
    } finally {
      setLoading(false)
    }
  }

  // Load messages when page opens with a pre-selected partner (e.g. ?partner=X)
  useEffect(() => {
    if (selected) void openConversation(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return }
    if (file.size > 10 * 1024 * 1024) { toast.error("Image must be under 10 MB"); return }
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    e.target.value = ""
  }

  const removeImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(null)
    setImagePreview(null)
  }

  async function doImageSend() {
    if (!selected || !imageFile) return
    const file = imageFile
    const caption = newMsg.trim()
    const tempId = `opt-img-${Date.now()}`
    const previewUrl = URL.createObjectURL(file)
    pendingImagesRef.current.set(tempId, previewUrl)
    const optimistic: Message = {
      id: tempId,
      content: JSON.stringify({ type: "image", url: previewUrl, caption: caption || null }),
      senderId: currentUserId,
      createdAt: new Date().toISOString(),
      status: "sending",
    }
    setMessages((prev) => [...prev, optimistic])
    removeImage()
    setNewMsg("")
    setSending(true)
    try {
      const url = await uploadChatImage(file)
      const content = JSON.stringify({ type: "image", url, caption: caption || null })
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: selected.partnerId, content }),
      })
      if (!res.ok) throw new Error("Failed to save message")
      const msg = await res.json() as Message
      pendingImagesRef.current.delete(tempId)
      URL.revokeObjectURL(previewUrl)
      setMessages((prev) => prev.map((m) => m.id === tempId ? msg : m))
    } catch (err) {
      pendingImagesRef.current.delete(tempId)
      URL.revokeObjectURL(previewUrl)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      toast.error(err instanceof Error ? err.message : "Failed to send image")
    } finally {
      setSending(false)
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    if (imageFile) {
      await doImageSend()
      return
    }
    if (!newMsg.trim()) return
    const content = newMsg.trim()
    const tempId = `opt-${Date.now()}`
    const optimistic: Message = { id: tempId, content, senderId: currentUserId, createdAt: new Date().toISOString() }
    setMessages((prev) => [...prev, optimistic])
    setNewMsg("")
    setSending(true)
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: selected.partnerId, content }),
      })
      if (!res.ok) throw new Error()
      const msg = await res.json()
      setMessages((prev) => prev.map((m) => m.id === tempId ? msg : m))
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      toast.error("Failed to send message")
    } finally {
      setSending(false)
    }
  }

  const isSendable = imageFile ? true : newMsg.trim().length > 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[600px]">
      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="full size" className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl" />
        </div>
      )}

      {/* Conversation list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-y-auto">
        {conversations.map((conv) => (
          <button
            key={conv.partnerId}
            onClick={() => openConversation(conv)}
            className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-center gap-3 ${selected?.partnerId === conv.partnerId ? "bg-emerald-50" : ""}`}
          >
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold flex-shrink-0 overflow-hidden">
              {conv.partnerAvatar ? (
                <AvatarImage src={conv.partnerAvatar} name={conv.partnerName} width={40} height={40} className="object-cover" />
              ) : (
                conv.partnerName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-medium ${conv.unread ? "text-gray-900" : "text-gray-700"}`}>{conv.partnerName}</p>
              <p className="text-xs text-gray-400 truncate">{conv.lastMessage}</p>
            </div>
            {conv.unread && <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 ml-auto" />}
          </button>
        ))}
      </div>

      {/* Chat area */}
      <div className="md:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col relative">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm overflow-hidden">
                {selected.partnerAvatar ? (
                  <AvatarImage src={selected.partnerAvatar} name={selected.partnerName} width={32} height={32} className="object-cover" />
                ) : (
                  selected.partnerName.charAt(0).toUpperCase()
                )}
              </div>
              <p className="font-semibold text-sm text-gray-900">{selected.partnerName}</p>
            </div>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
              ref={msgsContainerRef}
              onScroll={() => {
                const el = msgsContainerRef.current
                if (!el) return
                atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
                if (atBottomRef.current) setNewMsgPill(false)
              }}
            >
              {loading ? (
                <div className="text-center text-gray-400 text-sm">Loading...</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-gray-400 text-sm">No messages yet. Say hi!</div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.senderId === currentUserId
                  const parsed = tryParseMsg(msg.content)

                  if (parsed?.type === "offer") {
                    const op = parsed as OfferPayload
                    const isSenderOffer = op.senderId ? op.senderId === currentUserId : isMe
                    return (
                      <div key={msg.id} className={"chat-bubble-wrap " + (isSenderOffer ? "mine" : "theirs")}>
                        <OfferCard
                          payload={op}
                          myId={currentUserId}
                          partnerId={selected.partnerId}
                          isSender={isSenderOffer}
                          onAction={(_id, _action, newStatus) => {
                            setMessages((prev) => prev.map((m) =>
                              m.id === msg.id ? { ...m, content: JSON.stringify({ ...op, status: newStatus }) } : m
                            ))
                          }}
                        />
                      </div>
                    )
                  }

                  if (parsed?.type === "offer_update") {
                    const up = parsed as OfferUpdatePayload
                    return (
                      <div key={msg.id} className="chat-system-msg">
                        {up.status === "ACCEPTED"
                          ? `${up.actorName} accepted the offer`
                          : `${up.actorName} declined the offer`}
                      </div>
                    )
                  }

                  if (parsed?.type === "shared_post") {
                    return <SharedPostCard key={msg.id} sp={parsed as SharedPostPayload} mine={isMe} />
                  }

                  if (parsed?.type === "image") {
                    const ip = parsed as ImagePayload
                    if (msg.status === "sending") {
                      const previewUrl = pendingImagesRef.current.get(msg.id) ?? ip.url
                      return (
                        <div key={msg.id} className="chat-img-bubble mine chat-img-pending">
                          <img src={previewUrl} alt="sending" />
                          <div className="chat-img-status-overlay"><div className="chat-pending-spinner" /></div>
                        </div>
                      )
                    }
                    return (
                      <ChatImageBubble
                        key={msg.id}
                        url={ip.url}
                        caption={ip.caption}
                        mine={isMe}
                        onLightbox={setLightboxUrl}
                      />
                    )
                  }

                  if (parsed?.type === "voice") {
                    const vp = parsed as VoicePayload
                    return <VoicePlayer key={msg.id} url={vp.url} duration={vp.duration} mine={isMe} />
                  }

                  // Plain text
                  if (!msg.content) return null
                  return (
                    <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-xs px-4 py-2 rounded-2xl text-sm ${isMe ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-900"}`}>
                        <p>{msg.content}</p>
                        <p className={`text-xs mt-1 ${isMe ? "text-emerald-200" : "text-gray-400"}`}>{formatDate(msg.createdAt)}</p>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            {newMsgPill && (
              <button
                className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1"
                onClick={() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setNewMsgPill(false) }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 13l7 7 7-7" /></svg>
                New message
              </button>
            )}

            {/* Image preview strip above form */}
            {imagePreview && (
              <div className="px-4 pt-2 pb-0 border-t border-gray-100 flex items-center gap-2">
                <div className="relative inline-block">
                  <img src={imagePreview} alt="preview" className="h-14 w-auto max-w-[120px] rounded-lg object-cover" />
                  <button
                    type="button"
                    onClick={removeImage}
                    aria-label="Remove image"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 text-white flex items-center justify-center"
                  >
                    <Icon name="x" size={10} />
                  </button>
                </div>
                <span className="text-xs text-gray-400">Add a caption below (optional)</span>
              </div>
            )}

            <form onSubmit={sendMessage} className="p-4 border-t border-gray-100 flex gap-2 items-center">
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onImagePick} />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                aria-label="Attach image"
                title="Attach image"
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                <Icon name="image" size={17} />
              </button>
              <input
                value={newMsg}
                onChange={(e) => setNewMsg(e.target.value)}
                placeholder={imageFile ? "Add a caption..." : "Type a message..."}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={sending || !isSendable}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
